import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assessOmxReadiness,
  ensureOmxProjectReady,
  type InstallerDeps,
} from '../../src/core/omx-installer.ts';

function isolatedDeps(home: string, binDir: string): InstallerDeps {
  return {
    exec: (command, options) =>
      execSync(command, {
        ...options,
        env: {
          HOME: home,
          PATH: `${binDir}:/usr/bin:/bin`,
        },
      }),
    getPlatform: () => 'linux',
  };
}

type FakeSetupMode = 'unsupported' | 'no-surfaces' | 'complete';

async function writeFakeOmx(
  binDir: string,
  setupMode: FakeSetupMode = 'unsupported'
): Promise<void> {
  const executable = join(binDir, 'omx');
  const setupLines =
    setupMode === 'complete'
      ? [
          '    mkdir -p .codex/prompts .codex/skills/plan .codex/agents',
          "    printf '%s\\n' '# Executor' > .codex/prompts/executor.md",
          "    printf '%s\\n' '# Plan' > .codex/skills/plan/SKILL.md",
          `    printf '%s\\n' 'name = "executor"' 'description = "Implement"' 'developer_instructions = "Verify."' > .codex/agents/executor.toml`,
          "    printf '%s\\n' '# oh-my-codex' > AGENTS.md",
          `    printf '%s\\n' '# oh-my-codex' '[mcp_servers.omx_state]' 'command = "node"' 'enabled = true' > .codex/config.toml`,
          `    printf '%s\\n' '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"node hook.js","timeout":30}]}]}}' > .codex/hooks.json`,
          '    exit 0 ;;',
        ]
      : setupMode === 'no-surfaces'
        ? ['    exit 0 ;;']
        : ['    exit 64 ;;'];
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

async function writeCompleteProject(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, '.codex', 'prompts'), { recursive: true });
  await writeFile(join(projectRoot, '.codex', 'prompts', 'executor.md'), '# Executor\n');
  await mkdir(join(projectRoot, '.codex', 'skills', 'plan'), { recursive: true });
  await writeFile(join(projectRoot, '.codex', 'skills', 'plan', 'SKILL.md'), '# Plan\n');
  await mkdir(join(projectRoot, '.codex', 'agents'), { recursive: true });
  await writeFile(
    join(projectRoot, '.codex', 'agents', 'executor.toml'),
    'name = "executor"\ndescription = "Implement"\ndeveloper_instructions = "Verify."\n'
  );
  await writeFile(join(projectRoot, 'AGENTS.md'), '# oh-my-codex\n');
  await writeFile(
    join(projectRoot, '.codex', 'config.toml'),
    '# oh-my-codex\n[mcp_servers.omx_state]\ncommand = "node"\nenabled = true\n'
  );
  await writeFile(
    join(projectRoot, '.codex', 'hooks.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'node hook.js', timeout: 30 }] }],
      },
    })
  );
}

describe('isolated HOME/PATH OMX readiness', () => {
  let sandbox: string;
  let home: string;
  let binDir: string;
  let projectRoot: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'omcodex-omx-isolated-'));
    home = join(sandbox, 'home');
    binDir = join(sandbox, 'bin');
    projectRoot = join(sandbox, 'project');
    await Promise.all([
      mkdir(home, { recursive: true }),
      mkdir(binDir, { recursive: true }),
      mkdir(projectRoot, { recursive: true }),
    ]);
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('distinguishes absent, binary-only, and complete setup without the real HOME', async () => {
    const deps = isolatedDeps(home, binDir);

    expect(assessOmxReadiness(projectRoot, deps).status).toBe('missing');

    await writeFakeOmx(binDir);
    const binaryOnly = assessOmxReadiness(projectRoot, deps);
    expect(binaryOnly.capability.status).toBe('ready');
    expect(binaryOnly.status).toBe('partial');
    expect(binaryOnly.ready).toBe(false);
    expect(binaryOnly.project.missingSurfaces).toHaveLength(7);

    await writeCompleteProject(projectRoot);
    const complete = assessOmxReadiness(projectRoot, deps);
    expect(complete.status).toBe('ready');
    expect(complete.ready).toBe(true);
  });

  it('fails when fake setup exits zero without delivering project surfaces', async () => {
    await writeFakeOmx(binDir, 'no-surfaces');

    const result = ensureOmxProjectReady(projectRoot, isolatedDeps(home, binDir));

    expect(result.attempted).toBe(true);
    expect(result.success).toBe(false);
    expect(result.command).toBe('omx setup --scope project --merge-agents');
    expect(result.assessment.status).toBe('partial');
    expect(result.assessment.project.missingSurfaces).toHaveLength(7);
  });

  it('becomes ready only after fake setup writes every required surface', async () => {
    await writeFakeOmx(binDir, 'complete');
    const deps = isolatedDeps(home, binDir);

    expect(assessOmxReadiness(projectRoot, deps).status).toBe('partial');

    const result = ensureOmxProjectReady(projectRoot, deps);

    expect(result.attempted).toBe(true);
    expect(result.success).toBe(true);
    expect(result.assessment.status).toBe('ready');
    expect(result.assessment.project.missingSurfaces).toEqual([]);
  });
});
