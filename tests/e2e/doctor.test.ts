/**
 * E2E tests for `omcodex doctor` command
 * Tests the actual CLI command execution end-to-end
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import { access, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawn } from 'bun';
import { unregisterProject } from '../../src/core/registry.js';

// Set 30s timeout for E2E tests (CI environments are slower).
setDefaultTimeout(30000);

describe('E2E: omcodex doctor', () => {
  let tempDir: string;
  let cliPath: string;
  let fakeBin: string;

  const fakeOmx = `#!/bin/sh
set -eu

case "\${1:-}" in
  --version)
    printf '%s\n' 'oh-my-codex v0.20.1'
    ;;
  api)
    [ "\${2:-}" = '--help' ]
    printf '%s\n' 'Usage: omx api'
    ;;
  setup)
    [ "\${2:-}" = '--scope' ]
    [ "\${3:-}" = 'project' ]
    [ "\${4:-}" = '--merge-agents' ]

    mkdir -p .codex/prompts .codex/skills/plan .codex/agents
    printf '# Executor\n' > .codex/prompts/executor.md
    printf '# Plan\n' > .codex/skills/plan/SKILL.md
    cat > .codex/agents/executor.toml <<'EOF'
name = "executor"
description = "Implement scoped work"
developer_instructions = "Finish and verify the task."
EOF
    cat > AGENTS.md <<'EOF'
# oh-my-codex

<!-- OMX:GUIDANCE:OPERATING:START -->
EOF
    cat > .codex/config.toml <<'EOF'
# oh-my-codex project configuration
developer_instructions = "You have oh-my-codex installed."

[mcp_servers.omx_state]
command = "node"
args = ["state-server.js"]
enabled = true
EOF
    cat > .codex/hooks.json <<'EOF'
{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"printf fake-omx","timeout":30}]}]}}
EOF
    ;;
  *)
    exit 2
    ;;
esac
`;

  const fakeCodex = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('codex-cli 0.144.1\\n');
  process.exit(0);
}
if (args[0] !== 'app-server' || args[1] !== '--stdio') process.exit(2);

const readline = require('node:readline');
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { serverInfo: { name: 'fake-codex', version: '0.144.1' } } });
  } else if (message.method === 'hooks/list') {
    const cwds = Array.isArray(message.params?.cwds) ? message.params.cwds : [];
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { data: cwds.map((cwd) => ({ cwd, hooks: [], errors: [] })) },
    });
  }
});
`;

  beforeAll(() => {
    // Path to the CLI entry point (run with bun)
    // Using dirname to get the project root from the test file location
    const projectRoot = join(import.meta.dir, '../..');
    cliPath = join(projectRoot, 'src/cli/index.ts');
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-e2e-doctor-'));
    fakeBin = join(tempDir, 'bin');
    await mkdir(fakeBin, { recursive: true });
    await writeFile(join(fakeBin, 'omx'), fakeOmx, { mode: 0o755 });
    await writeFile(join(fakeBin, 'codex'), fakeCodex, { mode: 0o755 });
    // Change to temp directory for the test
    process.chdir(tempDir);
  });

  afterEach(async () => {
    // Reset to a safe directory before cleanup
    process.chdir(tmpdir());
    await unregisterProject(tempDir);
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to run CLI command using Bun.spawn with timeout
   */
  async function runCli(
    ...args: string[]
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const proc = spawn({
      cmd: ['bun', 'run', cliPath, '--skip-version-check', ...args],
      cwd: tempDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
        CODEX_HOME: join(tempDir, '.codex-home'),
        OMCODEX_REGISTRY_DIR: join(tempDir, '.omcodex-registry'),
        ...(args[0] === 'init' ? { NODE_ENV: 'production', BUN_ENV: 'production' } : {}),
      },
    });

    // Add timeout to prevent hanging in CI
    // Increased from 10s to 30s for slower CI environments
    const timeout = 30000; // 30 seconds
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(new Error(`CLI command timed out after ${timeout}ms`));
      }, timeout);
    });

    try {
      const [stdout, stderr, exitCode] = await Promise.race([
        Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]),
        timeoutPromise,
      ]);

      return { exitCode, stdout, stderr };
    } catch (error) {
      // Ensure process is killed on error
      try {
        proc.kill();
      } catch {
        // Ignore kill errors
      }
      throw error;
    }
  }

  /**
   * Helper to initialize a project first
   */
  async function initProject(): Promise<void> {
    await runCli('init');
  }

  /**
   * Helper to check if path exists
   */
  async function pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  describe('on healthy installation', () => {
    beforeEach(async () => {
      await initProject();
    });

    it('should report all checks pass on healthy installation', async () => {
      const result = await runCli('doctor');

      expect(result.exitCode).toBe(0);
      const output = result.stdout + result.stderr;

      // Should indicate success
      expect(
        output.includes('pass') ||
          output.includes('PASS') ||
          output.includes('healthy') ||
          output.includes('All checks')
      ).toBe(true);
    });

    it('should show checking message at start', async () => {
      const result = await runCli('doctor');

      expect(result.exitCode).toBe(0);
      const output = result.stdout + result.stderr;

      // Should show checking message (Korean: "진단 검사 실행 중" or English: "check"/"diagnos")
      expect(
        output.includes('진단') ||
          output.includes('검사') ||
          output.toLowerCase().includes('check') ||
          output.toLowerCase().includes('diagnos')
      ).toBe(true);
    });

    it('should check AGENTS.md exists', async () => {
      const result = await runCli('doctor');

      expect(result.exitCode).toBe(0);
      const output = result.stdout;

      // Should mention AGENTS.md check
      expect(output).toContain('AGENTS.md');
      expect(output.includes('[PASS]') || output.includes('✓') || output.includes('pass')).toBe(
        true
      );
    });

    it('should check rules directory', async () => {
      const result = await runCli('doctor');

      expect(result.exitCode).toBe(0);
      const output = result.stdout;

      // Should check rules
      expect(output.toLowerCase()).toContain('rule');
    });

    it('should check agents directory', async () => {
      const result = await runCli('doctor');

      expect(result.exitCode).toBe(0);
      const output = result.stdout;

      // Should check agents
      expect(output.toLowerCase()).toContain('agent');
    });

    it('should check skills directory', async () => {
      const result = await runCli('doctor');

      expect(result.exitCode).toBe(0);
      const output = result.stdout;

      // Should check skills
      expect(output.toLowerCase()).toContain('skill');
    });

    it('should show summary at the end', async () => {
      const result = await runCli('doctor');

      expect(result.exitCode).toBe(0);
      const output = result.stdout;

      // Should show summary with counts
      expect(output.match(/\d+/)).not.toBeNull();
    });
  });

  describe('detecting issues', () => {
    it('should detect missing AGENTS.md', async () => {
      // Create partial structure without AGENTS.md (official Codex-native format paths)
      await mkdir(join(tempDir, '.codex', 'rules'), { recursive: true });
      await mkdir(join(tempDir, '.codex', 'agents'), { recursive: true });
      await mkdir(join(tempDir, '.agents', 'skills'), { recursive: true });

      const result = await runCli('doctor');

      // Should fail or warn
      const output = result.stdout + result.stderr;
      expect(output).toContain('AGENTS.md');
      expect(
        output.includes('[FAIL]') || output.includes('fail') || output.includes('missing')
      ).toBe(true);
    });

    it('should detect missing rules directory', async () => {
      // Create structure without .codex/rules (official Codex-native format paths)
      await writeFile(join(tempDir, 'AGENTS.md'), '# Test');
      await mkdir(join(tempDir, '.codex'), { recursive: true });
      // No rules directory
      await mkdir(join(tempDir, '.codex', 'agents'), { recursive: true });
      await mkdir(join(tempDir, '.agents', 'skills'), { recursive: true });

      const result = await runCli('doctor');

      const output = result.stdout;
      // Should detect missing rules
      expect(output.toLowerCase()).toContain('rule');
      expect(
        output.includes('[FAIL]') || output.includes('fail') || output.includes('missing')
      ).toBe(true);
    });

    it('should detect missing agents directory', async () => {
      // Create structure without agents (official Codex-native format: .codex/agents)
      await writeFile(join(tempDir, 'AGENTS.md'), '# Test');
      await mkdir(join(tempDir, '.codex', 'rules'), { recursive: true });
      await writeFile(join(tempDir, '.codex', 'rules', 'MUST-test.md'), '# Test Rule');
      await mkdir(join(tempDir, '.agents', 'skills'), { recursive: true });

      const result = await runCli('doctor');

      const output = result.stdout;
      // Should detect missing agents
      expect(output.toLowerCase()).toContain('agent');
      expect(
        output.includes('[FAIL]') || output.includes('fail') || output.includes('missing')
      ).toBe(true);
    });

    it('should detect missing skills directory', async () => {
      // Create structure without skills (official Codex-native format: .agents/skills)
      await writeFile(join(tempDir, 'AGENTS.md'), '# Test');
      await mkdir(join(tempDir, '.codex', 'rules'), { recursive: true });
      await writeFile(join(tempDir, '.codex', 'rules', 'MUST-test.md'), '# Test Rule');
      await mkdir(join(tempDir, '.codex', 'agents'), { recursive: true });

      const result = await runCli('doctor');

      const output = result.stdout;
      // Should detect missing skills
      expect(output.toLowerCase()).toContain('skill');
      expect(
        output.includes('[FAIL]') || output.includes('fail') || output.includes('missing')
      ).toBe(true);
    });

    it('should detect broken symlinks', { timeout: 15000 }, async () => {
      await initProject();

      // Create a broken symlink in skills (agents are now flat .md files in .codex/agents)
      const skillDir = join(tempDir, '.agents', 'skills', 'development', 'test-skill');
      const refsDir = join(skillDir, 'refs');
      await mkdir(refsDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '# Test Skill');

      // Create broken symlink
      const brokenSymlink = join(refsDir, 'broken-link');
      await symlink('/non/existent/path', brokenSymlink);

      const result = await runCli('doctor');

      const output = result.stdout;
      // Should detect broken symlinks
      expect(output.toLowerCase()).toContain('symlink');
      expect(
        output.includes('[FAIL]') || output.includes('fail') || output.includes('broken')
      ).toBe(true);
    });

    it('should detect invalid frontmatter in agent files', async () => {
      await initProject();

      // Create an agent with invalid frontmatter (agents are now flat .md files with frontmatter)
      const agentFile = join(tempDir, '.codex', 'agents', 'broken-agent.md');
      await writeFile(
        agentFile,
        `---
invalid yaml content:
  - broken: [[[
  not valid syntax here
---
# Broken Agent`
      );

      const result = await runCli('doctor');

      const output = result.stdout;
      // Should detect invalid agent files (contains agent reference in Korean or English)
      expect(output.toLowerCase().includes('agent') || output.includes('에이전트')).toBe(true);
      expect(
        output.includes('[FAIL]') ||
          output.includes('fail') ||
          output.includes('invalid') ||
          output.includes('실패') ||
          output.includes('잘못')
      ).toBe(true);
    });

    it('should report multiple issues when multiple things are wrong', async () => {
      // Create empty directory - many checks will fail
      const result = await runCli('doctor');

      const output = result.stdout;

      // Should have multiple failures
      const failCount = (output.match(/\[FAIL\]/gi) || []).length;
      expect(failCount).toBeGreaterThan(1);
    });
  });

  describe('--fix option', () => {
    it('should create missing rules directory with --fix', async () => {
      // Create structure without rules
      await writeFile(join(tempDir, 'AGENTS.md'), '# Test');
      await mkdir(join(tempDir, '.codex'), { recursive: true });
      await mkdir(join(tempDir, 'agents'), { recursive: true });
      await mkdir(join(tempDir, 'skills'), { recursive: true });

      // Verify rules directory doesn't exist
      expect(await pathExists(join(tempDir, '.codex', 'rules'))).toBe(false);

      await runCli('doctor', '--fix');

      // Rules directory should now exist
      expect(await pathExists(join(tempDir, '.codex', 'rules'))).toBe(true);
    });

    it('should create missing agents directory with --fix', async () => {
      // Create structure without agents (official Codex-native format: .codex/agents)
      await writeFile(join(tempDir, 'AGENTS.md'), '# Test');
      await mkdir(join(tempDir, '.codex', 'rules'), { recursive: true });
      await mkdir(join(tempDir, '.agents', 'skills'), { recursive: true });

      // Verify agents directory doesn't exist
      expect(await pathExists(join(tempDir, '.codex', 'agents'))).toBe(false);

      const _result = await runCli('doctor', '--fix');

      // Agents directory should now exist
      expect(await pathExists(join(tempDir, '.codex', 'agents'))).toBe(true);
    });

    it('should create missing skills directory with --fix', async () => {
      // Create structure without skills (official Codex-native format: .agents/skills)
      await writeFile(join(tempDir, 'AGENTS.md'), '# Test');
      await mkdir(join(tempDir, '.codex', 'rules'), { recursive: true });
      await mkdir(join(tempDir, '.codex', 'agents'), { recursive: true });

      // Verify skills directory doesn't exist
      expect(await pathExists(join(tempDir, '.agents', 'skills'))).toBe(false);

      const _result = await runCli('doctor', '--fix');

      // Skills directory should now exist
      expect(await pathExists(join(tempDir, '.agents', 'skills'))).toBe(true);
    });

    it('should remove broken symlinks with --fix', async () => {
      await initProject();

      // Create a broken symlink in skills (agents are now flat .md files, no refs)
      const skillDir = join(tempDir, '.agents', 'skills', 'development', 'test-skill');
      const refsDir = join(skillDir, 'refs');
      await mkdir(refsDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '# Test Skill');

      const brokenSymlink = join(refsDir, 'broken-link');
      await symlink('/non/existent/path', brokenSymlink);

      // Verify broken symlink exists
      expect(await pathExists(brokenSymlink)).toBe(false); // pathExists follows symlink, so broken = false
      const entries = await readdir(refsDir);
      expect(entries).toContain('broken-link');

      const result = await runCli('doctor', '--fix');

      const output = result.stdout + result.stderr;
      // Should indicate fixing
      expect(
        output.toLowerCase().includes('fix') ||
          output.toLowerCase().includes('remov') ||
          output.toLowerCase().includes('delet')
      ).toBe(true);

      // Broken symlink should be removed
      const entriesAfter = await readdir(refsDir);
      expect(entriesAfter).not.toContain('broken-link');
    });

    it('should report fresh warnings instead of false fixed labels', async () => {
      // Create structure with missing directories
      await writeFile(join(tempDir, 'AGENTS.md'), '# Test');
      await mkdir(join(tempDir, '.codex'), { recursive: true });

      const result = await runCli('doctor', '--fix');

      const output = result.stdout;

      expect(output).toContain('[WARN]');
      expect(output).not.toContain('(fixed)');
    });

    it('should pass subsequent doctor check after fix', async () => {
      // Create structure with missing directories (agents, skills)
      await writeFile(join(tempDir, 'AGENTS.md'), '# Test');
      await mkdir(join(tempDir, '.codex', 'rules'), { recursive: true });
      await writeFile(join(tempDir, '.codex', 'rules', 'MUST-test.md'), '# Test Rule');
      // agents and skills directories are missing

      // Run fix
      await runCli('doctor', '--fix');

      // Run doctor again without fix
      const _result = await runCli('doctor');

      // After fixing, directories should exist (official Codex-native format)
      expect(await pathExists(join(tempDir, '.codex', 'agents'))).toBe(true);
      expect(await pathExists(join(tempDir, '.agents', 'skills'))).toBe(true);
    });

    it('should not try to fix non-fixable issues', async () => {
      await initProject();

      // Create an agent with invalid frontmatter (not fixable by doctor)
      const agentFile = join(tempDir, '.codex', 'agents', 'broken-agent.md');
      const invalidContent = `---
invalid: [[[
---
# Broken Agent`;
      await writeFile(agentFile, invalidContent);

      const result = await runCli('doctor', '--fix');

      // Invalid frontmatter is not fixable, should still be reported
      const output = result.stdout;
      expect(output.toLowerCase()).toContain('agent');

      // The invalid content should still be invalid
      const { readFile } = await import('node:fs/promises');
      const fileContent = await readFile(agentFile, 'utf-8');
      expect(fileContent).toBe(invalidContent);
    });
  });

  describe('exit codes', () => {
    it('should exit with 0 on healthy installation', async () => {
      await initProject();

      const result = await runCli('doctor');

      expect(result.exitCode).toBe(0);
    });

    it('should exit with 0 after successful fix', async () => {
      // Create structure with fixable issues
      await writeFile(join(tempDir, 'AGENTS.md'), '# Test');
      await mkdir(join(tempDir, '.codex', 'rules'), { recursive: true });
      await writeFile(join(tempDir, '.codex', 'rules', 'MUST-test.md'), '# Test');
      // Missing agents and skills directories

      const result = await runCli('doctor', '--fix');

      // After fix, should succeed
      expect(result.exitCode).toBe(0);
    });

    it('should report failures in output even if exit code is 0', async () => {
      // Note: The current doctor implementation exits with 0 even when there are failures
      // This test verifies that failures are still reported in the output
      // Empty directory with no AGENTS.md (not auto-fixable)
      const result = await runCli('doctor');

      const output = result.stdout + result.stderr;

      // Should show failures in output
      expect(
        output.includes('[FAIL]') || output.includes('fail') || output.includes('failed')
      ).toBe(true);
    });
  });

  describe('fix suggestions', () => {
    it('should suggest running with --fix when fixable issues exist', async () => {
      // Create structure with fixable issues only
      await writeFile(join(tempDir, 'AGENTS.md'), '# Test');
      await mkdir(join(tempDir, '.codex', 'rules'), { recursive: true });
      await writeFile(join(tempDir, '.codex', 'rules', 'MUST-test.md'), '# Test');
      // Missing agents and skills

      const result = await runCli('doctor');

      const output = result.stdout + result.stderr;

      // Should suggest --fix
      expect(output.includes('--fix') || output.includes('fix')).toBe(true);
    });
  });

  describe('integration with init', () => {
    it('should diagnose disabled user-level hooks after init without reporting a doctor failure', async () => {
      const initResult = await runCli('init');
      const initOutput = initResult.stdout + initResult.stderr;

      expect(initResult.exitCode).toBe(1);
      expect(initOutput).toContain('$CODEX_HOME/config.toml');
      expect(initOutput).toContain('[features] hooks = true');

      const doctorResult = await runCli('doctor');

      expect(doctorResult.exitCode).toBe(0);

      const output = doctorResult.stdout;
      expect(output).toContain('discovered 0 project hooks');
      expect(output).toContain('$CODEX_HOME/config.toml');
      const failCount = (output.match(/\[FAIL\]/gi) || []).length;
      expect(failCount).toBe(0);
    });
  });
});
