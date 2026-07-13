import { afterEach, describe, expect, it } from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import {
  compileMarkdownAgent,
  getConfiguredModelLanes,
  NATIVE_AGENT_GENERATED_HEADER,
  parseNativeAgentListMetadata,
  syncNativeAgents,
} from '../../../src/core/agent-compiler.js';

const tempDirectories: string[] = [];

async function createTempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

async function createFakeOmxContract(
  options: {
    defaultSparkModel?: string;
    executable?: 'wrapper' | 'symlink';
    packageName?: string;
  } = {}
): Promise<{
  binDir: string;
  packageRoot: string;
}> {
  const {
    defaultSparkModel = 'spark-contract-default',
    executable = 'wrapper',
    packageName = 'oh-my-codex',
  } = options;
  const root = await createTempDirectory('omcodex-fake-omx-contract-');
  const packageRoot = join(root, 'oh-my-codex');
  const binDir = join(root, 'bin');
  const cliDir = join(packageRoot, 'dist', 'cli');
  const configDir = join(packageRoot, 'dist', 'config');
  await Promise.all([
    mkdir(binDir, { recursive: true }),
    mkdir(cliDir, { recursive: true }),
    mkdir(configDir, { recursive: true }),
  ]);
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: packageName }));
  const cliEntrypoint = join(cliDir, 'omx.js');
  await writeFile(cliEntrypoint, '#!/usr/bin/env node\n');
  await chmod(cliEntrypoint, 0o755);
  await writeFile(
    join(configDir, 'models.js'),
    `export const DEFAULT_SPARK_MODEL = ${JSON.stringify(defaultSparkModel)};\n`
  );
  const shim = join(binDir, 'omx');
  if (executable === 'symlink') {
    await symlink(cliEntrypoint, shim);
  } else {
    await writeFile(shim, `#!/bin/sh\nexec node '${cliEntrypoint}' "$@"\n`);
    await chmod(shim, 0o755);
  }
  return { binDir, packageRoot };
}

