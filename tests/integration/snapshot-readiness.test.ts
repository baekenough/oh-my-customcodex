import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

type FakeSetupMode = 'partial' | 'complete';

interface SnapshotResult {
  success: boolean;
  errors?: string[];
}

async function writeFakeOmx(binDir: string, mode: FakeSetupMode): Promise<void> {
  const executable = join(binDir, 'omx');
  const setupLines = [
    '    mkdir -p .omx',
    `    printf '%s\\n' '{"scope":"project","installMode":"legacy","mcpMode":"compat"}' > .omx/setup-scope.json`,
    `    printf '%s\\n' '.omx/' '.codex/*' '!.codex/agents/' '!.codex/agents/**' '!.codex/skills/' '!.codex/skills/**' '.codex/skills/.system/**' '!.codex/prompts/' '!.codex/prompts/**' >> .gitignore`,
  ];
  if (mode === 'complete') {
    setupLines.push(
      '    mkdir -p .codex/prompts .codex/skills/plan .codex/agents',
      `    printf '%s\\n' '# Executor' > .codex/prompts/executor.md`,
      `    printf '%s\\n' '# Plan' > .codex/skills/plan/SKILL.md`,
      `    printf '%s\\n' 'name = "executor"' 'description = "Implement"' 'developer_instructions = "Verify."' > .codex/agents/executor.toml`,
      `    printf '%s\\n' '# oh-my-codex' > AGENTS.md`,
      `    printf '%s\\n' '# oh-my-codex' '[mcp_servers.omx_state]' 'command = "node"' 'enabled = true' > .codex/config.toml`,
      `    printf '%s\\n' '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"node hook.js","timeout":30}]}]}}' > .codex/hooks.json`
    );
  }
  setupLines.push('    exit 0 ;;');

  await writeFile(
    executable,
    [
      '#!/bin/sh',
      'case "$*" in',
      '  "--version") echo "oh-my-codex v0.20.1" ;;',
      '  "api --help") echo "Usage: omx api" ;;',
      '  "setup --scope project --merge-agents")',
      ...setupLines,
      '  *) exit 64 ;;',
      'esac',
      '',
    ].join('\n')
  );
  await chmod(executable, 0o755);
}

async function writeFakeCodex(binDir: string): Promise<void> {
  const executable = join(binDir, 'codex');
  await writeFile(
    executable,
    [
      `#!${process.execPath}`,
      `const fs = require('node:fs');`,
      `const readline = require('node:readline');`,
      `const path = require('node:path');`,
      `const codexHome = process.env.CODEX_HOME || path.join(process.env.HOME, '.codex');`,
      `let config = '';`,
      `try { config = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'); } catch {}`,
      `const sectionHas = (header, assignment) => {`,
      `  let active = false;`,
      `  for (const rawLine of config.split(/\\r?\\n/)) {`,
      `    const line = rawLine.trim();`,
      `    if (line.startsWith('[')) active = line === header;`,
      `    else if (active && line === assignment) return true;`,
      `  }`,
      `  return false;`,
      `};`,
      `const input = readline.createInterface({ input: process.stdin });`,
      `input.on('line', (line) => {`,
      `  const message = JSON.parse(line);`,
      `  if (message.id === 1) {`,
      `    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'fake-codex', version: '1' } } }) + '\\n');`,
      `    return;`,
      `  }`,
      `  if (message.id === 2 && message.method === 'hooks/list') {`,
      `    const cwd = message.params.cwds[0];`,
      `    const sourcePath = path.join(cwd, '.codex', 'hooks.json');`,
      `    const key = cwd + ':pre_tool_use:0:0';`,
      `    const hooksEnabled = sectionHas('[features]', 'hooks = true');`,
      `    const projectTrusted = sectionHas('[projects.' + JSON.stringify(cwd) + ']', 'trust_level = "trusted"');`,
      `    const preapproved = sectionHas('[hooks.state.' + JSON.stringify(key) + ']', 'trusted_hash = "sha256:isolated"');`,
      `    const approvedAndEnabled = hooksEnabled && projectTrusted && preapproved;`,
      `    const hooks = fs.existsSync(sourcePath) ? [{ key, command: 'node hook.js', currentHash: 'sha256:isolated', enabled: hooksEnabled && projectTrusted, source: 'project', sourcePath, trustStatus: approvedAndEnabled ? 'trusted' : 'untrusted' }] : [];`,
      `    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { data: [{ cwd, hooks, errors: [] }] } }) + '\\n');`,
      `  }`,
      `});`,
      '',
    ].join('\n')
  );
  await chmod(executable, 0o755);
}

