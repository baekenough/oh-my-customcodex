import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { renameSync, writeFileSync } from 'node:fs';
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type CodexHookRegistry, installNativeCodexHooks } from '../../../src/core/codex-hooks.js';
import { createIsolatedGitEnvironment } from '../../../src/core/codex-project-root.js';
import {
  assessManagedShellAdvisorReadiness,
  assessOmxProjectSetup,
  type CodexHookRuntimeEntry,
} from '../../../src/core/omx-installer.js';

const ADVISOR_MARKER = '# omcustomcodex-hook:shell-reserved-var-advisor.sh';

function git(args: string[], cwd: string): void {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    env: createIsolatedGitEnvironment(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
}

async function installedAdvisorEntry(projectRoot: string): Promise<CodexHookRuntimeEntry> {
  const sourcePath = join(await realpath(projectRoot), '.codex', 'hooks.json');
  const registry = JSON.parse(await readFile(sourcePath, 'utf8')) as CodexHookRegistry;
  const group = registry.hooks.PreToolUse?.find(({ matcher }) => matcher === '^Bash$');
  const handler = group?.hooks.find(({ command }) => command.endsWith(ADVISOR_MARKER));
  if (!handler) throw new Error('fixture did not install the managed shell advisor');
  return {
    key: `${sourcePath}:pre_tool_use:advisor`,
    command: handler.command,
    currentHash: 'sha256:fixture',
    enabled: true,
    source: 'project',
    sourcePath,
    trustStatus: 'trusted',
  };
}

describe('exact managed shell advisor readiness', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'omcodex-shell-advisor-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('keeps generic OMX hook readiness separate from the exact advisor gate', async () => {
    await mkdir(join(projectRoot, '.codex'), { recursive: true });
    await writeFile(
      join(projectRoot, '.codex', 'hooks.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: '^Bash$',
              hooks: [{ type: 'command', command: 'node generic-hook.js', timeout: 30 }],
            },
          ],
        },
      })
    );
    const genericHook: CodexHookRuntimeEntry = {
      key: 'generic',
      command: 'node generic-hook.js',
      currentHash: 'sha256:generic',
      enabled: true,
      source: 'project',
      sourcePath: join(projectRoot, '.codex', 'hooks.json'),
      trustStatus: 'trusted',
    };

    const general = assessOmxProjectSetup(projectRoot, {
      exec: () => '',
      getPlatform: () => 'linux',
      inspectHooks: () => [genericHook],
    });
    const focused = assessManagedShellAdvisorReadiness(projectRoot, {
      inspectHooks: () => [genericHook],
    });

    expect(general.hookReadiness.status).toBe('runnable');
    expect(focused.status).not.toBe('runnable');
    expect(focused.ready).toBe(false);
  });

  it('distinguishes missing, unverified, inactive, approval-needed, and runnable', async () => {
    expect(assessManagedShellAdvisorReadiness(projectRoot, { inspectHooks: () => [] }).status).toBe(
      'missing'
    );

    await installNativeCodexHooks(projectRoot, { overwrite: true });
    const exact = await installedAdvisorEntry(projectRoot);

    expect(
      assessManagedShellAdvisorReadiness(projectRoot, { inspectHooks: () => null }).status
    ).toBe('unverified');
    expect(assessManagedShellAdvisorReadiness(projectRoot, { inspectHooks: () => [] }).status).toBe(
      'inactive'
    );
    expect(
      assessManagedShellAdvisorReadiness(projectRoot, {
        inspectHooks: () => [{ ...exact, trustStatus: 'untrusted' }],
      }).status
    ).toBe('approval-needed');
    expect(
      assessManagedShellAdvisorReadiness(projectRoot, {
        inspectHooks: () => [{ ...exact, trustStatus: 'modified' }],
      }).status
    ).toBe('approval-needed');
    expect(
      assessManagedShellAdvisorReadiness(projectRoot, {
        inspectHooks: () => [{ ...exact, enabled: false }],
      }).status
    ).toBe('inactive');

    for (const trustStatus of ['trusted', 'managed'] as const) {
      const result = assessManagedShellAdvisorReadiness(projectRoot, {
        inspectHooks: () => [{ ...exact, trustStatus }],
      });
      expect(result.status).toBe('runnable');
      expect(result.ready).toBe(true);
    }
  });

  it('requires the exact project source path and does not accept plugin or marker-only entries', async () => {
    await installNativeCodexHooks(projectRoot, { overwrite: true });
    const exact = await installedAdvisorEntry(projectRoot);

    for (const runtime of [
      { ...exact, source: 'plugin' },
      { ...exact, sourcePath: join(projectRoot, '.codex', 'other-hooks.json') },
      { ...exact, command: `printf safe ${ADVISOR_MARKER}` },
    ]) {
      const result = assessManagedShellAdvisorReadiness(projectRoot, {
        inspectHooks: () => [runtime],
      });
      expect(result.status).toBe('inactive');
      expect(result.ready).toBe(false);
    }
  });

  it('fails integrity for modified or symlinked managed scripts before runtime trust can pass', async () => {
    await installNativeCodexHooks(projectRoot, { overwrite: true });
    const exact = await installedAdvisorEntry(projectRoot);
    const scriptsRoot = join(projectRoot, '.codex', 'hooks', 'scripts');
    const advisorPath = join(scriptsRoot, 'shell-reserved-var-advisor.sh');
    await unlink(advisorPath);
    expect(
      assessManagedShellAdvisorReadiness(projectRoot, { inspectHooks: () => [exact] }).status
    ).toBe('missing');

    await installNativeCodexHooks(projectRoot, { overwrite: true });
    await writeFile(advisorPath, '#!/bin/sh\nprintf modified\n');

    const modified = assessManagedShellAdvisorReadiness(projectRoot, {
      inspectHooks: () => [exact],
    });
    expect(modified.status).toBe('assets-modified');
    expect(modified.ready).toBe(false);

    await installNativeCodexHooks(projectRoot, { overwrite: true });
    const wrapperPath = join(scriptsRoot, 'codex-native-advisory.sh');
    await unlink(wrapperPath);
    await symlink(
      resolve(import.meta.dir, '../../../templates/.claude/hooks/scripts/codex-native-advisory.sh'),
      wrapperPath
    );
    const reinstalledExact = await installedAdvisorEntry(projectRoot);

    const symlinked = assessManagedShellAdvisorReadiness(projectRoot, {
      inspectHooks: () => [reinstalledExact],
    });
    expect(symlinked.status).toBe('assets-modified');
    expect(symlinked.ready).toBe(false);
  });

  it('rejects symlinked managed parent directories even when the target has packaged bytes', async () => {
    await installNativeCodexHooks(projectRoot, { overwrite: true });
    const exact = await installedAdvisorEntry(projectRoot);
    const codexRoot = join(projectRoot, '.codex');
    const hooksRoot = join(codexRoot, 'hooks');
    const scriptsRoot = join(hooksRoot, 'scripts');
    const packagedScriptsRoot = resolve(
      import.meta.dir,
      '../../../templates/.claude/hooks/scripts'
    );

    await rm(scriptsRoot, { recursive: true, force: true });
    await symlink(packagedScriptsRoot, scriptsRoot, 'dir');
    const scriptsSymlinked = assessManagedShellAdvisorReadiness(projectRoot, {
      inspectHooks: () => [exact],
    });
    expect(scriptsSymlinked.status).toBe('assets-modified');
    expect(scriptsSymlinked.ready).toBe(false);

    await rm(scriptsRoot, { recursive: true, force: true });
    await rename(hooksRoot, join(codexRoot, 'hooks-real'));
    await symlink(join(codexRoot, 'hooks-real'), hooksRoot, 'dir');
    const hooksSymlinked = assessManagedShellAdvisorReadiness(projectRoot, {
      inspectHooks: () => [exact],
    });
    expect(hooksSymlinked.status).toBe('assets-modified');
    expect(hooksSymlinked.ready).toBe(false);

    await unlink(hooksRoot);
    await rename(join(codexRoot, 'hooks-real'), hooksRoot);
    await rename(codexRoot, join(projectRoot, '.codex-real'));
    await symlink(join(projectRoot, '.codex-real'), codexRoot, 'dir');
    const codexSymlinked = assessManagedShellAdvisorReadiness(projectRoot, {
      inspectHooks: () => [exact],
    });
    expect(codexSymlinked.status).toBe('integrity-failed');
    expect(codexSymlinked.ready).toBe(false);
  });

  it('rejects hardlinked managed registry and script leaves', async () => {
    await installNativeCodexHooks(projectRoot, { overwrite: true });
    const exact = await installedAdvisorEntry(projectRoot);
    const registryPath = join(projectRoot, '.codex', 'hooks.json');
    const registryBackup = join(projectRoot, '.codex', 'hooks.backup.json');

    await link(registryPath, registryBackup);
    const hardlinkedRegistry = assessManagedShellAdvisorReadiness(projectRoot, {
      inspectHooks: () => [exact],
    });
    expect(hardlinkedRegistry.status).toBe('integrity-failed');
    expect(hardlinkedRegistry.ready).toBe(false);

    await unlink(registryBackup);
    const advisorPath = join(
      projectRoot,
      '.codex',
      'hooks',
      'scripts',
      'shell-reserved-var-advisor.sh'
    );
    const advisorBackup = join(projectRoot, '.codex', 'hooks', 'scripts', 'advisor.backup.sh');
    await link(advisorPath, advisorBackup);
    const hardlinkedScript = assessManagedShellAdvisorReadiness(projectRoot, {
      inspectHooks: () => [exact],
    });
    expect(hardlinkedScript.status).toBe('assets-modified');
    expect(hardlinkedScript.ready).toBe(false);
  });

  it('detects script mutation performed by runtime discovery between installation probes', async () => {
    await installNativeCodexHooks(projectRoot, { overwrite: true });
    const exact = await installedAdvisorEntry(projectRoot);
    const advisorPath = join(
      projectRoot,
      '.codex',
      'hooks',
      'scripts',
      'shell-reserved-var-advisor.sh'
    );
    const original = await readFile(advisorPath);
    const replacementPath = `${advisorPath}.replacement`;

    const result = assessManagedShellAdvisorReadiness(projectRoot, {
      inspectHooks: () => {
        writeFileSync(replacementPath, original);
        renameSync(replacementPath, advisorPath);
        return [exact];
      },
    });

    expect(result.status).toBe('assets-modified');
    expect(result.ready).toBe(false);
  });

  it('detects semantic-preserving registry mutation between installation probes', async () => {
    await installNativeCodexHooks(projectRoot, { overwrite: true });
    const exact = await installedAdvisorEntry(projectRoot);
    const registryPath = join(projectRoot, '.codex', 'hooks.json');
    const registry = await readFile(registryPath);
    const replacementPath = `${registryPath}.replacement`;

    const result = assessManagedShellAdvisorReadiness(projectRoot, {
      inspectHooks: () => {
        writeFileSync(replacementPath, registry);
        renameSync(replacementPath, registryPath);
        return [exact];
      },
    });

    expect(result.status).toBe('integrity-failed');
    expect(result.ready).toBe(false);
  });

  it('rejects a registry FIFO without blocking', async () => {
    await installNativeCodexHooks(projectRoot, { overwrite: true });
    const exact = await installedAdvisorEntry(projectRoot);
    const registryPath = join(projectRoot, '.codex', 'hooks.json');
    await unlink(registryPath);
    const mkfifo = Bun.spawnSync(['mkfifo', registryPath], { stdout: 'pipe', stderr: 'pipe' });
    expect(mkfifo.exitCode).toBe(0);

    const startedAt = Date.now();
    const result = assessManagedShellAdvisorReadiness(projectRoot, {
      inspectHooks: () => [exact],
    });

    expect(result.status).toBe('integrity-failed');
    expect(result.ready).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('rejects a managed script FIFO without blocking', async () => {
    await installNativeCodexHooks(projectRoot, { overwrite: true });
    const exact = await installedAdvisorEntry(projectRoot);
    const advisorPath = join(
      projectRoot,
      '.codex',
      'hooks',
      'scripts',
      'shell-reserved-var-advisor.sh'
    );
    await unlink(advisorPath);
    const mkfifo = Bun.spawnSync(['mkfifo', advisorPath], { stdout: 'pipe', stderr: 'pipe' });
    expect(mkfifo.exitCode).toBe(0);

    const startedAt = Date.now();
    const result = assessManagedShellAdvisorReadiness(projectRoot, {
      inspectHooks: () => [exact],
    });

    expect(result.status).toBe('assets-modified');
    expect(result.ready).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('preserves the linked target while correlating the authoritative main-checkout registry', async () => {
    const root = join(projectRoot, 'root');
    const linked = join(projectRoot, 'linked');
    await mkdir(root);
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
    await installNativeCodexHooks(linked, { overwrite: true });
    const exact = await installedAdvisorEntry(root);
    let inspectedRoot = '';

    const result = assessManagedShellAdvisorReadiness(linked, {
      inspectHooks: (candidate) => {
        inspectedRoot = candidate;
        return [exact];
      },
    });

    expect(result.status).toBe('runnable');
    expect(result.projectRoot).toBe(await realpath(linked));
    expect(result.codexProjectRoot).toBe(await realpath(root));
    expect(inspectedRoot).toBe(await realpath(linked));
  });
});
