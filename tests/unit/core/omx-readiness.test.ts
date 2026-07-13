import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assessOmxReadiness,
  buildOmxProjectSetupCommand,
  ensureOmxProjectReady,
  type InstallerDeps,
  OMX_PROJECT_SETUP_COMMAND,
} from '../../../src/core/omx-installer.ts';

const ALL_SURFACES = [
  'prompts',
  'skills',
  'nativeAgents',
  'agentsInstructions',
  'codexConfig',
  'nativeHooks',
  'mcp',
];

function readyDeps(onSetup?: (command: string, cwd: string) => void): InstallerDeps {
  return {
    exec: (command, options) => {
      if (command === 'which omx') return '/tmp/bin/omx';
      if (command === 'omx --version') return 'oh-my-codex v0.20.1';
      if (command === 'omx api --help') return 'Usage: omx api';
      if (command.startsWith('omx setup ')) {
        onSetup?.(command, String(options?.cwd));
        return '';
      }
      throw new Error(`Unexpected command: ${command}`);
    },
    getPlatform: () => 'linux',
  };
}

function writeCompleteProject(projectRoot: string): void {
  mkdirSync(join(projectRoot, '.codex', 'prompts'), { recursive: true });
  writeFileSync(join(projectRoot, '.codex', 'prompts', 'executor.md'), '# Executor\n');

  mkdirSync(join(projectRoot, '.codex', 'skills', 'plan'), { recursive: true });
  writeFileSync(join(projectRoot, '.codex', 'skills', 'plan', 'SKILL.md'), '# Plan\n');

  mkdirSync(join(projectRoot, '.codex', 'agents'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.codex', 'agents', 'executor.toml'),
    [
      'name = "executor"',
      'description = "Implement scoped work"',
      'developer_instructions = "Finish and verify the task."',
      '',
    ].join('\n')
  );

  writeFileSync(
    join(projectRoot, 'AGENTS.md'),
    '# oh-my-codex\n\n<!-- OMX:GUIDANCE:OPERATING:START -->\n'
  );
  writeFileSync(
    join(projectRoot, '.codex', 'config.toml'),
    [
      '# oh-my-codex project configuration',
      'developer_instructions = "You have oh-my-codex installed."',
      '',
      '[mcp_servers.omx_state]',
      'command = "node"',
      'args = ["state-server.js"]',
      'enabled = true',
      '',
    ].join('\n')
  );
  writeFileSync(
    join(projectRoot, '.codex', 'hooks.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'node native-hook.js', timeout: 30 }] }],
      },
    })
  );
}

function writeOmx0201NativeHooks(projectRoot: string): void {
  const command = 'node codex-native-hook.js';
  writeFileSync(
    join(projectRoot, '.codex', 'hooks.json'),
    JSON.stringify({
      hooks: {
        SessionStart: [{ matcher: 'startup|resume|clear', hooks: [{ type: 'command', command }] }],
        PreToolUse: [{ hooks: [{ type: 'command', command }] }],
        PostToolUse: [{ hooks: [{ type: 'command', command }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command }] }],
        PreCompact: [{ hooks: [{ type: 'command', command }] }],
        PostCompact: [{ hooks: [{ type: 'command', command }] }],
        Stop: [{ hooks: [{ type: 'command', command, timeout: 30 }] }],
      },
    })
  );
}

function writeOmx0201PluginSource(projectRoot: string): string {
  const packageRoot = join(projectRoot, 'omx-package');
  const pluginRoot = join(packageRoot, 'plugins', 'oh-my-codex');

  mkdirSync(join(packageRoot, '.agents', 'plugins'), { recursive: true });
  writeFileSync(
    join(packageRoot, '.agents', 'plugins', 'marketplace.json'),
    JSON.stringify({
      name: 'oh-my-codex-local',
      plugins: [
        {
          name: 'oh-my-codex',
          source: { source: 'local', path: './plugins/oh-my-codex' },
        },
      ],
    })
  );

  mkdirSync(join(pluginRoot, '.codex-plugin'), { recursive: true });
  writeFileSync(
    join(pluginRoot, '.codex-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'oh-my-codex',
      version: '0.20.1',
      skills: './skills/',
      hooks: './hooks/hooks.json',
    })
  );
  mkdirSync(join(pluginRoot, 'skills', 'plan'), { recursive: true });
  writeFileSync(join(pluginRoot, 'skills', 'plan', 'SKILL.md'), '# Plan\n');
  mkdirSync(join(pluginRoot, 'hooks'), { recursive: true });
  writeFileSync(join(pluginRoot, 'hooks', 'codex-native-hook.mjs'), '// OMX hook launcher\n');
  writeFileSync(
    join(pluginRoot, 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: 'command',
                command: `node "\${PLUGIN_ROOT}/hooks/codex-native-hook.mjs"`,
              },
            ],
          },
        ],
      },
    })
  );

  return packageRoot;
}