async function createMinimalSnapshot(snapshotDir: string): Promise<void> {
  await mkdir(join(snapshotDir, '.codex', 'agents'), { recursive: true });
  await mkdir(join(snapshotDir, '.codex', 'rules'), { recursive: true });
  await writeFile(join(snapshotDir, '.codex', 'agents', 'sample.md'), '# Snapshot agent\n');
  await writeFile(join(snapshotDir, '.codex', 'rules', 'MUST-sample.md'), 'SNAPSHOT-RULE\n');
}

async function seedPreapprovedCodexHome(
  home: string,
  targetDir: string
): Promise<{ projectRoot: string; hookKey: string }> {
  const projectRoot = await realpath(targetDir);
  const hookKey = `${projectRoot}:pre_tool_use:0:0`;
  await mkdir(join(home, '.codex'), { recursive: true });
  await writeFile(
    join(home, '.codex', 'config.toml'),
    [
      '[features]',
      'hooks = true',
      '',
      `[projects.${JSON.stringify(projectRoot)}]`,
      'trust_level = "trusted"',
      '',
      `[hooks.state.${JSON.stringify(hookKey)}]`,
      'trusted_hash = "sha256:isolated"',
      '',
    ].join('\n')
  );
  return { projectRoot, hookKey };
}

async function treeDigest(root: string): Promise<string> {
  const records: string[] = [];

  async function walk(current: string): Promise<void> {
    const stats = await lstat(current);
    const name = relative(root, current) || '.';
    const mode = (stats.mode & 0o7777).toString(8).padStart(4, '0');
    if (stats.isSymbolicLink()) {
      records.push(`link:${name}:${mode}:${await readlink(current)}`);
      return;
    }
    if (stats.isFile()) {
      const content = await readFile(current);
      records.push(`file:${name}:${mode}:${createHash('sha256').update(content).digest('hex')}`);
      return;
    }
    records.push(`dir:${name}:${mode}`);
    for (const entry of (await readdir(current)).sort()) {
      await walk(join(current, entry));
    }
  }

  await walk(root);
  return createHash('sha256').update(records.join('\n')).digest('hex');
}

async function runSnapshotInstall(
  runner: string,
  targetDir: string,
  snapshotDir: string,
  home: string,
  binDir: string,
  baseEnv: NodeJS.ProcessEnv = process.env
): Promise<SnapshotResult> {
  const output = execFileSync(process.execPath, [runner, targetDir, snapshotDir], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...baseEnv,
      HOME: home,
      CODEX_HOME: join(home, '.codex'),
      PATH: `${binDir}:${dirname(process.execPath)}:/usr/bin:/bin`,
      OMCODEX_REGISTRY_DIR: join(home, '.oh-my-customcodex'),
      NODE_ENV: '',
      BUN_ENV: '',
      CI: '',
    },
  });
  const marker = output.split(/\r?\n/).find((line) => line.startsWith('SNAPSHOT_RESULT:'));
  if (!marker) throw new Error(`Snapshot child result marker missing:\n${output}`);
  return JSON.parse(marker.slice('SNAPSHOT_RESULT:'.length)) as SnapshotResult;
}