function sourceAgent(
  name: string,
  overrides: string[] = [],
  body = 'Follow the requested role.\n\nKeep changes focused.'
): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${name} description`,
    'model: sonnet',
    'domain: universal',
    'effort: high',
    'tools: [Read, Write, Edit, Grep, Glob, Bash]',
    'permissionMode: bypassPermissions',
    ...overrides,
    '---',
    '',
    body,
    '',
  ].join('\n');
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

describe('compileMarkdownAgent', () => {
  it('emits parseable deterministic TOML with required fields and round-tripped instructions', () => {
    const markdown = sourceAgent(
      'qa-native-agent',
      [],
      'First line with "quotes" and \\slashes.\n\nSecond line: 안녕하세요.'
    ).replace(
      'description: qa-native-agent description',
      'description: "Review \\"quoted\\" text and C:\\\\tmp"'
    );

    const first = compileMarkdownAgent(markdown, {
      sourceFilename: 'qa-native-agent.md',
      modelLanes: { frontier: 'gpt-frontier-current', spark: 'gpt-spark-current' },
    });
    const second = compileMarkdownAgent(markdown, {
      sourceFilename: 'qa-native-agent.md',
      modelLanes: { frontier: 'gpt-frontier-current', spark: 'gpt-spark-current' },
    });
    const parsed = Bun.TOML.parse(first.toml) as Record<string, unknown>;

    expect(first.toml).toBe(second.toml);
    expect(first.filename).toBe('qa-native-agent.toml');
    expect(parsed.name).toBe('qa-native-agent');
    expect(parsed.description).toBe('Review "quoted" text and C:\\tmp');
    expect(parsed.developer_instructions).toBe(
      'First line with "quotes" and \\slashes.\n\nSecond line: 안녕하세요.'
    );
    expect(first.toml.endsWith('\n')).toBe(true);
  });

  it('resolves Claude model aliases through explicit OMX lanes without stale literals', () => {
    const sonnet = compileMarkdownAgent(sourceAgent('frontier-agent'), {
      modelLanes: { frontier: 'gpt-live-frontier', spark: 'gpt-live-spark' },
    });
    const haiku = compileMarkdownAgent(
      sourceAgent('spark-agent').replace('model: sonnet', 'model: haiku'),
      { modelLanes: { frontier: 'gpt-live-frontier', spark: 'gpt-live-spark' } }
    );
    const inherited = compileMarkdownAgent(sourceAgent('inherited-agent'), { modelLanes: {} });

    expect(sonnet.config.model).toBe('gpt-live-frontier');
    expect(haiku.config.model).toBe('gpt-live-spark');
    expect(inherited.config.model).toBeUndefined();
    expect(sonnet.toml).not.toContain('sonnet');
    expect(haiku.toml).not.toContain('haiku');
  });

  it('reads current OMX model lane environment names with a legacy spark fallback', async () => {
    const codexHome = await createTempDirectory('omcodex-native-agent-model-env-');
    expect(
      getConfiguredModelLanes(
        {
          OMX_DEFAULT_FRONTIER_MODEL: 'gpt-current-frontier',
          OMX_DEFAULT_SPARK_MODEL: 'gpt-current-spark',
          OMX_SPARK_MODEL: 'gpt-legacy-spark',
        },
        codexHome
      )
    ).toEqual({ frontier: 'gpt-current-frontier', spark: 'gpt-current-spark' });
    expect(getConfiguredModelLanes({ OMX_SPARK_MODEL: 'gpt-legacy-spark' }, codexHome)).toEqual({
      frontier: undefined,
      spark: 'gpt-legacy-spark',
    });
    expect(getConfiguredModelLanes({}, codexHome)).toEqual({
      frontier: undefined,
      spark: undefined,
    });
  });

  it('reads a fake installed OMX contract while preserving env and config precedence', async () => {
    const codexHome = await createTempDirectory('omcodex-native-agent-fake-omx-home-');
    const { binDir } = await createFakeOmxContract();
    const lanes = getConfiguredModelLanes({ PATH: binDir }, codexHome);

    expect(lanes.spark).toBe('spark-contract-default');
    const supplier = await readFile(
      join(import.meta.dir, '../../../.codex/agents/mgr-supplier.md'),
      'utf8'
    );
    expect(
      compileMarkdownAgent(supplier, {
        sourceFilename: 'mgr-supplier.md',
        modelLanes: lanes,
      }).config.model
    ).toBe('spark-contract-default');
    await writeFile(
      join(codexHome, '.omx-config.json'),
      JSON.stringify({ models: { team_low_complexity: 'spark-config-override' } })
    );
    expect(getConfiguredModelLanes({ PATH: binDir }, codexHome).spark).toBe(
      'spark-config-override'
    );
    expect(
      getConfiguredModelLanes(
        { PATH: binDir, OMX_DEFAULT_SPARK_MODEL: 'spark-env-override' },
        codexHome
      ).spark
    ).toBe('spark-env-override');
  });

  it('continues past an invalid PATH candidate and accepts a direct OMX entrypoint symlink', async () => {
    const codexHome = await createTempDirectory('omcodex-native-agent-symlink-omx-home-');
    const invalid = await createFakeOmxContract({
      defaultSparkModel: 'invalid-contract-default',
      packageName: 'not-oh-my-codex',
    });
    const valid = await createFakeOmxContract({
      defaultSparkModel: 'spark-symlink-contract',
      executable: 'symlink',
    });

    expect(
      getConfiguredModelLanes({ PATH: `${invalid.binDir}${delimiter}${valid.binDir}` }, codexHome)
        .spark
    ).toBe('spark-symlink-contract');
  });

  it('fails closed instead of collapsing an unresolved spark role into inheritance', () => {
    expect(() =>
      compileMarkdownAgent(
        sourceAgent('missing-spark')
          .replace('model: sonnet', 'model_lane: spark')
          .replace('effort: high', 'model_reasoning_effort: low'),
        { modelLanes: {} }
      )
    ).toThrow('Spark model lane is unavailable');
  });

  it('resolves no-env model lanes from Codex and OMX config before current defaults', async () => {
    const codexHome = await createTempDirectory('omcodex-native-agent-model-config-');
    await writeFile(join(codexHome, 'config.toml'), 'model = "gpt-config-frontier"\n');
    await writeFile(
      join(codexHome, '.omx-config.json'),
      JSON.stringify({ models: { team_low_complexity: 'gpt-config-spark' } })
    );

    expect(getConfiguredModelLanes({}, codexHome)).toEqual({
      frontier: 'gpt-config-frontier',
      spark: 'gpt-config-spark',
    });
    expect(
      compileMarkdownAgent(
        sourceAgent('configured-spark').replace('model: sonnet', 'model: haiku'),
        {
          modelLanes: getConfiguredModelLanes({}, codexHome),
        }
      ).config.model
    ).toBe('gpt-config-spark');
  });

  it('matches the OMX model table precedence when config and frontier env conflict', async () => {
    const codexHome = await createTempDirectory('omcodex-native-agent-model-precedence-');
    await writeFile(join(codexHome, 'config.toml'), 'model = "gpt-generated-config"\n');

    expect(
      getConfiguredModelLanes({ OMX_DEFAULT_FRONTIER_MODEL: 'gpt-env-frontier' }, codexHome)
        .frontier
    ).toBe('gpt-generated-config');
  });

  it('keeps generated TOML consistent with the active runtime lanes and reasoning effort', async () => {
    const codexHome = await createTempDirectory('omcodex-native-agent-runtime-table-');
    await writeFile(join(codexHome, 'config.toml'), 'model = "gpt-runtime-frontier"\n');
    await writeFile(
      join(codexHome, '.omx-config.json'),
      JSON.stringify({ env: { OMX_DEFAULT_SPARK_MODEL: 'gpt-runtime-spark' } })
    );
    const modelLanes = getConfiguredModelLanes({}, codexHome);

    const frontier = Bun.TOML.parse(
      compileMarkdownAgent(
        sourceAgent('runtime-frontier').replace('model: sonnet', 'model_lane: frontier'),
        { modelLanes }
      ).toml
    ) as Record<string, unknown>;
    const spark = Bun.TOML.parse(
      compileMarkdownAgent(
        sourceAgent('runtime-spark')
          .replace('model: sonnet', 'model_lane: spark')
          .replace('effort: high', 'model_reasoning_effort: low'),
        { modelLanes }
      ).toml
    ) as Record<string, unknown>;

    expect(modelLanes).toEqual({
      frontier: 'gpt-runtime-frontier',
      spark: 'gpt-runtime-spark',
    });
    expect(frontier).toMatchObject({
      model: modelLanes.frontier,
      model_reasoning_effort: 'high',
    });
    expect(spark).toMatchObject({
      model: modelLanes.spark,
      model_reasoning_effort: 'low',
    });
  });

  it('accepts the complete Codex reasoning-effort vocabulary', () => {
    for (const effort of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'ultra', 'max']) {
      const compiled = compileMarkdownAgent(
        sourceAgent(`effort-${effort}`).replace(
          'effort: high',
          `model_reasoning_effort: ${effort}`
        ),
        { modelLanes: {} }
      );
      expect(compiled.config.model_reasoning_effort).toBe(effort);
    }
  });

  it('fails closed when native and compatibility model metadata conflict', () => {
    expect(() =>
      compileMarkdownAgent(sourceAgent('conflicting-model', ['model_lane: spark']), {
        modelLanes: { frontier: 'gpt-frontier', spark: 'gpt-spark' },
      })
    ).toThrow('model and model_lane conflict');
  });

  it('maps Claude permissions conservatively and never emits Claude tool keys', () => {
    const writable = compileMarkdownAgent(sourceAgent('writable-agent'), { modelLanes: {} });
    const readonly = compileMarkdownAgent(
      sourceAgent('readonly-agent')
        .replace('tools: [Read, Write, Edit, Grep, Glob, Bash]', 'tools: [Read, Grep, Glob]')
        .replace('permissionMode: bypassPermissions', 'permissionMode: default'),
      { modelLanes: {} }
    );
    const parsed = Bun.TOML.parse(writable.toml) as Record<string, unknown>;

    expect(writable.config.sandbox_mode).toBe('workspace-write');
    expect(readonly.config.sandbox_mode).toBe('read-only');
    expect(parsed.tools).toBeUndefined();
    expect(parsed.disallowedTools).toBeUndefined();
    expect(parsed.permissionMode).toBeUndefined();
    expect(() =>
      compileMarkdownAgent(sourceAgent('unsafe-agent', ['sandbox_mode: danger-full-access']), {
        modelLanes: {},
      })
    ).toThrow('danger-full-access');
  });

  it('converts skill names and validated MCP configuration to native config tables', () => {
    const markdown = sourceAgent('docs-agent', [
      'skills:',
      '  - openai-docs',
      '  - omcodex:npm-audit',
      'mcp_servers:',
      '  docs:',
      '    url: https://developers.openai.com/mcp',
      '    enabled: true',
      '    startup_timeout_sec: 20',
      '    enabled_tools: [search, open]',
      '    http_headers:',
      '      X-Client: omcustomcodex',
    ]);

    const compiled = compileMarkdownAgent(markdown, { modelLanes: {} });
    const parsed = Bun.TOML.parse(compiled.toml) as {
      skills: { config: Array<{ path: string; enabled: boolean }> };
      mcp_servers: Record<string, Record<string, unknown>>;
    };

    expect(parsed.skills.config).toEqual([
      { path: '../../.agents/skills/openai-docs/SKILL.md', enabled: true },
      { path: '../../.agents/skills/npm-audit/SKILL.md', enabled: true },
    ]);
    expect(parsed.mcp_servers.docs.url).toBe('https://developers.openai.com/mcp');
    expect(parsed.mcp_servers.docs.enabled_tools).toEqual(['search', 'open']);
    expect(parsed.mcp_servers.docs.http_headers).toEqual({ 'X-Client': 'omcustomcodex' });
  });

  it('exposes native TOML metadata for list integration without reading Markdown', () => {
    const compiled = compileMarkdownAgent(sourceAgent('listed-agent'), { modelLanes: {} });

    expect(parseNativeAgentListMetadata(compiled.toml)).toEqual({
      name: 'listed-agent',
      description: 'listed-agent description',
    });
    expect(
      parseNativeAgentListMetadata(
        "name = 'custom-agent'\ndescription = 'Custom native role'\n[[skills.config]]\npath = '.agents/skills/test'\n"
      )
    ).toEqual({ name: 'custom-agent', description: 'Custom native role' });
    expect(() => parseNativeAgentListMetadata('name = "missing-description"\n')).toThrow(
      'requires name and description'
    );
  });

  it('fails closed for malformed native fields and filename drift', () => {
    expect(() => compileMarkdownAgent('No frontmatter')).toThrow('YAML frontmatter');
    expect(() =>
      compileMarkdownAgent(sourceAgent('declared-name'), {
        sourceFilename: 'different-name.md',
      })
    ).toThrow('filename/name mismatch');
    expect(() =>
      compileMarkdownAgent(sourceAgent('bad-effort').replace('effort: high', 'effort: extreme'))
    ).toThrow('model_reasoning_effort');
    expect(() =>
      compileMarkdownAgent(sourceAgent('bad-permission').replace('bypassPermissions', 'plan'))
    ).toThrow('Unsupported Claude permissionMode');
    expect(() =>
      compileMarkdownAgent(
        sourceAgent('bad-mcp', ['mcp_servers:', '  docs:', '    url: file:///tmp/server']),
        { modelLanes: {} }
      )
    ).toThrow('http or https');
    expect(() =>
      compileMarkdownAgent(
        sourceAgent('bad-http-mcp', [
          'mcp_servers:',
          '  docs:',
          '    url: https://developers.openai.com/mcp',
          '    args: [serve]',
        ]),
        { modelLanes: {} }
      )
    ).toThrow('not valid for HTTP transport');
    expect(() =>
      compileMarkdownAgent(
        sourceAgent('bad-stdio-mcp', [
          'mcp_servers:',
          '  local:',
          '    command: node',
          '    http_headers:',
          '      X-Test: invalid',
        ]),
        { modelLanes: {} }
      )
    ).toThrow('not valid for stdio transport');
  });

  it('validates parsed domain values and only defaults an absent domain', () => {
    expect(
      compileMarkdownAgent(
        sourceAgent('quoted-domain').replace('domain: universal', 'domain: "backend"'),
        {
          modelLanes: {},
        }
      ).domain
    ).toBe('backend');
    expect(
      compileMarkdownAgent(sourceAgent('absent-domain').replace('domain: universal\n', ''), {
        modelLanes: {},
      }).domain
    ).toBe('universal');
    expect(() =>
      compileMarkdownAgent(
        sourceAgent('typo-domain').replace('domain: universal', 'domain: backnd'),
        {
          modelLanes: {},
        }
      )
    ).toThrow('Invalid agent domain');
  });

  it('rejects Unicode scalars that strict TOML cannot represent', () => {
    expect(() =>
      compileMarkdownAgent(
        sourceAgent('del-agent').replace('del-agent description', 'invalid\u007fdescription'),
        { modelLanes: {} }
      )
    ).toThrow('forbidden control characters');
    expect(() =>
      compileMarkdownAgent(
        sourceAgent('surrogate-agent', [], `invalid${String.fromCharCode(0xd800)}`),
        {
          modelLanes: {},
        }
      )
    ).toThrow('unpaired Unicode surrogates');
  });
});

describe('managed agent drift', () => {
  it('compiles every packaged Markdown agent one-to-one with stable parseable bytes', async () => {
    const sourceDir = join(import.meta.dir, '../../../templates/.claude/agents');
    const nativeSourceDir = join(import.meta.dir, '../../../.codex/agents');
    const skillDir = join(import.meta.dir, '../../../templates/.claude/skills');
    const sourceFiles = (await readdir(sourceDir)).filter((name) => name.endsWith('.md')).sort();
    const nativeNames = new Set<string>();

    for (const sourceFilename of sourceFiles) {
      const markdown = await readFile(join(sourceDir, sourceFilename), 'utf8');
      const nativeMarkdown = await readFile(join(nativeSourceDir, sourceFilename), 'utf8');
      const options = {
        sourceFilename,
        modelLanes: { frontier: 'gpt-current-frontier', spark: 'gpt-current-spark' },
      };
      const first = compileMarkdownAgent(markdown, options);
      const second = compileMarkdownAgent(markdown, options);
      const native = compileMarkdownAgent(nativeMarkdown, options);
      const parsed = Bun.TOML.parse(first.toml) as {
        name: string;
        description: string;
        developer_instructions: string;
        model?: string;
        skills?: { config: Array<{ path: string }> };
      };

      expect(first.toml).toBe(second.toml);
      expect(native.toml).toBe(first.toml);
      expect(first.filename).toBe(sourceFilename.replace(/\.md$/, '.toml'));
      expect(parsed.name).toBe(sourceFilename.replace(/\.md$/, ''));
      expect(parsed.description.length).toBeGreaterThan(0);
      expect(parsed.developer_instructions.length).toBeGreaterThan(0);
      expect(parsed.model).not.toBe('sonnet');
      expect(parsed.model).not.toBe('haiku');
      expect(nativeNames.has(parsed.name)).toBe(false);
      nativeNames.add(parsed.name);

      for (const skill of parsed.skills?.config ?? []) {
        const installedFolder = skill.path
          .replace(/^\.\.\/\.\.\/\.agents\/skills\//, '')
          .replace(/\/SKILL\.md$/, '');
        expect(await Bun.file(join(skillDir, installedFolder, 'SKILL.md')).exists()).toBe(true);
        expect(resolve('/project/.codex/agents', skill.path)).toBe(
          join('/project/.agents/skills', installedFolder, 'SKILL.md')
        );
      }
    }

    expect(nativeNames.size).toBe(sourceFiles.length);
  });
});

describe('syncNativeAgents', () => {
  it('regenerates managed drift, removes stale managed roles, and preserves custom TOML', async () => {
    const root = await createTempDirectory('omcodex-native-agent-sync-');
    const sourceDir = join(root, 'sources');
    const destinationDir = join(root, '.codex', 'agents');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, 'backend-agent.md'), sourceAgent('backend-agent'));
    await writeFile(join(sourceDir, 'universal-agent.md'), sourceAgent('universal-agent'));

    const initial = await syncNativeAgents({
      sourceDir,
      destinationDir,
      targetRoot: root,
      modelLanes: { frontier: 'gpt-frontier', spark: 'gpt-spark' },
    });
    expect(initial.written).toEqual(['backend-agent.toml', 'universal-agent.toml']);

    await writeFile(
      join(destinationDir, 'backend-agent.toml'),
      `${NATIVE_AGENT_GENERATED_HEADER}name = "drifted"\n`
    );
    await unlink(join(sourceDir, 'universal-agent.md'));
    await writeFile(
      join(destinationDir, 'custom-agent.toml'),
      'name = "custom-agent"\ndescription = "custom"\ndeveloper_instructions = "custom"\n'
    );

    const updated = await syncNativeAgents({
      sourceDir,
      destinationDir,
      targetRoot: root,
      modelLanes: { frontier: 'gpt-frontier', spark: 'gpt-spark' },
    });

    expect(updated.written).toEqual(['backend-agent.toml']);
    expect(updated.removed).toEqual(['universal-agent.toml']);
    expect(updated.preserved).toEqual(['custom-agent.toml']);
    expect(await Bun.file(join(destinationDir, 'universal-agent.toml')).exists()).toBe(false);
    expect(await readFile(join(destinationDir, 'custom-agent.toml'), 'utf8')).toContain(
      'developer_instructions = "custom"'
    );
    expect(
      Bun.TOML.parse(await readFile(join(destinationDir, 'backend-agent.toml'), 'utf8'))
    ).toMatchObject({ name: 'backend-agent' });
  });

  it('keeps domain filtering behavior while universal agents remain installed', async () => {
    const root = await createTempDirectory('omcodex-native-agent-domain-');
    const sourceDir = join(root, 'sources');
    const destinationDir = join(root, '.codex', 'agents');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, 'backend-agent.md'),
      sourceAgent('backend-agent').replace('domain: universal', 'domain: backend')
    );
    await writeFile(
      join(sourceDir, 'frontend-agent.md'),
      sourceAgent('frontend-agent').replace('domain: universal', 'domain: frontend')
    );
    await writeFile(join(sourceDir, 'universal-agent.md'), sourceAgent('universal-agent'));

    const result = await syncNativeAgents({
      sourceDir,
      destinationDir,
      targetRoot: root,
      domain: 'backend',
      modelLanes: {},
    });

    expect(result.compiled.map((agent) => agent.sourceName)).toEqual([
      'backend-agent',
      'universal-agent',
    ]);
    expect((await readdir(destinationDir)).sort()).toEqual([
      'backend-agent.toml',
      'universal-agent.toml',
    ]);
  });

  it('preserves managed roles outside a later domain filter without rewriting their bytes', async () => {
    const root = await createTempDirectory('omcodex-native-agent-filter-preserve-');
    const sourceDir = join(root, 'sources');
    const destinationDir = join(root, '.codex', 'agents');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, 'backend-agent.md'),
      sourceAgent('backend-agent').replace('domain: universal', 'domain: backend')
    );
    await writeFile(
      join(sourceDir, 'frontend-agent.md'),
      sourceAgent('frontend-agent').replace('domain: universal', 'domain: frontend')
    );
    await syncNativeAgents({ sourceDir, destinationDir, targetRoot: root, modelLanes: {} });

    const frontendPath = join(destinationDir, 'frontend-agent.toml');
    const driftedBytes = `${await readFile(frontendPath, 'utf8')}# preserved filtered bytes\n`;
    await writeFile(frontendPath, driftedBytes);
    const filtered = await syncNativeAgents({
      sourceDir,
      destinationDir,
      targetRoot: root,
      domain: 'backend',
      modelLanes: {},
    });

    expect(filtered.filtered).toEqual(['frontend-agent.toml']);
    expect(filtered.removed).toEqual([]);
    expect(await readFile(frontendPath, 'utf8')).toBe(driftedBytes);
  });

  it('rejects case-folded custom collisions before any destination mutation', async () => {
    const root = await createTempDirectory('omcodex-native-agent-casefold-');
    const sourceDir = join(root, 'sources');
    const destinationDir = join(root, '.codex', 'agents');
    await mkdir(sourceDir, { recursive: true });
    await mkdir(destinationDir, { recursive: true });
    await writeFile(join(sourceDir, 'foo.md'), sourceAgent('foo'));
    const customPath = join(destinationDir, 'FOO.toml');
    const customBytes = 'name = "FOO"\ndescription = "custom"\ndeveloper_instructions = "custom"\n';
    await writeFile(customPath, customBytes);

    await expect(
      syncNativeAgents({ sourceDir, destinationDir, targetRoot: root, modelLanes: {} })
    ).rejects.toThrow('collides case-insensitively');
    expect(await readFile(customPath, 'utf8')).toBe(customBytes);
    expect(await readdir(destinationDir)).toEqual(['FOO.toml']);
  });

  it('rejects destinations that escape the requested root or traverse a symlink', async () => {
    const root = await createTempDirectory('omcodex-native-agent-safe-root-');
    const outside = await createTempDirectory('omcodex-native-agent-outside-');
    const sourceDir = join(root, 'sources');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, 'safe-agent.md'), sourceAgent('safe-agent'));

    await expect(
      syncNativeAgents({
        sourceDir,
        destinationDir: join(outside, 'agents'),
        targetRoot: root,
        modelLanes: {},
      })
    ).rejects.toThrow('escapes trusted root');

    await mkdir(join(root, '.codex'), { recursive: true });
    await symlink(outside, join(root, '.codex', 'agents'));
    await expect(
      syncNativeAgents({
        sourceDir,
        destinationDir: join(root, '.codex', 'agents'),
        targetRoot: root,
        modelLanes: {},
      })
    ).rejects.toThrow('symbolic link directory segment');
    expect(await readdir(outside)).toEqual([]);
  });
});