function writePluginOnlyProject(projectRoot: string, packageRoot: string): void {
  writeCompleteProject(projectRoot);
  rmSync(join(projectRoot, '.codex', 'prompts'), { recursive: true, force: true });
  rmSync(join(projectRoot, '.codex', 'skills'), { recursive: true, force: true });
  rmSync(join(projectRoot, '.codex', 'hooks.json'), { force: true });
  mkdirSync(join(projectRoot, '.omx'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.omx', 'setup-scope.json'),
    JSON.stringify({ scope: 'project', installMode: 'plugin', mcpMode: 'none' })
  );
  writeFileSync(
    join(projectRoot, '.codex', 'config.toml'),
    [
      '[features]',
      'hooks = true',
      '',
      '[plugins."oh-my-codex@oh-my-codex-local"]',
      'enabled = true',
      '',
      '[marketplaces.oh-my-codex-local]',
      'source_type = "local"',
      `source = ${JSON.stringify(packageRoot)}`,
      '',
    ].join('\n')
  );
}

describe('OMX complete project readiness', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'omcodex-omx-readiness-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('keeps binary/API capability separate from project setup readiness', () => {
    const result = assessOmxReadiness(projectRoot, readyDeps());

    expect(result.capability.status).toBe('ready');
    expect(result.status).toBe('partial');
    expect(result.ready).toBe(false);
    expect(result.project.status).toBe('partial');
    expect(result.project.missingSurfaces).toEqual(ALL_SURFACES);
  });

  it('preserves persisted setup policy in the default provisioning command', () => {
    expect(OMX_PROJECT_SETUP_COMMAND).toBe('omx setup --scope project --merge-agents');
    expect(OMX_PROJECT_SETUP_COMMAND).not.toContain('--install-mode');
    expect(OMX_PROJECT_SETUP_COMMAND).not.toContain('--mcp');
    expect(buildOmxProjectSetupCommand({ installMode: 'plugin', mcpMode: 'compat' })).toBe(
      'omx setup --scope project --merge-agents --install-mode plugin --mcp compat'
    );
  });

  it('reports exact missing surfaces for a partial project', () => {
    mkdirSync(join(projectRoot, '.codex', 'prompts'), { recursive: true });
    writeFileSync(join(projectRoot, '.codex', 'prompts', 'executor.md'), '# Executor\n');
    writeFileSync(join(projectRoot, 'AGENTS.md'), '# oh-my-codex\n');

    const result = assessOmxReadiness(projectRoot, readyDeps());

    expect(result.status).toBe('partial');
    expect(result.project.surfaces.prompts).toBe(true);
    expect(result.project.surfaces.agentsInstructions).toBe(true);
    expect(result.project.missingSurfaces).toEqual([
      'skills',
      'nativeAgents',
      'codexConfig',
      'nativeHooks',
      'mcp',
    ]);
  });

  it('passes only when all required OMX project surfaces are present', () => {
    writeCompleteProject(projectRoot);

    const result = assessOmxReadiness(projectRoot, readyDeps());

    expect(result.status).toBe('ready');
    expect(result.ready).toBe(true);
    expect(result.project.status).toBe('ready');
    expect(result.project.mcpStatus).toBe('configured-valid');
    expect(result.project.missingSurfaces).toEqual([]);
  });

  it('rejects native agent TOML that fails the shared metadata parser', () => {
    writeCompleteProject(projectRoot);
    writeFileSync(
      join(projectRoot, '.codex', 'agents', 'executor.toml'),
      [
        'name = "invalid agent name"',
        'description = "Looks structurally complete"',
        'developer_instructions = "Verify."',
        '',
      ].join('\n')
    );

    const result = assessOmxReadiness(projectRoot, readyDeps());

    expect(result.project.surfaces.nativeAgents).toBe(false);
    expect(result.status).toBe('partial');
  });

  it('keeps configured-but-broken MCP and native hooks out of ready state', () => {
    writeCompleteProject(projectRoot);
    writeFileSync(
      join(projectRoot, '.codex', 'config.toml'),
      '# oh-my-codex project configuration\ndeveloper_instructions = "OMX"\n'
    );
    writeFileSync(join(projectRoot, '.codex', 'hooks.json'), JSON.stringify({ hooks: {} }));

    const result = assessOmxReadiness(projectRoot, readyDeps());

    expect(result.project.mcpStatus).toBe('configured-broken');
    expect(result.project.surfaces.mcp).toBe(false);
    expect(result.project.surfaces.nativeHooks).toBe(false);
    expect(result.status).toBe('partial');
  });

  it('accepts the OMX 0.20.1 native runtime default when timeout is omitted', () => {
    writeCompleteProject(projectRoot);
    writeOmx0201NativeHooks(projectRoot);

    const result = assessOmxReadiness(projectRoot, readyDeps());

    expect(result.project.surfaces.nativeHooks).toBe(true);
    expect(result.status).toBe('ready');
  });

  it('rejects explicitly invalid native hook timeouts and malformed handlers', () => {
    writeCompleteProject(projectRoot);

    for (const timeout of [0, -1, null, '30']) {
      writeFileSync(
        join(projectRoot, '.codex', 'hooks.json'),
        JSON.stringify({
          hooks: {
            PreToolUse: [{ hooks: [{ type: 'command', command: 'node hook.js', timeout }] }],
          },
        })
      );

      expect(assessOmxReadiness(projectRoot, readyDeps()).project.surfaces.nativeHooks).toBe(false);
    }

    writeFileSync(
      join(projectRoot, '.codex', 'hooks.json'),
      '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"node hook.js","timeout":1e999}]}]}}'
    );

    expect(assessOmxReadiness(projectRoot, readyDeps()).project.surfaces.nativeHooks).toBe(false);

    writeFileSync(
      join(projectRoot, '.codex', 'hooks.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: '', timeout: 30 }] }],
        },
      })
    );

    expect(assessOmxReadiness(projectRoot, readyDeps()).project.surfaces.nativeHooks).toBe(false);
  });

  it('accepts an explicit project-scoped MCP none policy as configured', () => {
    writeCompleteProject(projectRoot);
    writeFileSync(
      join(projectRoot, '.codex', 'config.toml'),
      '# oh-my-codex project configuration\ndeveloper_instructions = "OMX"\n'
    );
    mkdirSync(join(projectRoot, '.omx'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.omx', 'setup-scope.json'),
      JSON.stringify({ scope: 'project', mcpMode: 'none' })
    );

    const result = assessOmxReadiness(projectRoot, readyDeps());

    expect(result.project.surfaces.mcp).toBe(true);
    expect(result.project.mcpStatus).toBe('none-valid');
    expect(result.status).toBe('ready');
  });

  it('accepts the exact OMX 0.20.1 plugin launcher contract without local surfaces', () => {
    const packageRoot = writeOmx0201PluginSource(projectRoot);
    writePluginOnlyProject(projectRoot, packageRoot);

    const result = assessOmxReadiness(projectRoot, readyDeps());

    expect(result.project.installMode).toBe('plugin');
    expect(result.project.surfaces.prompts).toBe(true);
    expect(result.project.surfaces.skills).toBe(true);
    expect(result.project.surfaces.nativeHooks).toBe(true);
    expect(result.status).toBe('ready');
  });

  it('rejects plugin launcher commands that do not prove the packaged OMX entrypoint', () => {
    const packageRoot = writeOmx0201PluginSource(projectRoot);
    const pluginRoot = join(packageRoot, 'plugins', 'oh-my-codex');
    const hooksPath = join(pluginRoot, 'hooks', 'hooks.json');
    writePluginOnlyProject(projectRoot, packageRoot);

    const packagedCommand = `node "\${PLUGIN_ROOT}/hooks/codex-native-hook.mjs"`;
    const invalidCommandSets = [
      [`node "\${PLUGIN_ROOT}/hooks/missing-codex-native-hook.mjs"`],
      ['node codex-native-hook.mjs'],
      ['node "/tmp/codex-native-hook.mjs"'],
      [`node "\${PLUGIN_ROOT}/hooks/codex-native-hook.mjs.backup"`],
      [`${packagedCommand} --unexpected`],
      [packagedCommand, `node "\${PLUGIN_ROOT}/hooks/missing-codex-native-hook.mjs"`],
    ];

    for (const commands of invalidCommandSets) {
      writeFileSync(
        hooksPath,
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                hooks: commands.map((command) => ({ type: 'command', command })),
              },
            ],
          },
        })
      );

      const result = assessOmxReadiness(projectRoot, readyDeps());
      expect({
        commands,
        nativeHooks: result.project.surfaces.nativeHooks,
        status: result.status,
      }).toEqual({ commands, nativeHooks: false, status: 'partial' });
    }
  });

  it('rejects a missing plugin source and does not bypass project setup', () => {
    writePluginOnlyProject(projectRoot, join(projectRoot, 'missing-omx-package'));

    const assessment = assessOmxReadiness(projectRoot, readyDeps());
    expect(assessment.project.surfaces.prompts).toBe(false);
    expect(assessment.project.surfaces.skills).toBe(false);
    expect(assessment.project.surfaces.nativeHooks).toBe(false);
    expect(assessment.status).toBe('partial');

    let setupCalls = 0;
    const provisioned = ensureOmxProjectReady(
      projectRoot,
      readyDeps(() => {
        setupCalls += 1;
      })
    );
    expect(setupCalls).toBe(1);
    expect(provisioned.attempted).toBe(true);
    expect(provisioned.success).toBe(false);
  });

  it('rejects broken plugin delivery pointers and assets', () => {
    const packageRoot = writeOmx0201PluginSource(projectRoot);
    const pluginRoot = join(packageRoot, 'plugins', 'oh-my-codex');
    writePluginOnlyProject(projectRoot, packageRoot);
    writeFileSync(
      join(pluginRoot, '.codex-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'oh-my-codex',
        version: '0.20.1',
        skills: './skills/',
        hooks: './hooks/missing.json',
      })
    );
    rmSync(join(pluginRoot, 'hooks', 'codex-native-hook.mjs'));

    const result = assessOmxReadiness(projectRoot, readyDeps());

    expect(result.project.surfaces.prompts).toBe(true);
    expect(result.project.surfaces.skills).toBe(true);
    expect(result.project.surfaces.nativeHooks).toBe(false);
    expect(result.status).toBe('partial');
  });

  it('does not accept a lookalike plugin section as the OMX plugin contract', () => {
    const packageRoot = writeOmx0201PluginSource(projectRoot);
    writePluginOnlyProject(projectRoot, packageRoot);
    const configPath = join(projectRoot, '.codex', 'config.toml');
    writeFileSync(
      configPath,
      readFileSync(configPath, 'utf8').replace(
        '[plugins."oh-my-codex@oh-my-codex-local"]',
        '[plugins."not-oh-my-codex-compatible"]'
      )
    );

    const result = assessOmxReadiness(projectRoot, readyDeps());

    expect(result.project.surfaces.nativeHooks).toBe(false);
    expect(result.status).toBe('partial');
  });

  it('provisions through an injected project-scoped command and rechecks readiness', () => {
    const commands: string[] = [];
    const deps = readyDeps((command, cwd) => {
      commands.push(command);
      expect(cwd).toBe(projectRoot);
      writeCompleteProject(projectRoot);
    });

    const result = ensureOmxProjectReady(projectRoot, deps);

    expect(commands).toEqual(['omx setup --scope project --merge-agents']);
    expect(result.attempted).toBe(true);
    expect(result.success).toBe(true);
    expect(result.assessment.status).toBe('ready');
  });

  it('does not rerun setup for an already complete project', () => {
    writeCompleteProject(projectRoot);
    let setupCalls = 0;

    const result = ensureOmxProjectReady(
      projectRoot,
      readyDeps(() => {
        setupCalls += 1;
      })
    );

    expect(setupCalls).toBe(0);
    expect(result.attempted).toBe(false);
    expect(result.success).toBe(true);
  });

  it('does not report success when setup exits but required surfaces remain missing', () => {
    const result = ensureOmxProjectReady(projectRoot, readyDeps());

    expect(result.attempted).toBe(true);
    expect(result.success).toBe(false);
    expect(result.assessment.status).toBe('partial');
    expect(result.error).toContain('setup remains incomplete');
  });

  it('reports setup execution failures without claiming readiness', () => {
    const result = ensureOmxProjectReady(
      projectRoot,
      readyDeps(() => {
        throw new Error('setup exploded');
      })
    );

    expect(result.attempted).toBe(true);
    expect(result.success).toBe(false);
    expect(result.assessment.status).toBe('partial');
    expect(result.error).toContain('setup exploded');
  });
});