describe('snapshot post-copy readiness with isolated HOME/PATH', () => {
  let sandbox: string;
  let home: string;
  let binDir: string;
  let targetDir: string;
  let snapshotDir: string;
  let runner: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'omcodex-snapshot-readiness-'));
    home = join(sandbox, 'home');
    binDir = join(sandbox, 'bin');
    targetDir = join(sandbox, 'target');
    snapshotDir = join(sandbox, 'snapshot');
    runner = join(sandbox, 'run-snapshot.ts');
    await Promise.all(
      [home, binDir, targetDir, snapshotDir].map((directory) =>
        mkdir(directory, { recursive: true })
      )
    );
    await writeFakeCodex(binDir);
    await createMinimalSnapshot(snapshotDir);
    const snapshotModule = new URL('../../src/core/snapshot.ts', import.meta.url).href;
    await writeFile(
      runner,
      [
        `import { installFromSnapshot } from ${JSON.stringify(snapshotModule)};`,
        `const result = await installFromSnapshot(process.argv[2], process.argv[3], { force: true });`,
        `console.log('SNAPSHOT_RESULT:' + JSON.stringify(result));`,
        '',
      ].join('\n')
    );
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('fails a partial real readiness boundary and restores the target byte-for-byte', async () => {
    await writeFakeOmx(binDir, 'partial');
    await mkdir(join(targetDir, '.codex', 'rules'), { recursive: true });
    await mkdir(join(targetDir, '.omx'), { recursive: true });
    await writeFile(join(targetDir, '.codex', 'rules', 'MUST-sample.md'), 'ORIGINAL-RULE\n');
    await writeFile(join(targetDir, '.omx', 'original.json'), '{"original":true}\n');
    await writeFile(join(targetDir, 'AGENTS.md'), 'ORIGINAL-AGENTS\n');
    await writeFile(join(targetDir, '.gitignore'), 'ORIGINAL-IGNORE\n');
    await writeFile(join(targetDir, 'keep.txt'), 'KEEP\n');
    await Promise.all([
      chmod(join(targetDir, '.codex'), 0o700),
      chmod(join(targetDir, '.codex', 'rules'), 0o711),
      chmod(join(targetDir, '.codex', 'rules', 'MUST-sample.md'), 0o600),
    ]);
    const before = await treeDigest(targetDir);

    const result = await runSnapshotInstall(runner, targetDir, snapshotDir, home, binDir);

    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain('OMX project setup remains incomplete');
    expect(await treeDigest(targetDir)).toBe(before);
    expect((await readdir(targetDir)).some((entry) => entry.startsWith('.codex-backup-'))).toBe(
      false
    );
  });

  it('fails complete provisioning without user hook enablement and preapproval, then rolls back', async () => {
    await writeFakeOmx(binDir, 'complete');
    await writeFile(join(targetDir, '.gitignore'), 'ORIGINAL-IGNORE\n');
    await writeFile(join(targetDir, 'keep.txt'), 'KEEP\n');
    const before = await treeDigest(targetDir);

    const result = await runSnapshotInstall(runner, targetDir, snapshotDir, home, binDir);

    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain('need approval');
    expect(result.errors?.[0]).toContain('$CODEX_HOME/config.toml');
    expect(result.errors?.[0]).toContain('[features] hooks = true');
    expect(result.errors?.[0]).toContain('open and trust the project');
    expect(result.errors?.[0]).toContain('/hooks');
    expect(result.errors?.[0]).toContain('retry snapshot installation');
    expect(await treeDigest(targetDir)).toBe(before);
  });

  it('succeeds only with explicit user hook enablement and preapproval, then hashes final state', async () => {
    await writeFakeOmx(binDir, 'complete');
    const { projectRoot, hookKey } = await seedPreapprovedCodexHome(home, targetDir);
    await writeFile(join(targetDir, '.gitignore'), 'ORIGINAL-IGNORE\n');
    await writeFile(join(targetDir, 'keep.txt'), 'KEEP\n');

    const result = await runSnapshotInstall(runner, targetDir, snapshotDir, home, binDir, {
      ...process.env,
      CODEX_HOME: join(sandbox, 'decoy-codex-home'),
    });

    expect(result.success).toBe(true);
    const hooksPath = join(targetDir, '.codex', 'hooks.json');
    const hooksHash = createHash('sha256')
      .update(await readFile(hooksPath))
      .digest('hex');
    const lockfile = JSON.parse(await readFile(join(targetDir, '.omcodex.lock.json'), 'utf8')) as {
      files: Record<string, { templateHash: string }>;
    };
    expect(lockfile.files['.codex/hooks.json']?.templateHash).toBe(hooksHash);
    expect(await readFile(join(targetDir, '.omx', 'setup-scope.json'), 'utf8')).toContain(
      '"scope":"project"'
    );
    const gitignore = await readFile(join(targetDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('ORIGINAL-IGNORE');
    expect(gitignore).toContain('.omx/');
    expect(gitignore).toContain('!.codex/agents/**');
    expect(await readFile(join(targetDir, 'keep.txt'), 'utf8')).toBe('KEEP\n');
    expect(await readFile(join(home, '.oh-my-customcodex', 'projects.json'), 'utf8')).toContain(
      targetDir
    );
    const userConfig = await readFile(join(home, '.codex', 'config.toml'), 'utf8');
    expect(userConfig).toContain('[features]');
    expect(userConfig).toContain('hooks = true');
    expect(userConfig).toContain(`[projects.${JSON.stringify(projectRoot)}]`);
    expect(userConfig).toContain(`[hooks.state.${JSON.stringify(hookKey)}]`);
    expect(userConfig).toContain('trusted_hash = "sha256:isolated"');
  });
});
