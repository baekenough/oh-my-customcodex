import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  closeSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assessOmxReadiness,
  buildOmxProjectSetupCommand,
  type CodexHookTrustStatus,
  ensureOmxProjectReady,
  type InstallerDeps,
  OMX_PROJECT_SETUP_COMMAND,
  removeIneffectiveProjectHookTrustState,
  setProjectConfigRewriteHookForTests,
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

const DEFAULT_NATIVE_STATUS_LINE =
  'status_line = ["model-with-reasoning", "git-branch", "context-remaining", "total-input-tokens", "total-output-tokens", "five-hour-limit", "weekly-limit"]';

const PROJECT_CONFIG_TAIL = [
  '',
  '[mcp_servers.omx_state]',
  'command = "node"',
  'enabled = true',
  '',
] as const;

function readyDeps(
  onSetup?: (command: string, cwd: string) => void,
  hookTrust: CodexHookTrustStatus = 'trusted'
): InstallerDeps {
  return {
    exec: (command, options) => {
      if (command === 'which omx') return '/tmp/bin/omx';
      if (command === 'omx --version') return 'oh-my-codex v0.20.2';
      if (command === 'omx api --help') return 'Usage: omx api';
      if (command.startsWith('omx setup ')) {
        onSetup?.(command, String(options?.cwd));
        return '';
      }
      throw new Error(`Unexpected command: ${command}`);
    },
    getPlatform: () => 'linux',
    inspectHooks: (projectRoot) => [
      {
        key: `${projectRoot}:pre_tool_use:0:0`,
        command: 'node hook.js',
        currentHash: 'sha256:test',
        enabled: true,
        source: 'project',
        sourcePath: join(projectRoot, '.codex', 'hooks.json'),
        trustStatus: hookTrust,
      },
    ],
  };
}

