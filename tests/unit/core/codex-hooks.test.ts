import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CodexHookRegistry,
  compileCodexHooks,
  installNativeCodexHooks,
  mergeCodexHookRegistries,
  validateCodexHookRegistry,
} from '../../../src/core/codex-hooks.js';

interface CommandHandler {
  type: 'command';
  command: string;
  timeout: number;
}

function commonPayload(cwd: string, hookEventName: string): Record<string, unknown> {
  return {
    session_id: 'session-test-1591',
    turn_id: 'turn-test-1591',
    transcript_path: null,
    cwd,
    permission_mode: 'default',
    hook_event_name: hookEventName,
    model: 'gpt-5.6-sol',
    tool_use_id: 'tool-test-1591',
  };
}

interface NativeAdvisoryOutput {
  systemMessage: string;
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

function parseAdvisoryOutput(stdout: string): NativeAdvisoryOutput {
  return JSON.parse(stdout) as NativeAdvisoryOutput;
}

function findHandler(registry: CodexHookRegistry, scriptName: string): CommandHandler {
  for (const groups of Object.values(registry.hooks)) {
    for (const group of groups) {
      const handler = group.hooks.find((candidate) => candidate.command.includes(scriptName));
      if (handler) return handler;
    }
  }
  throw new Error(`Missing handler for ${scriptName}`);
}

async function runHandler(
  command: string,
  cwd: string,
  payload: Record<string, unknown>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(['bash', '-lc', command], {
    cwd,
    stdin: new Blob([JSON.stringify(payload)]),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    exitCode: await child.exited,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
}

describe('Codex-native hooks', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-native-hooks-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('converts only native event, matcher, and command-handler contracts', () => {
    const source = {
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      hooks: {
        PreToolUse: [
          {
            matcher: 'tool == "Write" || tool == "Edit" || tool == "Bash"',
            hooks: [
              {
                type: 'command',
                command: 'bash .codex/hooks/scripts/schema-validator.sh',
              },
            ],
          },
          {
            matcher: 'tool == "Bash" && tool_input.command matches "git reset --hard"',
            hooks: [
              {
                type: 'command',
                command: 'bash .codex/hooks/scripts/destructive-git-guard.sh',
              },
            ],
          },
          {
            matcher: 'tool == "Bash" && tool_input.command matches "git push"',
            hooks: [{ type: 'command', command: 'echo should-not-be-broadened' }],
          },
        ],
        FileChanged: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: 'bash .codex/hooks/scripts/file-change-validator.sh',
              },
            ],
          },
        ],
        Stop: [
          {
            matcher: '*',
            hooks: [
              { type: 'prompt', prompt: 'unsupported' },
              { type: 'command', command: 'bash .codex/hooks/scripts/stop-audit.sh' },
            ],
          },
        ],
      },
    };

    const { registry, compatibility } = compileCodexHooks(source);

    expect(registry).not.toHaveProperty('$schema');
    expect(registry.hooks).not.toHaveProperty('FileChanged');
    expect(registry.hooks.PreToolUse?.map((group) => group.matcher)).toContain(
      '^(?:Bash|apply_patch)$'
    );
    expect(registry.hooks.PostToolUse?.map((group) => group.matcher)).toContain('^apply_patch$');

    const commands = Object.values(registry.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((handler) => handler.command))
    );
    expect(commands).toContain(
      'repo_root="$(git rev-parse --show-toplevel)" && cd "$repo_root" && bash "$repo_root/.codex/hooks/scripts/codex-native-advisory.sh" "destructive-git-guard.sh" # omcustomcodex-hook:destructive-git-guard.sh'
    );
    expect(commands).not.toContain('echo should-not-be-broadened');
    expect(commands.every((command) => !command.includes('bash .codex/hooks/'))).toBe(true);

    for (const groups of Object.values(registry.hooks)) {
      for (const group of groups) {
        if (group.matcher) {
          expect(() => new RegExp(group.matcher)).not.toThrow();
          expect(group.matcher).not.toContain('tool_input');
          expect(group.matcher).not.toContain('tool ==');
        }
        expect(group.hooks.every((handler) => handler.type === 'command')).toBe(true);
        expect(
          group.hooks.every((handler) => Number.isFinite(handler.timeout) && handler.timeout > 0)
        ).toBe(true);
      }
    }

