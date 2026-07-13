import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAgentMarkdown,
  getAgentModelOptions,
  parseNaturalLanguage,
} from '../../../packages/serve/src/lib/server/agent-generator.js';

const tempDirectories: string[] = [];

async function isolatedCodexHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'omcodex-serve-agent-model-'));
  tempDirectories.push(directory);
  return directory;
}

async function fakeOmxPath(defaultSparkModel = 'spark-web-contract'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'omcodex-serve-fake-omx-'));
  tempDirectories.push(root);
  const packageRoot = join(root, 'oh-my-codex');
  const binDir = join(root, 'bin');
  const cliDir = join(packageRoot, 'dist', 'cli');
  const configDir = join(packageRoot, 'dist', 'config');
  await Promise.all([
    mkdir(binDir, { recursive: true }),
    mkdir(cliDir, { recursive: true }),
    mkdir(configDir, { recursive: true }),
  ]);
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: 'oh-my-codex' }));
  await writeFile(join(cliDir, 'omx.js'), '#!/usr/bin/env node\n');
  await writeFile(
    join(configDir, 'models.js'),
    `export const DEFAULT_SPARK_MODEL = ${JSON.stringify(defaultSparkModel)};\n`
  );
  const shim = join(binDir, 'omx');
  await writeFile(shim, `#!/bin/sh\nexec node '${join(cliDir, 'omx.js')}' "$@"\n`);
  await chmod(shim, 0o755);
  return binDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('Codex-native Web agent generation metadata', () => {
  it('offers runtime inheritance plus current OMX frontier and spark inventory', async () => {
    const environment = {
      CODEX_HOME: await isolatedCodexHome(),
      OMX_DEFAULT_FRONTIER_MODEL: 'gpt-current-frontier',
      OMX_DEFAULT_SPARK_MODEL: 'gpt-current-spark',
    };

    expect(getAgentModelOptions(environment)).toEqual([
      {
        value: '',
        lane: 'inherit',
        label: 'Inherit Codex runtime model',
        defaultReasoningEffort: 'medium',
      },
      {
        value: 'gpt-current-frontier',
        lane: 'frontier',
        label: 'Frontier · gpt-current-frontier',
        defaultReasoningEffort: 'medium',
      },
      {
        value: 'gpt-current-spark',
        lane: 'spark',
        label: 'Spark · gpt-current-spark',
        defaultReasoningEffort: 'low',
      },
    ]);
  });

  it('uses configured model lanes and native effort instead of legacy provider aliases', async () => {
    const environment = {
      CODEX_HOME: await isolatedCodexHome(),
      OMX_DEFAULT_FRONTIER_MODEL: 'gpt-current-frontier',
      OMX_DEFAULT_SPARK_MODEL: 'gpt-current-spark',
    };
    const complex = parseNaturalLanguage('Complex architecture analysis agent', environment);
    const fast = parseNaturalLanguage('Fast lightweight search agent', environment);

    expect(complex).toMatchObject({
      model: 'gpt-current-frontier',
      modelReasoningEffort: 'high',
    });
    expect(fast).toMatchObject({
      model: 'gpt-current-spark',
      modelReasoningEffort: 'low',
    });
    expect(buildAgentMarkdown(complex)).toContain(
      'model: gpt-current-frontier\nmodel_reasoning_effort: high'
    );
  });

  it('uses the shared installed OMX contract resolver for Web inventory and fast routing', async () => {
    const environment = {
      CODEX_HOME: await isolatedCodexHome(),
      PATH: await fakeOmxPath(),
    };

    expect(getAgentModelOptions(environment)).toEqual([
      {
        value: '',
        lane: 'inherit',
        label: 'Inherit Codex runtime model',
        defaultReasoningEffort: 'medium',
      },
      {
        value: 'spark-web-contract',
        lane: 'spark',
        label: 'Spark · spark-web-contract',
        defaultReasoningEffort: 'low',
      },
    ]);
    expect(parseNaturalLanguage('Fast lightweight search agent', environment)).toMatchObject({
      model: 'spark-web-contract',
      modelReasoningEffort: 'low',
    });
  });

  it('omits a model pin while preserving effort when no runtime lane is configured', async () => {
    const generated = parseNaturalLanguage('General purpose agent', {
      CODEX_HOME: await isolatedCodexHome(),
    });
    const markdown = buildAgentMarkdown(generated);

    expect(generated.model).toBe('');
    expect(markdown).not.toContain('\nmodel:');
    expect(markdown).toContain('model_reasoning_effort: medium');
    expect(getAgentModelOptions({ CODEX_HOME: await isolatedCodexHome() })).toHaveLength(1);
  });

  it('fails closed for fast routing when no spark contract is discoverable', async () => {
    const codexHome = await isolatedCodexHome();
    expect(() =>
      parseNaturalLanguage('Fast lightweight search agent', {
        CODEX_HOME: codexHome,
        PATH: '',
      })
    ).toThrow('Spark model lane is unavailable');
  });
});
