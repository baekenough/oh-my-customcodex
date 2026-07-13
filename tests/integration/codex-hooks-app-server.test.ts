import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installNativeCodexHooks } from '../../src/core/codex-hooks.ts';
import {
  type CodexHookRuntimeEntry,
  inspectCodexHooks,
  removeIneffectiveProjectHookTrustState,
} from '../../src/core/omx-installer.ts';

const nativeInteropAvailable = Bun.spawnSync(['codex', '--version']).exitCode === 0;
const nativeIt = nativeInteropAvailable ? it : it.skip;

function git(args: string[], cwd: string): void {
  const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
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

function userConfig(root: string, linked: string, hooks: CodexHookRuntimeEntry[] = []): string {
  return [
    '[features]',
    'hooks = true',
    '',
    `[projects.${JSON.stringify(root)}]`,
    'trust_level = "trusted"',
    '',
    `[projects.${JSON.stringify(linked)}]`,
    'trust_level = "trusted"',
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
    await installNativeCodexHooks(root, { overwrite: true });
    await mkdir(join(linked, '.codex'), { recursive: true });

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

      const discovered = inspectCodexHooks(linked)?.filter((hook) => hook.source === 'project');
      expect(discovered?.length).toBeGreaterThan(0);
      expect(
        discovered?.every((hook) => hook.sourcePath === join(root, '.codex', 'hooks.json'))
      ).toBe(true);
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
    }
  );
});
