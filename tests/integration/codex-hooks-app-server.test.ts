import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installNativeCodexHooks } from '../../src/core/codex-hooks.ts';
import { createIsolatedGitEnvironment } from '../../src/core/codex-project-root.js';
import { computeFileHash, generateLockfile } from '../../src/core/lockfile.ts';
import {
  assessOmxProjectSetup,
  type CodexHookRuntimeEntry,
  inspectCodexHooks,
  removeIneffectiveProjectHookTrustState,
} from '../../src/core/omx-installer.ts';

const nativeInteropAvailable = Bun.spawnSync(['codex', '--version']).exitCode === 0;
const nativeIt = nativeInteropAvailable ? it : it.skip;

function git(args: string[], cwd: string): void {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    env: createIsolatedGitEnvironment(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
}

function trustTables(hooks: CodexHookRuntimeEntry[]): string {
  return hooks
    .map(
      (hook) =>
        `[hooks.state.${JSON.stringify(hook.key)}]\ntrusted_hash = ${JSON.stringify(hook.currentHash)}\n`
    )
    .join('\n');
}

function userConfig(
  root: string,
  linked: string,
  hooks: CodexHookRuntimeEntry[] = [],
  linkedTrust: 'trusted' | 'untrusted' = 'trusted'
): string {
  return [
    '[features]',
    'hooks = true',
    '',
    `[projects.${JSON.stringify(root)}]`,
    'trust_level = "trusted"',
    '',
    `[projects.${JSON.stringify(linked)}]`,
    `trust_level = ${JSON.stringify(linkedTrust)}`,
    '',
    trustTables(hooks),
  ].join('\n');
}

async function runHook(command: string, cwd: string): Promise<number> {
  const payload = JSON.stringify({
    session_id: 'app-server-linked-worktree',
    turn_id: 'turn-1',
    cwd,
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'printf safe' },
  });
  const child = Bun.spawn(['bash', '-lc', command], {
    cwd,
    stdin: new Blob([payload]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return child.exited;
}

describe('Codex app-server hook interop', () => {
  let sandbox: string;
  let root: string;
  let linked: string;
  let home: string;
  let previousHome: string | undefined;
  let previousCodexHome: string | undefined;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'omcodex-app-server-hooks-'));
    root = join(sandbox, 'root');
    linked = join(sandbox, 'linked');
    home = join(sandbox, 'home');
    await Promise.all([mkdir(root), mkdir(join(home, '.codex'), { recursive: true })]);
    git(['init', '-q'], root);
    await writeFile(join(root, 'README.md'), '# fixture\n');
    git(['add', 'README.md'], root);
    git(
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.com',
        'commit',
        '-qm',
        'fixture',
      ],
      root
    );
    git(['worktree', 'add', '-qb', 'linked-fixture', linked], root);

    root = await realpath(root);
    linked = await realpath(linked);
    previousHome = process.env.HOME;
    previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = join(home, '.codex');
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await rm(sandbox, { recursive: true, force: true });
  });

  nativeIt(
    'ignores project-layer trust and executes the main checkout command from a linked worktree',
    async () => {
      const userConfigPath = join(home, '.codex', 'config.toml');
      await writeFile(userConfigPath, userConfig(root, linked));
      expect(await Bun.file(join(root, '.codex', 'hooks.json')).exists()).toBe(false);
      expect(
        await stat(join(linked, '.codex')).then(
          () => true,
          () => false
        )
      ).toBe(false);
      expect(await Bun.file(join(linked, '.codex', 'hooks.json')).exists()).toBe(false);

      const installed = await installNativeCodexHooks(linked, { overwrite: true });
      expect(installed.registryPath).toBe(join(root, '.codex', 'hooks.json'));
      expect(await Bun.file(join(root, '.codex', 'hooks.json')).exists()).toBe(true);
      expect((await stat(join(linked, '.codex'))).isDirectory()).toBe(true);
      expect(await Bun.file(join(linked, '.codex', 'hooks.json')).exists()).toBe(false);

      const discovered = inspectCodexHooks(linked)?.filter((hook) => hook.source === 'project');
      expect(discovered?.length).toBeGreaterThan(0);
      expect(
        discovered?.every((hook) => hook.sourcePath === join(root, '.codex', 'hooks.json'))
      ).toBe(true);
      const lockfile = await generateLockfile(linked, '1.0.13', '1.0.13');
      expect(lockfile.files['.codex/hooks.json']).toEqual(
        expect.objectContaining({
          root: 'codex-project',
          templateHash: await computeFileHash(discovered?.[0]?.sourcePath ?? ''),
        })
      );
      for (const hook of discovered ?? []) {
        const scriptName = hook.command?.match(/\.codex\/hooks\/scripts\/([^"' ]+)/)?.[1];
        if (!scriptName) continue;
        const key = `.codex/hooks/scripts/${scriptName}`;
        expect(lockfile.files[key]).toEqual(expect.objectContaining({ root: 'codex-project' }));
      }
      expect(discovered?.every((hook) => hook.trustStatus === 'untrusted')).toBe(true);

      await writeFile(
        join(root, '.codex', 'config.toml'),
        `[features]\nhooks = true\n\n# OMX-owned Codex hook trust state\n${trustTables(discovered ?? [])}# End OMX-owned Codex hook trust state\n`
      );
      const projectTrusted = inspectCodexHooks(linked)?.filter((hook) => hook.source === 'project');
      expect(projectTrusted?.every((hook) => hook.trustStatus === 'untrusted')).toBe(true);
      expect(removeIneffectiveProjectHookTrustState(root)).toBe(true);
      expect(await readFile(join(root, '.codex', 'config.toml'), 'utf8')).not.toContain(
        'OMX-owned Codex hook trust state'
      );

      await writeFile(userConfigPath, userConfig(root, linked, discovered));
      const trusted = inspectCodexHooks(linked)?.filter((hook) => hook.source === 'project');
      expect(trusted?.every((hook) => hook.trustStatus === 'trusted')).toBe(true);
      const command = trusted?.find((hook) =>
        hook.command?.includes('# omcustomcodex-hook:')
      )?.command;
      expect(command).toContain(`repo_root="${root}"`);
      expect(await runHook(command ?? '', linked)).toBe(0);

      await writeFile(userConfigPath, userConfig(root, linked, discovered, 'untrusted'));
      const mainProjectHooks =
        inspectCodexHooks(root)?.filter((hook) => hook.source === 'project') ?? [];
      const linkedProjectHooks =
        inspectCodexHooks(linked)?.filter((hook) => hook.source === 'project') ?? [];
      expect(mainProjectHooks.length).toBeGreaterThan(0);
      expect(mainProjectHooks.every((hook) => hook.trustStatus === 'trusted')).toBe(true);
      expect(linkedProjectHooks).toEqual([]);

      const linkedReadiness = assessOmxProjectSetup(linked, {
        exec: () => '',
        getPlatform: () => process.platform,
        inspectHooks: inspectCodexHooks,
      });
      expect(linkedReadiness.hookReadiness).toEqual({
        status: 'inactive',
        installed: true,
        discovered: 0,
        runnable: 0,
        approvalNeeded: 0,
      });
      expect(linkedReadiness.surfaces.nativeHooks).toBe(false);
    }
  );
});
