import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getHooks } from '../../../src/cli/list.js';
import { install } from '../../../src/core/installer.js';
import { generateLockfile } from '../../../src/core/lockfile.js';
import { update } from '../../../src/core/updater.js';

describe('Codex-native hook integration', () => {
  let tempDir: string;
  let consoleSpies: Array<ReturnType<typeof spyOn>>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-hook-integration-'));
    consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((method) =>
      spyOn(console, method as 'log').mockImplementation(() => {})
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    for (const spy of consoleSpies) spy.mockRestore();
  });

  it('fresh hooks install writes the native root registry without a nested native claim', async () => {
    const result = await install({
      targetDir: tempDir,
      components: ['hooks'],
      skipConfirm: true,
      dependencies: {
        generateAndWriteLockfileForDir: async () => ({ fileCount: 0 }),
      },
    });

    expect(result.success).toBe(true);
    expect(await Bun.file(join(tempDir, '.codex', 'hooks.json')).exists()).toBe(true);
    expect(await Bun.file(join(tempDir, '.codex', 'hooks', 'hooks.json')).exists()).toBe(false);
    expect(
      await Bun.file(join(tempDir, '.codex', 'hooks', 'scripts', 'secret-filter.sh')).exists()
    ).toBe(true);
    expect((await readdir(join(tempDir, '.codex', 'hooks', 'scripts'))).sort()).toEqual(
      [
        'codex-native-advisory.sh',
        'destructive-git-guard.sh',
        'file-change-validator.sh',
        'schema-validator.sh',
        'secret-filter.sh',
      ].sort()
    );
    const logged = consoleSpies
      .flatMap((spy) => spy.mock.calls.map((call) => String(call[0])))
      .join('\n');
    expect(logged).toContain('/hooks');
    expect(logged).toContain('not auto-approved');
  });

  it('prevalidates a root registry symlink before installing hook scripts', async () => {
    const outsideRegistry = join(tempDir, 'outside-hooks.json');
    await writeFile(outsideRegistry, '{"outside":true}');
    await mkdir(join(tempDir, '.codex'), { recursive: true });
    await symlink(outsideRegistry, join(tempDir, '.codex', 'hooks.json'));

    const result = await install({
      targetDir: tempDir,
      components: ['hooks'],
      force: true,
      skipConfirm: true,
      dependencies: {
        generateAndWriteLockfileForDir: async () => ({ fileCount: 0 }),
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('symbolic link');
    expect(await readFile(outsideRegistry, 'utf-8')).toBe('{"outside":true}');
    expect(await Bun.file(join(tempDir, '.codex', 'hooks', 'scripts')).exists()).toBe(false);
  });

  it('lists the root registry and managed scripts', async () => {
    await install({
      targetDir: tempDir,
      components: ['hooks'],
      skipConfirm: true,
      dependencies: {
        generateAndWriteLockfileForDir: async () => ({ fileCount: 0 }),
      },
    });

    const hooks = await getHooks(tempDir);
    expect(hooks.map(({ path }) => path).sort()).toEqual(
      [
        '.codex/hooks.json',
        '.codex/hooks/scripts/codex-native-advisory.sh',
        '.codex/hooks/scripts/destructive-git-guard.sh',
        '.codex/hooks/scripts/file-change-validator.sh',
        '.codex/hooks/scripts/schema-validator.sh',
        '.codex/hooks/scripts/secret-filter.sh',
      ].sort()
    );
  });

  it('tracks the root registry as a hooks lockfile artifact', async () => {
    await mkdir(join(tempDir, '.codex'), { recursive: true });
    await writeFile(join(tempDir, '.codex', 'hooks.json'), '{"hooks":{}}');

    const lockfile = await generateLockfile(tempDir, '1.0.10', '1.0.10');
    expect(lockfile.files['.codex/hooks.json']).toEqual(
      expect.objectContaining({ component: 'hooks' })
    );
  });

  it('merges with custom and OMX handlers idempotently under install and force updates', async () => {
    const customHandler = { type: 'command', command: 'printf custom', timeout: 5 };
    const omxHandler = {
      type: 'command',
      command: 'node "$PWD/.codex/hooks/codex-native-hook.js" SessionStart',
      timeout: 10,
    };
    const omxPostHandler = {
      type: 'command',
      command: 'node "$PWD/.codex/hooks/codex-native-hook.js" PostToolUse',
      timeout: 10,
    };
    await mkdir(join(tempDir, '.codex'), { recursive: true });
    await writeFile(
      join(tempDir, '.codex', 'hooks.json'),
      JSON.stringify({
        customMetadata: { owner: 'fixture' },
        hooks: {
          PreToolUse: [{ matcher: '^Bash$', hooks: [customHandler] }],
          SessionStart: [{ hooks: [omxHandler] }],
          PostToolUse: [{ hooks: [omxPostHandler] }],
        },
      })
    );

    const installed = await install({
      targetDir: tempDir,
      components: ['hooks'],
      skipConfirm: true,
    });
    expect(installed.success).toBe(true);

    const registryPath = join(tempDir, '.codex', 'hooks.json');
    const first = JSON.parse(await readFile(registryPath, 'utf-8')) as {
      customMetadata: { owner: string };
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(first.customMetadata).toEqual({ owner: 'fixture' });
    expect(first.hooks.PreToolUse?.[0]?.hooks[0]).toEqual(customHandler);
    expect(first.hooks.SessionStart?.[0]?.hooks[0]).toEqual(omxHandler);
    expect(first.hooks.PostToolUse?.[0]?.hooks[0]).toEqual(omxPostHandler);

    const preserved = await update({ targetDir: tempDir, components: ['hooks'], force: true });
    expect(preserved.success).toBe(true);

    const forced = await update({
      targetDir: tempDir,
      components: ['hooks'],
      force: true,
      forceOverwriteAll: true,
    });
    expect(forced.success).toBe(true);

    const final = JSON.parse(await readFile(registryPath, 'utf-8')) as {
      customMetadata: { owner: string };
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(final.customMetadata).toEqual({ owner: 'fixture' });
    expect(final.hooks.PreToolUse?.[0]?.hooks[0]).toEqual(customHandler);
    expect(final.hooks.SessionStart?.[0]?.hooks[0]).toEqual(omxHandler);
    expect(final.hooks.PostToolUse?.[0]?.hooks[0]).toEqual(omxPostHandler);

    const commands = Object.values(final.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map(({ command }) => command))
    );
    for (const scriptName of [
      'destructive-git-guard.sh',
      'file-change-validator.sh',
      'schema-validator.sh',
      'secret-filter.sh',
    ]) {
      expect(commands.filter((command) => command.includes(scriptName))).toHaveLength(1);
    }
  });
});
