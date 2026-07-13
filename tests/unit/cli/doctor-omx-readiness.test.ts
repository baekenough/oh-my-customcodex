import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkOmx } from '../../../src/cli/doctor.ts';
import { type InstallerDeps, OMX_PROJECT_SETUP_COMMAND } from '../../../src/core/omx-installer.ts';

const deps: InstallerDeps = {
  exec: (command) => {
    if (command === 'which omx') return '/tmp/bin/omx';
    if (command === 'omx --version') return 'oh-my-codex v0.20.1';
    if (command === 'omx api --help') return 'Usage: omx api';
    throw new Error(`Unexpected command: ${command}`);
  },
  getPlatform: () => 'linux',
};

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

describe('doctor complete OMX readiness', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'omcodex-doctor-omx-readiness-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('warns for a binary-only OMX install and gives the exact setup command', async () => {
    const result = await checkOmx(projectRoot, deps);

    expect(result.status).toBe('warn');
    expect(result.message).toContain('project setup incomplete');
    expect(result.message).toContain(OMX_PROJECT_SETUP_COMMAND);
    expect(result.details).toContain('missing: .codex/prompts/*.md');
    expect(result.details).toContain('missing: native hooks delivery');
    expect(result.details).toContain('missing: configured OMX MCP policy');
  });

  it('passes only for a complete project fixture', async () => {
    await writeCompleteProject(projectRoot);

    const result = await checkOmx(projectRoot, deps);

    expect(result.status).toBe('pass');
    expect(result.message).toContain('project setup ready');
  });
});