    expect(compatibility.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'PreToolUse', reason: 'unsupported_match_predicate' }),
        expect.objectContaining({ event: 'Stop', reason: 'unsupported_handler_type' }),
      ])
    );
    expect(compatibility.migrated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceEvent: 'FileChanged',
          targetEvent: 'PostToolUse',
        }),
      ])
    );
  });

  it('accounts for every group in the packaged compatibility registry', async () => {
    const sourcePath = join(
      import.meta.dir,
      '..',
      '..',
      '..',
      'templates',
      '.claude',
      'hooks',
      'hooks.json'
    );
    const source = JSON.parse(await readFile(sourcePath, 'utf-8')) as {
      hooks: Record<string, unknown[]>;
    };
    const { registry, compatibility } = compileCodexHooks(source);
    const sourceGroups = Object.entries(source.hooks).flatMap(([sourceEvent, groups]) =>
      groups.map((_, sourceGroupIndex) => `${sourceEvent}:${sourceGroupIndex}`)
    );
    const accountedGroups = compatibility.groups.map(
      ({ sourceEvent, sourceGroupIndex }) => `${sourceEvent}:${sourceGroupIndex}`
    );

    expect(accountedGroups).toHaveLength(sourceGroups.length);
    expect(new Set(accountedGroups).size).toBe(sourceGroups.length);
    expect(accountedGroups.sort()).toEqual(sourceGroups.sort());
    expect(
      compatibility.groups.every(({ disposition }) =>
        ['native', 'migrated', 'excluded'].includes(disposition)
      )
    ).toBe(true);

    const nativeCommands = Object.values(registry.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((handler) => handler.command))
    );
    expect(nativeCommands.length).toBeGreaterThan(0);
    expect(
      nativeCommands.every((command) =>
        command.includes('.codex/hooks/scripts/codex-native-advisory.sh')
      )
    ).toBe(true);
    expect(nativeCommands.every((command) => command.includes('# omcustomcodex-hook:'))).toBe(true);
    expect(
      nativeCommands.every((command) =>
        [
          'destructive-git-guard.sh',
          'file-change-validator.sh',
          'schema-validator.sh',
          'secret-filter.sh',
        ].some((scriptName) => command.includes(scriptName))
      )
    ).toBe(true);
    expect(
      compatibility.migrated.find(({ command }) => command.includes('destructive-git-guard.sh'))
        ?.reason
    ).toContain('Advisory only (exit 0)');
  });

  it('installs the root registry, scripts, and isolated compatibility records', async () => {
    const result = await installNativeCodexHooks(tempDir, { overwrite: true });

    expect(result.registryPath).toBe(join(tempDir, '.codex', 'hooks.json'));
    expect(await Bun.file(result.registryPath).exists()).toBe(true);
    expect(await Bun.file(join(tempDir, '.codex', 'hooks', 'hooks.json')).exists()).toBe(false);
    expect(
      await Bun.file(
        join(tempDir, '.codex', 'hooks', 'compatibility', 'claude-hooks.json')
      ).exists()
    ).toBe(true);
    expect(
      await Bun.file(join(tempDir, '.codex', 'hooks', 'compatibility', 'conversion.json')).exists()
    ).toBe(true);
    expect(
      await Bun.file(
        join(tempDir, '.codex', 'hooks', 'scripts', 'destructive-git-guard.sh')
      ).exists()
    ).toBe(true);

    const registry = JSON.parse(await readFile(result.registryPath, 'utf-8')) as CodexHookRegistry;
    expect(findHandler(registry, 'destructive-git-guard.sh').timeout).toBeGreaterThan(0);
    expect(findHandler(registry, 'secret-filter.sh').timeout).toBeGreaterThan(0);
    expect(findHandler(registry, 'schema-validator.sh').timeout).toBeGreaterThan(0);
    expect(findHandler(registry, 'file-change-validator.sh').timeout).toBeGreaterThan(0);
  });

  it('validates and stably merges managed handlers without reordering custom or OMX hooks', () => {
    const customHandler = { type: 'command' as const, command: 'printf custom', timeout: 5 };
    const omxHandler = {
      type: 'command' as const,
      command: 'node "$PWD/.codex/hooks/codex-native-hook.js" SessionStart',
      timeout: 10,
    };
    const existing: CodexHookRegistry = {
      hooks: {
        PreToolUse: [{ matcher: '^Bash$', hooks: [customHandler] }],
        SessionStart: [{ hooks: [omxHandler] }],
      },
    };
    const source = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'tool == "Bash"',
            hooks: [{ type: 'command', command: 'bash .codex/hooks/scripts/schema-validator.sh' }],
          },
        ],
      },
    };
    const managed = compileCodexHooks(source).registry;
    const once = mergeCodexHookRegistries(existing, managed);
    const twice = mergeCodexHookRegistries(once, managed);

    expect(validateCodexHookRegistry(once)).toBe(once);
    expect(once.hooks.PreToolUse?.[0]?.hooks[0]).toEqual(customHandler);
    expect(once.hooks.SessionStart?.[0]?.hooks[0]).toEqual(omxHandler);
    expect(findHandler(once, 'schema-validator.sh').command).toContain(
      '# omcustomcodex-hook:schema-validator.sh'
    );
    expect(twice).toEqual(once);
    expect(() => validateCodexHookRegistry({ hooks: { PreToolUse: [{}] } })).toThrow(
      'Invalid Codex hook registry'
    );
  });

  it('normalizes managed-only groups after position-trusted OMX and custom groups', () => {
    const managed = compileCodexHooks({
      hooks: {
        PreToolUse: [
          {
            matcher: 'tool == "Bash"',
            hooks: [
              {
                type: 'command',
                command: 'bash .codex/hooks/scripts/destructive-git-guard.sh',
              },
            ],
          },
          {
            matcher: 'tool == "Write" || tool == "Edit"',
            hooks: [{ type: 'command', command: 'bash .codex/hooks/scripts/schema-validator.sh' }],
          },
        ],
        PostToolUse: [
          {
            matcher: 'tool == "Bash"',
            hooks: [{ type: 'command', command: 'bash .codex/hooks/scripts/secret-filter.sh' }],
          },
        ],
      },
    }).registry;
    const omxPreGroup = {
      matcher: '.*',
      owner: 'omx',
      hooks: [
        {
          type: 'command' as const,
          command: 'node "$PWD/.codex/hooks/codex-native-hook.js" PreToolUse',
          timeout: 10,
        },
      ],
    };
    const customPreGroup = {
      matcher: '^custom$',
      owner: 'fixture',
      hooks: [{ type: 'command' as const, command: 'printf custom', timeout: 5 }],
    };
    const omxPostGroup = {
      owner: 'omx-post',
      hooks: [
        {
          type: 'command' as const,
          command: 'node "$PWD/.codex/hooks/codex-native-hook.js" PostToolUse',
          timeout: 10,
        },
      ],
    };
    const existing: CodexHookRegistry = {
      registryMetadata: { owner: 'fixture' },
      hooks: {
        PreToolUse: [...(managed.hooks.PreToolUse ?? []), omxPreGroup, customPreGroup],
        PostToolUse: [...(managed.hooks.PostToolUse ?? []), omxPostGroup],
      },
    };

    expect(existing.hooks.PreToolUse?.[2]).toEqual(omxPreGroup);
    const once = mergeCodexHookRegistries(existing, managed);
    const twice = mergeCodexHookRegistries(once, managed);

    expect(once.registryMetadata).toEqual({ owner: 'fixture' });
    expect(once.hooks.PreToolUse?.[0]).toEqual(omxPreGroup);
    expect(once.hooks.PreToolUse?.[1]).toEqual(customPreGroup);
    expect(once.hooks.PostToolUse?.[0]).toEqual(omxPostGroup);
    expect(once.hooks.PreToolUse?.slice(0, 2).map((group) => group.owner)).toEqual([
      'omx',
      'fixture',
    ]);
    expect(twice).toEqual(once);
  });

  it('keeps the managed advisory source and packaged template byte-identical', async () => {
    const source = await readFile(
      join(import.meta.dir, '../../../.codex/hooks/scripts/codex-native-advisory.sh'),
      'utf-8'
    );
    const template = await readFile(
      join(import.meta.dir, '../../../templates/.claude/hooks/scripts/codex-native-advisory.sh'),
      'utf-8'
    );

    expect(template).toBe(source);
  });

  it('runs representative Codex payloads from a nested cwd', async () => {
    await installNativeCodexHooks(tempDir, { overwrite: true });
    await mkdir(join(tempDir, 'packages', 'nested'), { recursive: true });
    await mkdir(join(tempDir, '.codex', 'schemas'), { recursive: true });
    await writeFile(join(tempDir, '.codex', 'schemas', 'tool-inputs.json'), '{}');

    const gitInit = Bun.spawnSync(['git', 'init', '-q'], { cwd: tempDir });
    expect(gitInit.exitCode).toBe(0);

    const registry = JSON.parse(
      await readFile(join(tempDir, '.codex', 'hooks.json'), 'utf-8')
    ) as CodexHookRegistry;
    const cwd = join(tempDir, 'packages', 'nested');

    const destructive = await runHandler(
      findHandler(registry, 'destructive-git-guard.sh').command,
      cwd,
      {
        ...commonPayload(cwd, 'PreToolUse'),
        tool_name: 'Bash',
        tool_input: { command: 'git reset --hard HEAD' },
      }
    );
    expect(destructive.exitCode).toBe(0);
    expect(destructive.stderr).toBe('');
    const destructiveOutput = parseAdvisoryOutput(destructive.stdout);
    expect(destructiveOutput.systemMessage).toContain('destructive git command detected');
    expect(destructiveOutput.hookSpecificOutput).toEqual(
      expect.objectContaining({
        hookEventName: 'PreToolUse',
        additionalContext: expect.stringContaining('Advisory'),
      })
    );
    expect(destructiveOutput).not.toHaveProperty('additionalContext');

    const schema = await runHandler(findHandler(registry, 'schema-validator.sh').command, cwd, {
      ...commonPayload(cwd, 'PreToolUse'),
      tool_name: 'Bash',
      tool_input: { command: 'sudo true' },
    });
    expect(schema.exitCode).toBe(0);
    expect(schema.stderr).toBe('');
    expect(parseAdvisoryOutput(schema.stdout).systemMessage).toContain(
      'elevated privilege command detected'
    );

    const schemaPatch = await runHandler(
      findHandler(registry, 'schema-validator.sh').command,
      cwd,
      {
        ...commonPayload(cwd, 'PreToolUse'),
        tool_name: 'apply_patch',
        tool_input: { input: '*** Begin Patch\n*** Update File: AGENTS.md\n*** End Patch' },
      }
    );
    expect(schemaPatch).toEqual({ exitCode: 0, stdout: '', stderr: '' });

    const secret = await runHandler(findHandler(registry, 'secret-filter.sh').command, cwd, {
      ...commonPayload(cwd, 'PostToolUse'),
      tool_name: 'Bash',
      tool_input: { command: 'printf secret' },
      tool_response: JSON.stringify({ output: `sk-${'a'.repeat(40)}` }),
    });
    expect(secret.exitCode).toBe(0);
    expect(secret.stderr).toBe('');
    const secretOutput = parseAdvisoryOutput(secret.stdout);
    expect(secretOutput.systemMessage).toContain('Potential API key');
    expect(secretOutput.hookSpecificOutput.hookEventName).toBe('PostToolUse');

    const fileValidation = await runHandler(
      findHandler(registry, 'file-change-validator.sh').command,
      cwd,
      {
        ...commonPayload(cwd, 'PostToolUse'),
        tool_name: 'apply_patch',
        tool_input: {
          input: [
            '*** Begin Patch',
            '*** Update File: AGENTS.md',
            '*** Update File: .codex/config.toml',
            '*** Update File: package-lock.json',
            '*** End Patch',
          ].join('\n'),
        },
        tool_response: { output: 'Done!' },
      }
    );
    expect(fileValidation.exitCode).toBe(0);
    expect(fileValidation.stderr).toBe('');
    const fileOutput = parseAdvisoryOutput(fileValidation.stdout);
    expect(fileOutput.systemMessage).toContain('AGENTS.md');
    expect(fileOutput.systemMessage).toContain('.codex/config.toml');
    expect(fileOutput.systemMessage).toContain('package-lock.json');
    expect(fileOutput.systemMessage).toContain('Configuration file changed');
    expect(fileOutput.systemMessage).toContain('Lock file changed');

    for (const payloadKey of ['input', 'patch', 'content', 'text', 'command'] as const) {
      const variant = await runHandler(
        findHandler(registry, 'file-change-validator.sh').command,
        cwd,
        {
          ...commonPayload(cwd, 'PostToolUse'),
          tool_name: 'apply_patch',
          tool_input: {
            [payloadKey]: '*** Begin Patch\n*** Update File: AGENTS.md\n*** End Patch',
          },
          tool_response: { output: 'Done!' },
        }
      );
      expect(variant.exitCode).toBe(0);
      expect(variant.stderr).toBe('');
      expect(parseAdvisoryOutput(variant.stdout).systemMessage).toContain('AGENTS.md');
    }

    const safe = await runHandler(findHandler(registry, 'secret-filter.sh').command, cwd, {
      ...commonPayload(cwd, 'PostToolUse'),
      tool_name: 'Bash',
      tool_input: { command: 'printf safe' },
      tool_response: JSON.stringify({ output: 'safe output' }),
    });
    expect(safe).toEqual({ exitCode: 0, stdout: '', stderr: '' });
  });
});