function readyDepsWithoutHooks(onSetup?: (command: string, cwd: string) => void): InstallerDeps {
  return {
    ...readyDeps(onSetup),
    inspectHooks: () => [],
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

function projectConfigPath(projectRoot: string): string {
  return join(projectRoot, '.codex', 'config.toml');
}

function projectConfig(lines: readonly string[], eol = '\n'): string {
  return [
    'developer_instructions = "You have oh-my-codex installed."',
    ...lines,
    ...PROJECT_CONFIG_TAIL,
  ].join(eol);
}

function writeProjectConfig(projectRoot: string, config: string): string {
  writeCompleteProject(projectRoot);
  const path = projectConfigPath(projectRoot);
  writeFileSync(path, config);
  return path;
}

function ensureReadyWithoutSetup(projectRoot: string): string {
  const result = ensureOmxProjectReady(projectRoot, readyDeps());
  expect(result.success).toBe(true);
  expect(result.attempted).toBe(false);
  return readFileSync(projectConfigPath(projectRoot), 'utf8');
}

function insertBeforeTable(config: string, declaration: string, eol = '\n'): string {
  const table = config.indexOf('[mcp_servers.omx_state]');
  return `${config.slice(0, table)}${declaration}${eol}${config.slice(table)}`;
}

function writeOmx0202NativeHooks(projectRoot: string): void {
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

function writeOmx0202PluginSource(projectRoot: string): string {
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
      version: '0.20.2',
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
    setProjectConfigRewriteHookForTests(null);
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('keeps binary/API capability separate from project setup readiness', () => {
    const result = assessOmxReadiness(projectRoot, readyDepsWithoutHooks());

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

    const result = assessOmxReadiness(projectRoot, readyDepsWithoutHooks());

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

  it('distinguishes installed project hooks that still need approval from runnable hooks', () => {
    writeCompleteProject(projectRoot);

    const result = assessOmxReadiness(projectRoot, readyDeps(undefined, 'untrusted'));

    expect(result.status).toBe('needs-hook-approval');
    expect(result.ready).toBe(false);
    expect(result.project.hookReadiness).toEqual({
      status: 'approval-needed',
      installed: true,
      discovered: 1,
      runnable: 0,
      approvalNeeded: 1,
    });
    expect(result.project.missingSurfaces).toEqual(['nativeHooks']);
  });

  it('uses official runtime hooks when no local registry is present', () => {
    writeCompleteProject(projectRoot);
    rmSync(join(projectRoot, '.codex', 'hooks.json'));

    const result = assessOmxReadiness(projectRoot, readyDeps());

    expect(result.project.hookReadiness).toEqual({
      status: 'runnable',
      installed: true,
      discovered: 1,
      runnable: 1,
      approvalNeeded: 0,
    });
    expect(result.project.surfaces.nativeHooks).toBe(true);
    expect(result.status).toBe('ready');
  });

  it('reports installed hooks with zero runtime discovery as inactive, not approval-needed', () => {
    writeCompleteProject(projectRoot);

    const result = assessOmxReadiness(projectRoot, readyDepsWithoutHooks());

    expect(result.project.hookReadiness).toEqual({
      status: 'inactive',
      installed: true,
      discovered: 0,
      runnable: 0,
      approvalNeeded: 0,
    });
    expect(result.project.status).toBe('partial');
    expect(result.project.surfaces.nativeHooks).toBe(false);
  });

  it('directs zero-discovery installs to user-level hooks enablement and setup rerun', () => {
    const deps = readyDepsWithoutHooks((_command, cwd) => {
      expect(cwd).toBe(projectRoot);
      writeCompleteProject(projectRoot);
    });

    const result = ensureOmxProjectReady(projectRoot, deps);

    expect(result.success).toBe(false);
    expect(result.attempted).toBe(true);
    expect(result.assessment.project.hookReadiness.status).toBe('inactive');
    expect(result.error).toContain('user-level $CODEX_HOME/config.toml');
    expect(result.error).toContain('[features] hooks = true');
    expect(result.error).toContain(OMX_PROJECT_SETUP_COMMAND);
    expect(result.error).not.toContain('review /hooks');
  });

  it('removes ineffective project-layer trust records and requires manual hook review', () => {
    const deps = readyDeps((command, cwd) => {
      expect(command).toBe(OMX_PROJECT_SETUP_COMMAND);
      expect(cwd).toBe(projectRoot);
      writeCompleteProject(projectRoot);
      const configPath = join(projectRoot, '.codex', 'config.toml');
      writeFileSync(
        configPath,
        `${readFileSync(configPath, 'utf8')}\n# OMX-owned Codex hook trust state\n[hooks.state."ignored"]\ntrusted_hash = "sha256:ignored"\n# End OMX-owned Codex hook trust state\n`
      );
    }, 'untrusted');

    const result = ensureOmxProjectReady(projectRoot, deps);

    expect(result.success).toBe(false);
    expect(result.attempted).toBe(true);
    expect(result.assessment.project.status).toBe('needs-hook-approval');
    expect(result.error).toContain('Trust the project');
    expect(result.error).toContain('review /hooks');
    expect(readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8')).not.toContain(
      'OMX-owned Codex hook trust state'
    );
  });

  it('does not remove trust state through a .codex ancestor symlink', () => {
    const outside = `${projectRoot}-outside`;
    const outsideConfig = join(outside, 'config.toml');
    const content =
      '# before\n# OMX-owned Codex hook trust state\n[hooks.state."outside"]\ntrusted_hash = "sha256:outside"\n# End OMX-owned Codex hook trust state\n';
    try {
      mkdirSync(outside);
      writeFileSync(outsideConfig, content);
      symlinkSync(outside, join(projectRoot, '.codex'), 'dir');

      expect(removeIneffectiveProjectHookTrustState(projectRoot)).toBe(false);
      expect(readFileSync(outsideConfig, 'utf8')).toBe(content);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('does not remove trust state through a hard-linked config', () => {
    const outsideConfig = `${projectRoot}-outside-config.toml`;
    const configPath = join(projectRoot, '.codex', 'config.toml');
    const content =
      '# before\n# OMX-owned Codex hook trust state\n[hooks.state."outside"]\ntrusted_hash = "sha256:outside"\n# End OMX-owned Codex hook trust state\n';
    try {
      mkdirSync(join(projectRoot, '.codex'));
      writeFileSync(outsideConfig, content);
      linkSync(outsideConfig, configPath);

      expect(removeIneffectiveProjectHookTrustState(projectRoot)).toBe(false);
      expect(readFileSync(outsideConfig, 'utf8')).toBe(content);
    } finally {
      rmSync(outsideConfig, { force: true });
    }
  });

  it('does not replace a non-file project config', () => {
    const configPath = join(projectRoot, '.codex', 'config.toml');
    const sentinelPath = join(configPath, 'sentinel');
    mkdirSync(configPath, { recursive: true });
    writeFileSync(sentinelPath, 'unchanged');

    expect(removeIneffectiveProjectHookTrustState(projectRoot)).toBe(false);
    expect(readFileSync(sentinelPath, 'utf8')).toBe('unchanged');
  });

  it('rewrites the verified config inode while preserving ownership and permissions', () => {
    const codexDir = join(projectRoot, '.codex');
    const configPath = join(codexDir, 'config.toml');
    mkdirSync(codexDir);
    writeFileSync(
      configPath,
      '# before\n# OMX-owned Codex hook trust state\n[hooks.state."stale"]\ntrusted_hash = "sha256:stale"\n# End OMX-owned Codex hook trust state\n# after\n'
    );
    chmodSync(configPath, 0o640);
    const before = statSync(configPath);

    expect(removeIneffectiveProjectHookTrustState(projectRoot)).toBe(true);
    const after = statSync(configPath);
    expect(after.ino).toBe(before.ino);
    expect(after.dev).toBe(before.dev);
    expect(after.uid).toBe(before.uid);
    expect(after.gid).toBe(before.gid);
    expect(after.mode & 0o777).toBe(0o640);
    expect(readFileSync(configPath, 'utf8')).toBe('# before\n# after\n');
  });

  it('rolls back the verified inode without writing through a swapped parent path', () => {
    const codexDir = join(projectRoot, '.codex');
    const configPath = join(codexDir, 'config.toml');
    const originalCodexDir = `${codexDir}-original`;
    const outsideCodexDir = `${codexDir}-outside`;
    const outsideConfig = join(outsideCodexDir, 'config.toml');
    const originalContent =
      '# before\n# OMX-owned Codex hook trust state\n[hooks.state."stale"]\ntrusted_hash = "sha256:stale"\n# End OMX-owned Codex hook trust state\n# after\n';
    const outsideContent = 'EXTERNAL=must survive\n';
    mkdirSync(codexDir);
    mkdirSync(outsideCodexDir);
    writeFileSync(configPath, originalContent);
    writeFileSync(outsideConfig, outsideContent);
    setProjectConfigRewriteHookForTests((phase) => {
      if (phase !== 'before-write') return;
      renameSync(codexDir, originalCodexDir);
      symlinkSync(outsideCodexDir, codexDir, 'dir');
    });

    try {
      expect(removeIneffectiveProjectHookTrustState(projectRoot)).toBe(false);
      expect(readFileSync(outsideConfig, 'utf8')).toBe(outsideContent);
      expect(readFileSync(join(originalCodexDir, 'config.toml'), 'utf8')).toBe(originalContent);
    } finally {
      setProjectConfigRewriteHookForTests(null);
      unlinkSync(codexDir);
      renameSync(originalCodexDir, codexDir);
      rmSync(outsideCodexDir, { recursive: true, force: true });
    }
  });

  it('rolls back the original bytes when descriptor rewrite verification fails', () => {
    const configPath = join(projectRoot, '.codex', 'config.toml');
    const originalContent =
      '# before\n# OMX-owned Codex hook trust state\n[hooks.state."stale"]\ntrusted_hash = "sha256:stale"\n# End OMX-owned Codex hook trust state\n# after\n';
    mkdirSync(join(projectRoot, '.codex'));
    writeFileSync(configPath, originalContent);
    setProjectConfigRewriteHookForTests((phase) => {
      if (phase === 'after-write') throw new Error('injected verification failure');
    });

    expect(removeIneffectiveProjectHookTrustState(projectRoot)).toBe(false);
    expect(readFileSync(configPath, 'utf8')).toBe(originalContent);
  });

  it('surfaces an explicit recovery error when rollback cannot be verified', () => {
    const configPath = join(projectRoot, '.codex', 'config.toml');
    const originalContent =
      '# before\n# OMX-owned Codex hook trust state\n[hooks.state."stale"]\ntrusted_hash = "sha256:stale"\n# End OMX-owned Codex hook trust state\n# after\n';
    mkdirSync(join(projectRoot, '.codex'));
    writeFileSync(configPath, originalContent);
    setProjectConfigRewriteHookForTests((phase, descriptor) => {
      if (phase !== 'after-write') return;
      closeSync(descriptor);
      throw new Error('injected descriptor loss');
    });

    expect(() => removeIneffectiveProjectHookTrustState(projectRoot)).toThrow(
      /rollback could not be verified/
    );
  });

  it('returns a structured pre-setup failure when trust cleanup recovery is uncertain', () => {
    writeCompleteProject(projectRoot);
    const configPath = projectConfigPath(projectRoot);
    writeFileSync(
      configPath,
      `${readFileSync(configPath, 'utf8')}# OMX-owned Codex hook trust state\n[hooks.state."stale"]\ntrusted_hash = "sha256:stale"\n# End OMX-owned Codex hook trust state\n`
    );
    let setupCalls = 0;
    setProjectConfigRewriteHookForTests((phase, descriptor) => {
      if (phase !== 'after-write') return;
      closeSync(descriptor);
      throw new Error('injected cleanup descriptor loss');
    });

    const result = ensureOmxProjectReady(
      projectRoot,
      readyDeps(() => {
        setupCalls += 1;
      })
    );

    expect(result.success).toBe(false);
    expect(result.attempted).toBe(false);
    expect(setupCalls).toBe(0);
    expect(result.error).toContain('rollback could not be verified');
    expect(result.error).toContain('repair .codex/config.toml manually');
  });

  it('returns a structured pre-setup failure when status-line recovery is uncertain', () => {
    writeCompleteProject(projectRoot);
    let setupCalls = 0;
    setProjectConfigRewriteHookForTests((phase, descriptor) => {
      if (phase !== 'after-write') return;
      closeSync(descriptor);
      throw new Error('injected status-line descriptor loss');
    });

    const result = ensureOmxProjectReady(
      projectRoot,
      readyDeps(() => {
        setupCalls += 1;
      })
    );

    expect(result.success).toBe(false);
    expect(result.attempted).toBe(false);
    expect(setupCalls).toBe(0);
    expect(result.error).toContain('rollback could not be verified');
    expect(result.error).toContain('repair .codex/config.toml manually');
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

    const result = assessOmxReadiness(projectRoot, readyDepsWithoutHooks());

    expect(result.project.mcpStatus).toBe('configured-broken');
    expect(result.project.surfaces.mcp).toBe(false);
    expect(result.project.surfaces.nativeHooks).toBe(false);
    expect(result.status).toBe('partial');
  });

  it('accepts the OMX 0.20.2 native runtime default when timeout is omitted', () => {
    writeCompleteProject(projectRoot);
    writeOmx0202NativeHooks(projectRoot);

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

      expect(
        assessOmxReadiness(projectRoot, readyDepsWithoutHooks()).project.surfaces.nativeHooks
      ).toBe(false);
    }

    writeFileSync(
      join(projectRoot, '.codex', 'hooks.json'),
      '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"node hook.js","timeout":1e999}]}]}}'
    );

    expect(
      assessOmxReadiness(projectRoot, readyDepsWithoutHooks()).project.surfaces.nativeHooks
    ).toBe(false);

    writeFileSync(
      join(projectRoot, '.codex', 'hooks.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: '', timeout: 30 }] }],
        },
      })
    );

    expect(
      assessOmxReadiness(projectRoot, readyDepsWithoutHooks()).project.surfaces.nativeHooks
    ).toBe(false);
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

  it('accepts the exact OMX 0.20.2 plugin launcher contract without local surfaces', () => {
    const packageRoot = writeOmx0202PluginSource(projectRoot);
    writePluginOnlyProject(projectRoot, packageRoot);

    const result = assessOmxReadiness(projectRoot, readyDeps());

    expect(result.project.installMode).toBe('plugin');
    expect(result.project.surfaces.prompts).toBe(true);
    expect(result.project.surfaces.skills).toBe(true);
    expect(result.project.surfaces.nativeHooks).toBe(true);
    expect(result.status).toBe('ready');
  });

  it('rejects plugin launcher commands that do not prove the packaged OMX entrypoint', () => {
    const packageRoot = writeOmx0202PluginSource(projectRoot);
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

      const result = assessOmxReadiness(projectRoot, readyDepsWithoutHooks());
      expect({
        commands,
        nativeHooks: result.project.surfaces.nativeHooks,
        status: result.status,
      }).toEqual({ commands, nativeHooks: false, status: 'partial' });
    }
  });

  it('rejects a missing plugin source and does not bypass project setup', () => {
    writePluginOnlyProject(projectRoot, join(projectRoot, 'missing-omx-package'));

    const assessment = assessOmxReadiness(projectRoot, readyDepsWithoutHooks());
    expect(assessment.project.surfaces.prompts).toBe(false);
    expect(assessment.project.surfaces.skills).toBe(false);
    expect(assessment.project.surfaces.nativeHooks).toBe(false);
    expect(assessment.status).toBe('partial');

    let setupCalls = 0;
    const provisioned = ensureOmxProjectReady(
      projectRoot,
      readyDepsWithoutHooks(() => {
        setupCalls += 1;
      })
    );
    expect(setupCalls).toBe(1);
    expect(provisioned.attempted).toBe(true);
    expect(provisioned.success).toBe(false);
  });

  it('rejects broken plugin delivery pointers and assets', () => {
    const packageRoot = writeOmx0202PluginSource(projectRoot);
    const pluginRoot = join(packageRoot, 'plugins', 'oh-my-codex');
    writePluginOnlyProject(projectRoot, packageRoot);
    writeFileSync(
      join(pluginRoot, '.codex-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'oh-my-codex',
        version: '0.20.2',
        skills: './skills/',
        hooks: './hooks/missing.json',
      })
    );
    rmSync(join(pluginRoot, 'hooks', 'codex-native-hook.mjs'));

    const result = assessOmxReadiness(projectRoot, readyDepsWithoutHooks());

    expect(result.project.surfaces.prompts).toBe(true);
    expect(result.project.surfaces.skills).toBe(true);
    expect(result.project.surfaces.nativeHooks).toBe(false);
    expect(result.status).toBe('partial');
  });

  it('does not accept a lookalike plugin section as the OMX plugin contract', () => {
    const packageRoot = writeOmx0202PluginSource(projectRoot);
    writePluginOnlyProject(projectRoot, packageRoot);
    const configPath = join(projectRoot, '.codex', 'config.toml');
    writeFileSync(
      configPath,
      readFileSync(configPath, 'utf8').replace(
        '[plugins."oh-my-codex@oh-my-codex-local"]',
        '[plugins."not-oh-my-codex-compatible"]'
      )
    );

    const result = assessOmxReadiness(projectRoot, readyDepsWithoutHooks());

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
    expect(readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8')).toContain(
      DEFAULT_NATIVE_STATUS_LINE
    );
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

  it('fails closed without rerunning setup when a ready config disappears', () => {
    writeCompleteProject(projectRoot);
    const configPath = projectConfigPath(projectRoot);
    let inspectCalls = 0;
    let setupCalls = 0;
    const deps = readyDeps(() => {
      setupCalls += 1;
      writeCompleteProject(projectRoot);
    });
    const inspectHooks = deps.inspectHooks;
    deps.inspectHooks = (root) => {
      inspectCalls += 1;
      if (inspectCalls === 1) rmSync(configPath);
      return inspectHooks?.(root) ?? [];
    };

    const result = ensureOmxProjectReady(projectRoot, deps);

    expect(result.attempted).toBe(false);
    expect(result.success).toBe(false);
    expect(setupCalls).toBe(0);
    expect(result.error).toContain('readiness became stale');
    expect(() => readFileSync(configPath, 'utf8')).toThrow();
  });

  it('fails closed when a ready config is replaced by a safe OMX-incomplete config', () => {
    writeCompleteProject(projectRoot);
    const configPath = projectConfigPath(projectRoot);
    const replacementConfig = 'developer_instructions = "replacement config"\n';
    let inspectCalls = 0;
    let setupCalls = 0;
    const deps = readyDeps(() => {
      setupCalls += 1;
      writeCompleteProject(projectRoot);
    });
    const inspectHooks = deps.inspectHooks;
    deps.inspectHooks = (root) => {
      inspectCalls += 1;
      if (inspectCalls === 1) writeFileSync(configPath, replacementConfig);
      return inspectHooks?.(root) ?? [];
    };

    const result = ensureOmxProjectReady(projectRoot, deps);
    const savedConfig = readFileSync(configPath, 'utf8');

    expect(result.success).toBe(false);
    expect(result.attempted).toBe(false);
    expect(result.assessment.ready).toBe(false);
    expect(setupCalls).toBe(0);
    expect(result.error).toContain('readiness became stale');
    expect(savedConfig).toContain(replacementConfig);
    expect(savedConfig).toContain(DEFAULT_NATIVE_STATUS_LINE);
    expect(savedConfig).not.toContain('[mcp_servers.omx_state]');
  });

  it('seeds the native project status line without rerunning setup for a ready project', () => {
    writeCompleteProject(projectRoot);
    let setupCalls = 0;
    const deps = readyDeps(() => {
      setupCalls += 1;
    });

    const firstResult = ensureOmxProjectReady(projectRoot, deps);
    const seededConfig = readFileSync(projectConfigPath(projectRoot), 'utf8');
    const secondResult = ensureOmxProjectReady(projectRoot, deps);
    const savedConfig = readFileSync(projectConfigPath(projectRoot), 'utf8');

    for (const result of [firstResult, secondResult]) {
      expect(result.success).toBe(true);
      expect(result.attempted).toBe(false);
    }
    expect(setupCalls).toBe(0);
    expect(savedConfig).toBe(seededConfig);
    expect(savedConfig).toContain(DEFAULT_NATIVE_STATUS_LINE);
    expect(savedConfig.match(/^\[tui\]$/gm)).toHaveLength(1);
    expect(savedConfig.match(/^[ \t]*status_line[ \t]*=/gm)).toHaveLength(1);
  });

  for (const { name, config, declarationPattern } of [
    {
      name: 'custom native status line',
      config: projectConfig([
        '',
        '[tui]',
        '# user-selected footer',
        'status_line=["model", "context-used"]',
      ]),
      declarationPattern: /^[ \t]*status_line[ \t]*=/gm,
    },
    {
      name: 'disabled native status line',
      config: projectConfig(['', '[tui]', 'status_line = []']),
      declarationPattern: /^[ \t]*status_line[ \t]*=/gm,
    },
    {
      name: 'quoted tui table and key',
      config: projectConfig(['["tui"]', '"status_line" = []']),
      declarationPattern: /^"status_line"[ \t]*=/gm,
    },
    {
      name: 'root dotted key',
      config: projectConfig(['tui.status_line = []']),
      declarationPattern: /^tui\.status_line[ \t]*=/gm,
    },
    {
      name: 'root inline table',
      config: projectConfig(['tui = { status_line = [] }']),
      declarationPattern: /^tui[ \t]*=/gm,
    },
    {
      name: 'root inline table with a second-field status line',
      config: projectConfig(['tui = { animations = false, status_line = [] }']),
      declarationPattern: /^tui[ \t]*=/gm,
    },
    {
      name: 'root inline table with a quoted second-field status line',
      config: projectConfig(['tui = { animations = false, "status_line" = [] }']),
      declarationPattern: /^tui[ \t]*=/gm,
    },
  ]) {
    it(`preserves a ${name} byte-for-byte without duplication`, () => {
      writeProjectConfig(projectRoot, config);
      const savedConfig = ensureReadyWithoutSetup(projectRoot);

      expect(savedConfig).toBe(config);
      expect(savedConfig.match(declarationPattern)).toHaveLength(1);
    });
  }

  it('preserves a read-only custom status line without opening the config for write', () => {
    const originalConfig = projectConfig(['', '[tui]', 'status_line = ["model"]']);
    const configPath = writeProjectConfig(projectRoot, originalConfig);
    chmodSync(configPath, 0o444);
    const before = statSync(configPath);

    const savedConfig = ensureReadyWithoutSetup(projectRoot);
    const after = statSync(configPath);

    expect(savedConfig).toBe(originalConfig);
    expect(after.ino).toBe(before.ino);
    expect(after.mode & 0o777).toBe(0o444);
  });

  for (const { name, lines, hasRealTui } of [
    {
      name: 'multiline basic string before an actual tui table',
      lines: ['banner = """', '[tui]', '[fake]', '"""', '', '[tui]', 'animations = false'],
      hasRealTui: true,
    },
    {
      name: 'multiline basic string with fake table headers',
      lines: ['banner = """', '[tui]', '[fake]', '"""'],
      hasRealTui: false,
    },
    {
      name: 'same-line multiline string before an actual tui table',
      lines: ['banner = """[fake]"""', '', '[tui]', 'animations = false'],
      hasRealTui: true,
    },
    {
      name: 'same-line literal triple string',
      lines: ["banner = '''[tui]'''"],
      hasRealTui: false,
    },
    {
      name: 'multiline array comment and value',
      lines: ['panels = [', '  "model",', '  # [tui]', '  "[tui]",', ']'],
      hasRealTui: false,
    },
  ] as const) {
    it(`does not treat a fake tui table inside a ${name} as a real table`, () => {
      const originalConfig = projectConfig(lines);
      const expectedConfig = hasRealTui
        ? insertBeforeTable(originalConfig, DEFAULT_NATIVE_STATUS_LINE)
        : `${originalConfig}\n[tui]\n${DEFAULT_NATIVE_STATUS_LINE}\n`;
      writeProjectConfig(projectRoot, originalConfig);

      const savedConfig = ensureReadyWithoutSetup(projectRoot);

      expect(savedConfig).toBe(expectedConfig);
      expect(savedConfig.match(/^\[tui\]$/gm)).toHaveLength(
        lines.filter((line) => line === '[tui]').length + (hasRealTui ? 0 : 1)
      );
      expect(savedConfig.match(/^[ \t]*status_line[ \t]*=/gm)).toHaveLength(1);
    });
  }

  it('scans a large tokenless scalar config without rescanning the remaining file per line', () => {
    const scalarLines = Array.from({ length: 300_000 }, (_, index) => `plain_${index} = 1`);
    const originalConfig = projectConfig(scalarLines);
    writeProjectConfig(projectRoot, originalConfig);

    const savedConfig = ensureReadyWithoutSetup(projectRoot);

    expect(savedConfig).toBe(`${originalConfig}\n[tui]\n${DEFAULT_NATIVE_STATUS_LINE}\n`);
  }, 15_000);

  it('scans a large multiline body without searching ahead from every line', () => {
    const multilineBody = Array.from({ length: 300_000 }, () => 'plain multiline body');
    const originalConfig = projectConfig([
      'banner = """',
      ...multilineBody,
      '"""',
      '',
      '[tui]',
      'animations = false',
    ]);
    const expectedConfig = insertBeforeTable(originalConfig, DEFAULT_NATIVE_STATUS_LINE);
    writeProjectConfig(projectRoot, originalConfig);

    const savedConfig = ensureReadyWithoutSetup(projectRoot);

    expect(savedConfig).toBe(expectedConfig);
  }, 15_000);

  for (const { name, lines, expected } of [
    {
      name: 'table header',
      lines: ['["hello\\u0020world"]', 'value = 1'],
      expected: (config: string) => `${config}\n[tui]\n${DEFAULT_NATIVE_STATUS_LINE}\n`,
    },
    {
      name: 'nested table header',
      lines: ['[mcp_servers."my\\u0020server"]', 'command = "node"'],
      expected: (config: string) => `${config}\n[tui]\n${DEFAULT_NATIVE_STATUS_LINE}\n`,
    },
    {
      name: 'root key',
      lines: ['"hello\\u0020world" = 1'],
      expected: (config: string) => `${config}\n[tui]\n${DEFAULT_NATIVE_STATUS_LINE}\n`,
    },
    {
      name: 'root dotted tui key',
      lines: ['tui."theme\\u002dvariant" = "dark"'],
      expected: (config: string) => insertBeforeTable(config, `tui.${DEFAULT_NATIVE_STATUS_LINE}`),
    },
    {
      name: 'tui table key',
      lines: ['', '[tui]', '"theme\\u002dvariant" = "dark"'],
      expected: (config: string) => insertBeforeTable(config, DEFAULT_NATIVE_STATUS_LINE),
    },
    {
      name: 'inline tui table key',
      lines: ['tui = { "theme\\u002dvariant" = "dark" }'],
      expected: (config: string) =>
        config.replace(
          'tui = { "theme\\u002dvariant" = "dark" }',
          `tui = { "theme\\u002dvariant" = "dark", ${DEFAULT_NATIVE_STATUS_LINE} }`
        ),
    },
  ] as const) {
    it(`preserves an unrelated escaped basic quoted ${name} while seeding status`, () => {
      const originalConfig = projectConfig(lines);
      writeProjectConfig(projectRoot, originalConfig);

      const savedConfig = ensureReadyWithoutSetup(projectRoot);

      expect(savedConfig).toBe(expected(originalConfig));
    });
  }

  for (const { name, declaration } of [
    {
      name: 'status line alias',
      declaration: 'tui."\\u0073tatus_line" = []',
    },
    {
      name: 'invalid escape',
      declaration: 'tui."theme\\q" = "dark"',
    },
  ]) {
    it(`fails closed for a root dotted tui key with an escaped ${name}`, () => {
      const originalConfig = projectConfig([declaration]);
      const configPath = writeProjectConfig(projectRoot, originalConfig);
      let setupCalls = 0;

      const result = ensureOmxProjectReady(
        projectRoot,
        readyDeps(() => {
          setupCalls += 1;
        })
      );
      const savedConfig = readFileSync(configPath, 'utf8');

      expect(result.success).toBe(false);
      expect(result.attempted).toBe(false);
      expect(setupCalls).toBe(0);
      expect(savedConfig).toBe(originalConfig);
      expect(savedConfig).not.toContain('status_line = [');
    });
  }

  for (const { name, table } of [
    { name: 'table', table: '["t\\u0075i"]' },
    { name: 'nested table path', table: '["t\\u0075i".theme]' },
  ]) {
    it(`fails closed for an escaped basic quoted tui ${name} alias`, () => {
      const originalConfig = projectConfig([table, 'animations = false']);
      const configPath = writeProjectConfig(projectRoot, originalConfig);
      let setupCalls = 0;

      const result = ensureOmxProjectReady(
        projectRoot,
        readyDeps(() => {
          setupCalls += 1;
        })
      );
      const savedConfig = readFileSync(configPath, 'utf8');

      expect(result.success).toBe(false);
      expect(result.attempted).toBe(false);
      expect(setupCalls).toBe(0);
      expect(savedConfig).toBe(originalConfig);
      expect(savedConfig).not.toContain('status_line = [');
    });
  }

  it('seeds a native status line inside an existing root tui inline table', () => {
    const originalConfig = projectConfig(['tui = { animations = false }']);
    const expectedConfig = originalConfig.replace(
      'tui = { animations = false }',
      `tui = { animations = false, ${DEFAULT_NATIVE_STATUS_LINE} }`
    );
    writeProjectConfig(projectRoot, originalConfig);
    let setupCalls = 0;
    const deps = readyDeps(() => {
      setupCalls += 1;
    });

    const firstResult = ensureOmxProjectReady(projectRoot, deps);
    const configAfterFirstEnsure = readFileSync(projectConfigPath(projectRoot), 'utf8');
    const secondResult = ensureOmxProjectReady(projectRoot, deps);
    const configAfterSecondEnsure = readFileSync(projectConfigPath(projectRoot), 'utf8');

    for (const result of [firstResult, secondResult]) {
      expect(result.success).toBe(true);
      expect(result.attempted).toBe(false);
    }
    expect(setupCalls).toBe(0);
    expect(configAfterFirstEnsure).toBe(expectedConfig);
    expect(configAfterSecondEnsure).toBe(expectedConfig);
    expect(configAfterSecondEnsure.match(/^tui[ \t]*=/gm)).toHaveLength(1);
  });

  it('fails closed for an inline tui table with a dotted status line key', () => {
    const originalConfig = projectConfig(['tui = { status_line.mode = "compact" }']);
    const configPath = writeProjectConfig(projectRoot, originalConfig);
    let setupCalls = 0;

    const result = ensureOmxProjectReady(
      projectRoot,
      readyDeps(() => {
        setupCalls += 1;
      })
    );
    const savedConfig = readFileSync(configPath, 'utf8');

    expect(result.success).toBe(false);
    expect(result.attempted).toBe(false);
    expect(setupCalls).toBe(0);
    expect(savedConfig).toBe(originalConfig);
    expect(savedConfig).not.toContain('status_line = [');
  });

  it('fails closed for an inline tui table with an escaped basic quoted status line key', () => {
    const originalConfig = projectConfig(['tui = { "\\u0073tatus_line" = [] }']);
    const configPath = writeProjectConfig(projectRoot, originalConfig);
    let setupCalls = 0;

    const result = ensureOmxProjectReady(
      projectRoot,
      readyDeps(() => {
        setupCalls += 1;
      })
    );
    const savedConfig = readFileSync(configPath, 'utf8');

    expect(result.success).toBe(false);
    expect(result.attempted).toBe(false);
    expect(setupCalls).toBe(0);
    expect(savedConfig).toBe(originalConfig);
    expect(savedConfig).not.toContain('status_line = [');
  });

  it('inserts the native status line inside an existing tui section', () => {
    const originalConfig = projectConfig([
      '',
      '[tui]',
      'animations = false',
      '# preserve this tui preference',
    ]);
    const expectedConfig = insertBeforeTable(originalConfig, DEFAULT_NATIVE_STATUS_LINE);
    writeProjectConfig(projectRoot, originalConfig);

    const savedConfig = ensureReadyWithoutSetup(projectRoot);
    const tuiStart = savedConfig.indexOf('[tui]');
    const statusLine = savedConfig.indexOf(DEFAULT_NATIVE_STATUS_LINE);
    const nextSection = savedConfig.indexOf('[mcp_servers.omx_state]');

    expect(savedConfig).toBe(expectedConfig);
    expect(savedConfig.match(/^\[tui\]$/gm)).toHaveLength(1);
    expect(tuiStart).toBeLessThan(statusLine);
    expect(statusLine).toBeLessThan(nextSection);
  });

  it('inserts a dotted native status line before the first table and remains idempotent', () => {
    const originalConfig = projectConfig([
      'tui.animations = false',
      '# preserve this root preference',
    ]);
    const declaration = `tui.${DEFAULT_NATIVE_STATUS_LINE}`;
    const expectedConfig = insertBeforeTable(originalConfig, declaration);
    writeProjectConfig(projectRoot, originalConfig);

    const configAfterFirstEnsure = ensureReadyWithoutSetup(projectRoot);
    const configAfterSecondEnsure = ensureReadyWithoutSetup(projectRoot);

    expect(configAfterFirstEnsure).toBe(expectedConfig);
    expect(configAfterSecondEnsure).toBe(expectedConfig);
    expect(configAfterSecondEnsure.match(/^tui\.status_line[ \t]*=/gm)).toHaveLength(1);
    expect(configAfterSecondEnsure.indexOf(declaration)).toBeLessThan(
      configAfterSecondEnsure.indexOf('[mcp_servers.omx_state]')
    );
  });

  it('inserts the native status line before the next table in a CRLF config', () => {
    const originalConfig = projectConfig(['', '[tui]', 'animations=false'], '\r\n');
    const expectedConfig = insertBeforeTable(originalConfig, DEFAULT_NATIVE_STATUS_LINE, '\r\n');
    writeProjectConfig(projectRoot, originalConfig);

    expect(ensureReadyWithoutSetup(projectRoot)).toBe(expectedConfig);
  });

  for (const kind of ['symlink', 'hardlink'] as const) {
    it(`fails closed without changing an external config reached by ${kind}`, () => {
      const caseRoot = join(projectRoot, kind);
      const outsideConfig = `${projectRoot}-${kind}-outside.toml`;
      const outsideContent = projectConfig([]);
      const configPath = writeProjectConfig(caseRoot, outsideContent);
      writeFileSync(outsideConfig, outsideContent);
      rmSync(configPath);
      if (kind === 'symlink') symlinkSync(outsideConfig, configPath);
      else linkSync(outsideConfig, configPath);

      try {
        const result = ensureOmxProjectReady(caseRoot, readyDeps());

        expect(result.success).toBe(false);
        expect(result.attempted).toBe(false);
        expect(result.error).toContain('.codex/config.toml');
        expect(result.error).toContain('safely');
        expect(readFileSync(outsideConfig, 'utf8')).toBe(outsideContent);
      } finally {
        rmSync(outsideConfig, { force: true });
      }
    });
  }

  it('fails closed before setup when the .codex directory is an external symlink', () => {
    const outsideCodexDir = `${projectRoot}-outside-codex`;
    const codexDir = join(projectRoot, '.codex');
    let setupCalls = 0;

    try {
      writeCompleteProject(projectRoot);
      rmSync(codexDir, { recursive: true, force: true });
      mkdirSync(outsideCodexDir);
      writeFileSync(join(outsideCodexDir, 'sentinel'), 'unchanged');
      symlinkSync(outsideCodexDir, codexDir, 'dir');

      const result = ensureOmxProjectReady(
        projectRoot,
        readyDeps(() => {
          setupCalls += 1;
        })
      );

      expect(result.success).toBe(false);
      expect(result.attempted).toBe(false);
      expect(setupCalls).toBe(0);
      expect(result.error).toContain('.codex/config.toml');
      expect(result.error).toContain('safely');
      expect(readdirSync(outsideCodexDir)).toEqual(['sentinel']);
    } finally {
      rmSync(outsideCodexDir, { recursive: true, force: true });
    }
  });

  it('does not report success when setup exits but required surfaces remain missing', () => {
    const result = ensureOmxProjectReady(projectRoot, readyDeps());

    expect(result.attempted).toBe(true);
    expect(result.success).toBe(false);
    expect(result.assessment.status).toBe('partial');
    expect(result.error).toContain('setup completed without .codex/config.toml');
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

  it('preserves setup and secondary cleanup failures in the structured result', () => {
    const result = ensureOmxProjectReady(
      projectRoot,
      readyDeps(() => {
        writeCompleteProject(projectRoot);
        const configPath = projectConfigPath(projectRoot);
        writeFileSync(
          configPath,
          `${readFileSync(configPath, 'utf8')}# OMX-owned Codex hook trust state\n[hooks.state."stale"]\ntrusted_hash = "sha256:stale"\n# End OMX-owned Codex hook trust state\n`
        );
        setProjectConfigRewriteHookForTests((phase, descriptor) => {
          if (phase !== 'after-write') return;
          closeSync(descriptor);
          throw new Error('injected cleanup descriptor loss');
        });
        throw new Error('setup exploded');
      })
    );

    expect(result.success).toBe(false);
    expect(result.attempted).toBe(true);
    expect(result.error).toContain('setup exploded');
    expect(result.error).toContain('Project config cleanup also failed');
    expect(result.error).toContain('rollback could not be verified');
    expect(result.error).toContain('repair .codex/config.toml manually');
  });
});
