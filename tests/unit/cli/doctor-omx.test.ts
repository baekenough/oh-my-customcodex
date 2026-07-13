import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkOmx, checkOmxModelRouting } from '../../../src/cli/doctor.js';
import type { InstallerDeps } from '../../../src/core/omx-installer.js';

function depsFor(commands: Record<string, string | Error>): InstallerDeps {
  return {
    exec: (command) => {
      const result = commands[command];
      if (result instanceof Error || result === undefined) {
        throw result ?? new Error(`Unexpected command: ${command}`);
      }
      return result;
    },
    getPlatform: () => 'linux',
    inspectHooks: () => [
      {
        key: 'project:PreToolUse:0:0',
        command: 'node hook.js',
        currentHash: 'sha256:trusted',
        enabled: true,
        source: 'project',
        sourcePath: '.codex/hooks.json',
        trustStatus: 'trusted',
      },
    ],
  };
}

async function withProject(run: (projectRoot: string) => Promise<void>): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'omcodex-doctor-omx-'));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
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

describe('doctor OMX baseline checks', () => {
  it('warns when OMX is below the required v0.19.0 baseline', async () => {
    await withProject(async (projectRoot) => {
      const result = await checkOmx(
        projectRoot,
        depsFor({
          'which omx': '/usr/local/bin/omx',
          'omx --version': 'oh-my-codex v0.17.3',
        })
      );

      expect(result.status).toBe('warn');
      expect(result.fixable).toBe(true);
      expect(result.message).toContain('v0.19.0');
    });
  });

  it('warns when OMX is new enough but lacks omx api', async () => {
    await withProject(async (projectRoot) => {
      const result = await checkOmx(
        projectRoot,
        depsFor({
          'which omx': '/usr/local/bin/omx',
          'omx --version': 'oh-my-codex v0.19.0',
          'omx api --help': new Error('unknown command'),
        })
      );

      expect(result.status).toBe('warn');
      expect(result.fixable).toBe(true);
      expect(result.message).toContain('omx api');
    });
  });

  it('passes only when the binary and project setup both meet the OMX contract', async () => {
    await withProject(async (projectRoot) => {
      await writeCompleteProject(projectRoot);
      const result = await checkOmx(
        projectRoot,
        depsFor({
          'which omx': '/usr/local/bin/omx',
          'omx --version': 'oh-my-codex v0.19.0',
          'omx api --help': 'Usage: omx api',
        })
      );

      expect(result.status).toBe('pass');
      expect(result.fixable).toBe(false);
      expect(result.message).toContain('project setup ready');
    });
  });
});

describe('doctor OMX model lane diagnostics', () => {
  const originalFrontier = process.env.OMX_DEFAULT_FRONTIER_MODEL;
  const originalSpark = process.env.OMX_DEFAULT_SPARK_MODEL;
  const originalLegacySpark = process.env.OMX_SPARK_MODEL;

  afterEach(() => {
    if (originalFrontier === undefined) delete process.env.OMX_DEFAULT_FRONTIER_MODEL;
    else process.env.OMX_DEFAULT_FRONTIER_MODEL = originalFrontier;
    if (originalSpark === undefined) delete process.env.OMX_DEFAULT_SPARK_MODEL;
    else process.env.OMX_DEFAULT_SPARK_MODEL = originalSpark;
    if (originalLegacySpark === undefined) delete process.env.OMX_SPARK_MODEL;
    else process.env.OMX_SPARK_MODEL = originalLegacySpark;
  });

  it('reports runtime defaults when model lane env overrides are absent', () => {
    delete process.env.OMX_DEFAULT_FRONTIER_MODEL;
    delete process.env.OMX_DEFAULT_SPARK_MODEL;
    delete process.env.OMX_SPARK_MODEL;

    const result = checkOmxModelRouting();

    expect(result.status).toBe('pass');
    expect(result.message).toContain('runtime defaults');
  });

  it('warns when frontier and spark lanes are explicitly collapsed to one model', () => {
    process.env.OMX_DEFAULT_FRONTIER_MODEL = 'gpt-5.5';
    process.env.OMX_DEFAULT_SPARK_MODEL = 'gpt-5.5';
    delete process.env.OMX_SPARK_MODEL;

    const result = checkOmxModelRouting();

    expect(result.status).toBe('warn');
    expect(result.message).toContain('Spark/model lane routing');
    expect(result.details).toContain('frontier=gpt-5.5');
    expect(result.details).toContain('spark=gpt-5.5');
  });

  it('reports legacy spark env compatibility without failing doctor', () => {
    process.env.OMX_DEFAULT_FRONTIER_MODEL = 'gpt-5.5';
    delete process.env.OMX_DEFAULT_SPARK_MODEL;
    process.env.OMX_SPARK_MODEL = 'gpt-5.3-codex-spark';

    const result = checkOmxModelRouting();

    expect(result.status).toBe('pass');
    expect(result.details).toContain(
      'legacy OMX_SPARK_MODEL detected; prefer OMX_DEFAULT_SPARK_MODEL'
    );
  });
});
