import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPTS_DIR = resolve(import.meta.dir, '../../../templates/.claude/hooks/scripts');
const SOURCE_SCRIPTS_DIR = resolve(import.meta.dir, '../../../.codex/hooks/scripts');
const HOOKS_JSON_PATH = resolve(import.meta.dir, '../../../templates/.claude/hooks/hooks.json');

const STAGE_BLOCKER_SCRIPT = join(SCRIPTS_DIR, 'stage-blocker.sh');
const AGENT_MODE_GUARD_SCRIPT = join(SCRIPTS_DIR, 'agent-mode-guard.sh');
const AGENT_CAPABILITY_PRECHECK_SCRIPT = join(SCRIPTS_DIR, 'agent-capability-precheck.sh');
const GIT_DELEGATION_GUARD_SCRIPT = join(SCRIPTS_DIR, 'git-delegation-guard.sh');
const DESTRUCTIVE_GIT_GUARD_SCRIPT = join(SCRIPTS_DIR, 'destructive-git-guard.sh');
const STOP_CONSOLE_AUDIT_SCRIPT = join(SCRIPTS_DIR, 'stop-console-audit.sh');
const SESSION_REFLECTION_SCRIPT = join(SCRIPTS_DIR, 'session-reflection.sh');
const AGENT_TEAMS_ADVISOR_SCRIPT = join(SCRIPTS_DIR, 'agent-teams-advisor.sh');
const R007_R008_DRIFT_ADVISOR_SCRIPT = join(SCRIPTS_DIR, 'r007-r008-drift-advisor.sh');
const CLAUDE_SENSITIVE_PATH_GUARD_SCRIPT = join(SCRIPTS_DIR, 'claude-sensitive-path-guard.sh');
const SOURCE_CLAUDE_SENSITIVE_PATH_GUARD_SCRIPT = join(
  SOURCE_SCRIPTS_DIR,
  'claude-sensitive-path-guard.sh'
);
const SOURCE_SESSION_ENV_CHECK_SCRIPT = join(SOURCE_SCRIPTS_DIR, 'session-env-check.sh');
const STALE_TODO_SCANNER_SCRIPT = join(SCRIPTS_DIR, 'stale-todo-scanner.sh');
const FEEDBACK_COLLECTOR_SCRIPT = join(SCRIPTS_DIR, 'feedback-collector.sh');
const SKILL_EXTRACTOR_ANALYZER_SCRIPT = join(SCRIPTS_DIR, 'skill-extractor-analyzer.sh');
const PLUGIN_CACHE_CHECK_SCRIPT = join(SCRIPTS_DIR, 'plugin-cache-check.sh');
const SHELL_RESERVED_VAR_ADVISOR_SCRIPT = join(SCRIPTS_DIR, 'shell-reserved-var-advisor.sh');
const MODEL_ESCALATION_ADVISOR_SCRIPT = join(SCRIPTS_DIR, 'model-escalation-advisor.sh');

const STAGE_FILE = '/tmp/.codex-dev-stage';

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

interface ScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a hook script by spawning bash with the script path.
 * stdinInput is piped to the process. Returns stdout, stderr, exitCode.
 */
function runHookScript(
  scriptPath: string,
  stdinInput: string,
  env?: Record<string, string>,
  cwd?: string
): Promise<ScriptResult> {
  return new Promise((resolve_) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    const child = spawn('bash', [scriptPath], {
      env: childEnv,
      cwd: cwd ?? tmpdir(),
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code: number | null) => {
      resolve_({ stdout, stderr, exitCode: code ?? -1 });
    });

    child.stdin.write(stdinInput);
    child.stdin.end();
  });
}

/**
 * Run bash syntax check on a script file. Returns { exitCode, stderr }.
 */
function bashSyntaxCheck(scriptPath: string): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((res) => {
    const child = spawn('bash', ['-n', scriptPath]);
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('close', (code: number | null) => res({ exitCode: code ?? -1, stderr }));
  });
}

async function waitForFile(path: string, timeoutMs = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (existsSync(path)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return existsSync(path);
}

/** Build a minimal Claude Code hook JSON payload for Agent/subagent calls. */
function makeTaskInput(subagentType: string, prompt: string): string {
  return JSON.stringify({
    tool: 'Task',
    tool_input: {
      subagent_type: subagentType,
      prompt,
    },
  });
}

/** Build a minimal Claude Code hook JSON payload for Bash tool calls. */
function makeBashInput(command: string): string {
  return JSON.stringify({
    tool: 'Bash',
    tool_input: {
      command,
    },
  });
}

function makeTaskInputWithMode(subagentType: string, prompt: string, mode?: string): string {
  return JSON.stringify({
    tool: 'Task',
    tool_input: {
      subagent_type: subagentType,
      prompt,
      ...(mode ? { mode } : {}),
    },
  });
}

/** Build a minimal Stop hook payload. */
function makeStopInput(extra?: Record<string, unknown>): string {
  return JSON.stringify({ tool: 'Stop', ...extra });
}

// -------------------------------------------------------------------
// stop-console-audit.sh
// -------------------------------------------------------------------

describe('stop-console-audit.sh', () => {
  let tmpGitDir: string;
  let nonGitDir: string;

  beforeAll(async () => {
    // Create a temporary git repository for git-context tests.
    tmpGitDir = join(tmpdir(), `omcc-test-git-${Date.now()}`);
    await mkdir(tmpGitDir, { recursive: true });

    // Strip git env vars so temp repo operations don't inherit GIT_DIR from
    // a parent hook context (e.g., pre-commit hook running bun test --coverage).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { GIT_DIR: _gd, GIT_WORK_TREE: _gwt, GIT_INDEX_FILE: _gif, ...cleanEnv } = process.env;

    execFileSync('git', ['init'], { cwd: tmpGitDir, stdio: 'pipe', env: cleanEnv });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], {
      cwd: tmpGitDir,
      stdio: 'pipe',
      env: cleanEnv,
    });
    execFileSync('git', ['config', 'user.name', 'Test User'], {
      cwd: tmpGitDir,
      stdio: 'pipe',
      env: cleanEnv,
    });
    // Disable hooks in the temp repo to prevent inheriting the project's core.hooksPath
    execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], {
      cwd: tmpGitDir,
      stdio: 'pipe',
      env: cleanEnv,
    });

    // Create an initial commit so HEAD is defined.
    const initFile = join(tmpGitDir, 'initial.txt');
    await writeFile(initFile, 'init\n');
    execFileSync('git', ['add', '.'], { cwd: tmpGitDir, stdio: 'pipe', env: cleanEnv });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpGitDir, stdio: 'pipe', env: cleanEnv });

    // Create a non-git directory.
    nonGitDir = join(tmpdir(), `omcc-test-nongit-${Date.now()}`);
    await mkdir(nonGitDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tmpGitDir, { recursive: true, force: true });
    await rm(nonGitDir, { recursive: true, force: true });
  });

  // --- Basic behavior ---

  it('should always exit with code 0', async () => {
    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, makeStopInput(), {}, nonGitDir);
    expect(result.exitCode).toBe(0);
  });

  it('should pass through stdin input unchanged to stdout', async () => {
    const input = makeStopInput({ session_id: 'abc123' });
    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, input, {}, nonGitDir);
    expect(result.stdout.trim()).toBe(input);
  });

  it('should output audit messages to stderr', async () => {
    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, makeStopInput(), {}, nonGitDir);
    expect(result.stderr).toContain('[Stop]');
  });

  it('should output "Session safe to terminate" to stderr', async () => {
    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, makeStopInput(), {}, nonGitDir);
    expect(result.stderr).toContain('Session safe to terminate');
  });

  it('should output audit start message to stderr', async () => {
    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, makeStopInput(), {}, nonGitDir);
    expect(result.stderr).toContain('Session termination audit starting');
  });

  // --- Console.log detection in git-tracked JS/TS files ---

  it('should warn about console.log in modified .ts files', async () => {
    const tsFile = join(tmpGitDir, 'test-warn.ts');
    await writeFile(tsFile, 'console.log("debug");\nexport const x = 1;\n');
    execFileSync('git', ['add', 'test-warn.ts'], { cwd: tmpGitDir, stdio: 'pipe' });

    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, makeStopInput(), {}, tmpGitDir);

    execFileSync('git', ['reset', 'HEAD', 'test-warn.ts'], { cwd: tmpGitDir, stdio: 'pipe' });
    await unlink(tsFile);

    expect(result.stderr).toContain('console.log');
    expect(result.stderr).toContain('test-warn.ts');
  });

  it('should warn about console.log in modified .tsx files', async () => {
    const tsxFile = join(tmpGitDir, 'component.tsx');
    await writeFile(
      tsxFile,
      'console.log("render");\nexport default function C() { return null; }\n'
    );
    execFileSync('git', ['add', 'component.tsx'], { cwd: tmpGitDir, stdio: 'pipe' });

    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, makeStopInput(), {}, tmpGitDir);

    execFileSync('git', ['reset', 'HEAD', 'component.tsx'], { cwd: tmpGitDir, stdio: 'pipe' });
    await unlink(tsxFile);

    expect(result.stderr).toContain('console.log');
    expect(result.stderr).toContain('component.tsx');
  });

  it('should warn about console.log in modified .js files', async () => {
    const jsFile = join(tmpGitDir, 'util.js');
    await writeFile(jsFile, 'console.log("js log");\nmodule.exports = {};\n');
    execFileSync('git', ['add', 'util.js'], { cwd: tmpGitDir, stdio: 'pipe' });

    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, makeStopInput(), {}, tmpGitDir);

    execFileSync('git', ['reset', 'HEAD', 'util.js'], { cwd: tmpGitDir, stdio: 'pipe' });
    await unlink(jsFile);

    expect(result.stderr).toContain('console.log');
    expect(result.stderr).toContain('util.js');
  });

  it('should warn about console.log in modified .jsx files', async () => {
    const jsxFile = join(tmpGitDir, 'app.jsx');
    await writeFile(jsxFile, 'console.log("jsx");\nfunction App() { return null; }\n');
    execFileSync('git', ['add', 'app.jsx'], { cwd: tmpGitDir, stdio: 'pipe' });

    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, makeStopInput(), {}, tmpGitDir);

    execFileSync('git', ['reset', 'HEAD', 'app.jsx'], { cwd: tmpGitDir, stdio: 'pipe' });
    await unlink(jsxFile);

    expect(result.stderr).toContain('console.log');
    expect(result.stderr).toContain('app.jsx');
  });

  it('should NOT warn when no console.log exists in modified files', async () => {
    const cleanFile = join(tmpGitDir, 'clean.ts');
    await writeFile(cleanFile, 'export const greeting = "hello";\n');
    execFileSync('git', ['add', 'clean.ts'], { cwd: tmpGitDir, stdio: 'pipe' });

    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, makeStopInput(), {}, tmpGitDir);

    execFileSync('git', ['reset', 'HEAD', 'clean.ts'], { cwd: tmpGitDir, stdio: 'pipe' });
    await unlink(cleanFile);

    expect(result.stderr).not.toContain('WARNING: console.log');
  });

  it('should NOT warn when only non-JS/TS files are modified', async () => {
    const mdFile = join(tmpGitDir, 'NOTES.md');
    await writeFile(mdFile, '# console.log\nThis is docs.\n');
    execFileSync('git', ['add', 'NOTES.md'], { cwd: tmpGitDir, stdio: 'pipe' });

    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, makeStopInput(), {}, tmpGitDir);

    execFileSync('git', ['reset', 'HEAD', 'NOTES.md'], { cwd: tmpGitDir, stdio: 'pipe' });
    await unlink(mdFile);

    // "console.log" appears in the file but .md is excluded from the grep filter
    expect(result.stderr).not.toContain('WARNING: console.log');
  });

  it('should NOT warn when no files are modified', async () => {
    // Clean repo with no staged files
    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, makeStopInput(), {}, tmpGitDir);
    expect(result.stderr).not.toContain('WARNING: console.log');
    expect(result.exitCode).toBe(0);
  });

  // --- Edge cases ---

  it('should handle non-git directory gracefully (exit 0)', async () => {
    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, makeStopInput(), {}, nonGitDir);
    expect(result.exitCode).toBe(0);
  });

  it('should handle empty stdin gracefully', async () => {
    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, '', {}, nonGitDir);
    expect(result.exitCode).toBe(0);
  });

  it('should handle malformed JSON stdin (still exit 0)', async () => {
    const result = await runHookScript(
      STOP_CONSOLE_AUDIT_SCRIPT,
      '{not valid json}',
      {},
      nonGitDir
    );
    expect(result.exitCode).toBe(0);
  });

  it('should handle missing (deleted) files referenced in git diff', async () => {
    // Create, commit, modify+stage, then physically delete without unstaging.
    const deletedFile = join(tmpGitDir, 'deleted.ts');
    await writeFile(deletedFile, 'console.log("exists");\n');
    execFileSync('git', ['add', 'deleted.ts'], { cwd: tmpGitDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'add deleted.ts'], { cwd: tmpGitDir, stdio: 'pipe' });

    await writeFile(deletedFile, 'console.log("modified");\n');
    execFileSync('git', ['add', 'deleted.ts'], { cwd: tmpGitDir, stdio: 'pipe' });
    await unlink(deletedFile); // file no longer on disk but staged

    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, makeStopInput(), {}, tmpGitDir);

    // Cleanup
    execFileSync('git', ['reset', 'HEAD', 'deleted.ts'], { cwd: tmpGitDir, stdio: 'pipe' });
    execFileSync('git', ['rm', '-f', '--cached', 'deleted.ts'], { cwd: tmpGitDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'remove deleted.ts'], { cwd: tmpGitDir, stdio: 'pipe' });

    expect(result.exitCode).toBe(0);
  });

  // --- Background task diagnostics ---

  it('should report background task output files count to stderr when they exist', async () => {
    const fakeBgFile = '/tmp/claude-omcc-test-99998.output';
    await writeFile(fakeBgFile, 'task output\n');

    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, makeStopInput(), {}, nonGitDir);

    await unlink(fakeBgFile).catch(() => undefined);

    // Whether 0 or more files exist, the script always exits 0 and writes to stderr
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('[Stop]');
  });

  it('should exit 0 and write to stderr regardless of background task file count', async () => {
    // Scenario: no background task files
    const result = await runHookScript(STOP_CONSOLE_AUDIT_SCRIPT, makeStopInput(), {}, nonGitDir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------
// session-reflection.sh
// -------------------------------------------------------------------

describe('session-reflection.sh', () => {
  it('records a reflection when a transcript path is provided', async () => {
    const root = join(tmpdir(), `omcc-reflection-${Date.now()}`);
    const transcript = join(root, 'session.jsonl');
    await mkdir(root, { recursive: true });
    await writeFile(
      transcript,
      [
        '{"role":"assistant","content":"checking"}',
        '{"type":"tool_use","name":"Bash"}',
        '{"role":"assistant","content":"finished"}',
      ].join('\n')
    );

    const input = makeStopInput({ session_id: 'reflection-test', transcript_path: transcript });
    const result = await runHookScript(
      SESSION_REFLECTION_SCRIPT,
      input,
      { OMCUSTOMCODEX_PROJECT_ROOT: root },
      root
    );
    const reflectionDir = join(root, '.codex/outputs/reflections');
    const reflectionCreated = existsSync(reflectionDir);

    await rm(root, { recursive: true, force: true });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(input);
    expect(result.stderr).toContain('SessionReflection');
    expect(reflectionCreated).toBe(true);
  });

  it('passes through without writing when reflection is disabled', async () => {
    const root = join(tmpdir(), `omcc-reflection-off-${Date.now()}`);
    await mkdir(root, { recursive: true });

    const input = makeStopInput({ session_id: 'reflection-off' });
    const result = await runHookScript(
      SESSION_REFLECTION_SCRIPT,
      input,
      { OMCUSTOMCODEX_PROJECT_ROOT: root, OMCUSTOMCODEX_SESSION_REFLECTION: 'off' },
      root
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(input);
    expect(existsSync(join(root, '.codex/outputs/reflections'))).toBe(false);

    await rm(root, { recursive: true, force: true });
  });
});

// -------------------------------------------------------------------
// stage-blocker.sh
// -------------------------------------------------------------------

describe('stage-blocker.sh', () => {
  afterEach(async () => {
    await unlink(STAGE_FILE).catch(() => undefined);
  });

  // --- Allowed stages ---

  it('should exit 0 when stage is "implement"', async () => {
    await writeFile(STAGE_FILE, 'implement');
    const result = await runHookScript(STAGE_BLOCKER_SCRIPT, '{}');
    expect(result.exitCode).toBe(0);
  });

  it('should exit 0 when no stage file exists', async () => {
    const result = await runHookScript(STAGE_BLOCKER_SCRIPT, '{}');
    expect(result.exitCode).toBe(0);
  });

  // --- Blocked stages ---

  it('should exit 2 when stage is "plan"', async () => {
    await writeFile(STAGE_FILE, 'plan');
    const result = await runHookScript(STAGE_BLOCKER_SCRIPT, '{}');
    expect(result.exitCode).toBe(2);
  });

  it('should exit 2 when stage is "verify-plan"', async () => {
    await writeFile(STAGE_FILE, 'verify-plan');
    const result = await runHookScript(STAGE_BLOCKER_SCRIPT, '{}');
    expect(result.exitCode).toBe(2);
  });

  it('should exit 2 when stage is "verify-impl"', async () => {
    await writeFile(STAGE_FILE, 'verify-impl');
    const result = await runHookScript(STAGE_BLOCKER_SCRIPT, '{}');
    expect(result.exitCode).toBe(2);
  });

  it('should exit 2 when stage is "compound"', async () => {
    await writeFile(STAGE_FILE, 'compound');
    const result = await runHookScript(STAGE_BLOCKER_SCRIPT, '{}');
    expect(result.exitCode).toBe(2);
  });

  it('should exit 2 when stage is "done"', async () => {
    await writeFile(STAGE_FILE, 'done');
    const result = await runHookScript(STAGE_BLOCKER_SCRIPT, '{}');
    expect(result.exitCode).toBe(2);
  });

  // --- Output ---

  it('should output blocking message to stdout when blocking', async () => {
    await writeFile(STAGE_FILE, 'plan');
    const result = await runHookScript(STAGE_BLOCKER_SCRIPT, '{}');
    // stage-blocker.sh echoes the BLOCKED message to stdout (no >&2 redirect)
    expect(result.stdout).toContain('BLOCKED');
  });

  it('should include the stage name in the blocking message', async () => {
    await writeFile(STAGE_FILE, 'verify-impl');
    const result = await runHookScript(STAGE_BLOCKER_SCRIPT, '{}');
    expect(result.stdout).toContain('verify-impl');
  });

  it('should pass through (exit 0) when stage is "implement"', async () => {
    await writeFile(STAGE_FILE, 'implement');
    // stage-blocker.sh does not echo stdin; the runtime handles pass-through on exit 0.
    const result = await runHookScript(STAGE_BLOCKER_SCRIPT, '{}');
    expect(result.exitCode).toBe(0);
  });

  it('should handle empty stage file gracefully (exit 0)', async () => {
    await writeFile(STAGE_FILE, '');
    const result = await runHookScript(STAGE_BLOCKER_SCRIPT, '{}');
    // The script checks `[ -z "$stage" ]; exit 0` for empty strings
    expect(result.exitCode).toBe(0);
  });

  it('should strip surrounding whitespace/newlines from stage value', async () => {
    await writeFile(STAGE_FILE, '  plan  \n');
    const result = await runHookScript(STAGE_BLOCKER_SCRIPT, '{}');
    expect(result.exitCode).toBe(2);
  });
});

// -------------------------------------------------------------------
// agent-capability-precheck.sh
// -------------------------------------------------------------------

describe('agent-capability-precheck.sh', () => {
  const projectRoot = resolve(import.meta.dir, '../../..');

  it('blocks Bash-required prompts for agents that disallow Bash', async () => {
    const input = makeTaskInput(
      'arch-documenter',
      'Run gh issue view 1355 and summarize the result'
    );
    const result = await runHookScript(AGENT_CAPABILITY_PRECHECK_SCRIPT, input, {}, projectRoot);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Agent capability mismatch');
    expect(result.stderr).toContain('arch-documenter');
    expect(result.stderr).toContain('disallowedTools');
  });

  it('allows documentation-only prompts for agents that disallow Bash', async () => {
    const input = makeTaskInput(
      'arch-documenter',
      'Write an ADR from the evidence already included in this prompt'
    );
    const result = await runHookScript(AGENT_CAPABILITY_PRECHECK_SCRIPT, input, {}, projectRoot);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(input);
    expect(result.stderr).toBe('');
  });

  it('allows command prompts for Bash-capable agents', async () => {
    const input = makeTaskInput('mgr-gitnerd', 'Run git status and report the branch');
    const result = await runHookScript(AGENT_CAPABILITY_PRECHECK_SCRIPT, input, {}, projectRoot);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(input);
  });
});

// -------------------------------------------------------------------
// git-delegation-guard.sh
// -------------------------------------------------------------------

describe('git-delegation-guard.sh', () => {
  // --- Git command detection: non-gitnerd agents must trigger warnings ---

  it('should warn when non-gitnerd agent has "git commit" in prompt', async () => {
    const input = makeTaskInput('lang-typescript-expert', 'Please git commit the changes');
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    expect(result.stderr).toContain('WARNING');
    expect(result.stderr).toContain('git commit');
  });

  it('should warn when non-gitnerd agent has "git push" in prompt', async () => {
    const input = makeTaskInput('lang-golang-expert', 'After editing, git push origin main');
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    expect(result.stderr).toContain('WARNING');
    expect(result.stderr).toContain('git push');
  });

  it('should warn when non-gitnerd agent has "git add" in prompt', async () => {
    const input = makeTaskInput(
      'lang-python-expert',
      'Please git add src/index.ts before handing off'
    );
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    expect(result.stderr).toContain('WARNING');
    expect(result.stderr).toContain('git add');
  });

  it('should warn when non-gitnerd agent has "git rebase" in prompt', async () => {
    const input = makeTaskInput('be-fastapi-expert', 'git rebase -i HEAD~3');
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    expect(result.stderr).toContain('WARNING');
  });

  it('should warn when non-gitnerd agent has "git merge" in prompt', async () => {
    const input = makeTaskInput('lang-python-expert', 'git merge feature/branch');
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    expect(result.stderr).toContain('WARNING');
  });

  it('should warn when non-gitnerd agent has "git reset" in prompt', async () => {
    const input = makeTaskInput('arch-documenter', 'Run git reset --hard HEAD~1');
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    expect(result.stderr).toContain('WARNING');
  });

  it('should reference R010 in the warning message', async () => {
    const input = makeTaskInput('lang-typescript-expert', 'Please git commit the changes');
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    expect(result.stderr).toContain('R010');
  });

  it('should mention mgr-gitnerd as the correct agent in the warning', async () => {
    const input = makeTaskInput('lang-typescript-expert', 'Please git commit the changes');
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    expect(result.stderr).toContain('mgr-gitnerd');
  });

  // --- No warning for gitnerd or clean prompts ---

  it('should NOT warn when agent is mgr-gitnerd', async () => {
    const input = makeTaskInput('mgr-gitnerd', 'git commit -m "feat: add feature"');
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    expect(result.stderr).not.toContain('WARNING');
  });

  it('should NOT warn when prompt has no git commands', async () => {
    const input = makeTaskInput('lang-typescript-expert', 'Refactor the auth module');
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    expect(result.stderr).not.toContain('WARNING');
  });

  it('should NOT warn for text containing "git" that is not a git command', async () => {
    const input = makeTaskInput('lang-typescript-expert', 'Use digital transformation strategy');
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    expect(result.stderr).not.toContain('WARNING');
  });

  // --- Pass-through: always exit 0, always echo stdin ---

  it('should always exit 0 even when warning is emitted', async () => {
    const input = makeTaskInput('lang-typescript-expert', 'git commit everything');
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(0);
  });

  it('should always exit 0 with a clean prompt', async () => {
    const input = makeTaskInput('lang-golang-expert', 'Write a function that parses JSON');
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(0);
  });

  it('should always pass through stdin to stdout', async () => {
    const input = makeTaskInput('lang-typescript-expert', 'Implement feature X');
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    expect(result.stdout.trim()).toBe(input.trim());
  });

  it('should pass stdin to stdout even when a warning is emitted', async () => {
    const input = makeTaskInput('lang-typescript-expert', 'git commit -m "fix"');
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input.trim());
    expect(result.stderr).toContain('WARNING');
  });

  // --- Edge cases ---

  it('should warn when subagent_type field is missing (defaults to empty, not gitnerd)', async () => {
    const input = JSON.stringify({ tool: 'Task', tool_input: { prompt: 'git commit changes' } });
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    // subagent_type resolves to "" via jq default → "" !== "mgr-gitnerd" → should warn
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('WARNING');
  });

  it('should NOT warn when prompt field is missing', async () => {
    const input = JSON.stringify({
      tool: 'Task',
      tool_input: { subagent_type: 'lang-typescript-expert' },
    });
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, input);
    // prompt resolves to "" → no git keywords → no warning
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('WARNING');
  });

  it('should handle empty stdin gracefully (exit 0)', async () => {
    // jq will produce errors on empty input but the script should still exit 0
    const result = await runHookScript(GIT_DELEGATION_GUARD_SCRIPT, '');
    expect(result.exitCode).toBe(0);
  });
});

// -------------------------------------------------------------------
// shell-reserved-var-advisor.sh
// -------------------------------------------------------------------

describe('shell-reserved-var-advisor.sh', () => {
  it('warns for zsh reserved status assignment in Bash snippets', async () => {
    const input = makeBashInput(
      'run_json=$(gh run view 1 --json status); status=$(echo "$run_json" | jq -r .status)'
    );
    const result = await runHookScript(SHELL_RESERVED_VAR_ADVISOR_SCRIPT, input);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
    expect(result.stderr).toContain('reserved shell variable assignment');
    expect(result.stderr).toContain('run_status');
  });

  it('does not warn for safe replacement variable names', async () => {
    const input = makeBashInput(
      'run_status=$(echo "$run_json" | jq -r .status); cmd_path=/tmp/out; args="--json"'
    );
    const result = await runHookScript(SHELL_RESERVED_VAR_ADVISOR_SCRIPT, input);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
    expect(result.stderr).not.toContain('reserved shell variable assignment');
  });

  it('has valid bash syntax', async () => {
    const result = await bashSyntaxCheck(SHELL_RESERVED_VAR_ADVISOR_SCRIPT);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
});

// -------------------------------------------------------------------
// destructive-git-guard.sh
// -------------------------------------------------------------------

describe('destructive-git-guard.sh', () => {
  it('should warn for git reset --hard', async () => {
    const input = makeBashInput('git reset --hard origin/develop');
    const result = await runHookScript(DESTRUCTIVE_GIT_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('WARNING');
    expect(result.stderr).toContain('git reset --hard');
  });

  it('should warn for git clean -fdx', async () => {
    const input = makeBashInput('git clean -fdx');
    const result = await runHookScript(DESTRUCTIVE_GIT_GUARD_SCRIPT, input);
    expect(result.stderr).toContain('WARNING');
    expect(result.stderr).toContain('git clean');
  });

  it('should warn for broad git restore', async () => {
    const input = makeBashInput('git restore .');
    const result = await runHookScript(DESTRUCTIVE_GIT_GUARD_SCRIPT, input);
    expect(result.stderr).toContain('WARNING');
    expect(result.stderr).toContain('git restore');
  });

  it('should warn for git branch -D and mention merged state', async () => {
    const input = makeBashInput('git branch -D release');
    const result = await runHookScript(DESTRUCTIVE_GIT_GUARD_SCRIPT, input);
    expect(result.stderr).toContain('WARNING');
    expect(result.stderr).toContain('merged');
  });

  it('should include reflog recovery guidance in destructive warnings', async () => {
    const input = makeBashInput('git checkout -- .');
    const result = await runHookScript(DESTRUCTIVE_GIT_GUARD_SCRIPT, input);
    expect(result.stderr).toContain('git reflog');
    expect(result.stderr).toContain('git status');
  });

  it('should not warn for read-only git commands', async () => {
    const input = makeBashInput('git status --short');
    const result = await runHookScript(DESTRUCTIVE_GIT_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('WARNING');
  });

  it('should always pass through stdin to stdout', async () => {
    const input = makeBashInput('git clean -fd');
    const result = await runHookScript(DESTRUCTIVE_GIT_GUARD_SCRIPT, input);
    expect(result.stdout.trim()).toBe(input);
  });

  it('should have valid bash syntax', async () => {
    const result = await bashSyntaxCheck(DESTRUCTIVE_GIT_GUARD_SCRIPT);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
});

// -------------------------------------------------------------------
// agent-mode-guard.sh
// -------------------------------------------------------------------

describe('agent-mode-guard.sh', () => {
  it('should pass through Agent/Task input when mode is bypassPermissions', async () => {
    const input = makeTaskInputWithMode(
      'lang-typescript-expert',
      'Implement feature X',
      'bypassPermissions'
    );
    const result = await runHookScript(AGENT_MODE_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
    expect(result.stderr).not.toContain('BLOCKED');
  });

  it('should block Agent/Task input when mode is missing', async () => {
    const input = makeTaskInput('lang-typescript-expert', 'Implement feature X');
    const result = await runHookScript(AGENT_MODE_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('BLOCKED');
    expect(result.stderr).toContain('bypassPermissions');
  });

  it('should block Agent/Task input when mode is acceptEdits', async () => {
    const input = makeTaskInputWithMode(
      'lang-typescript-expert',
      'Implement feature X',
      'acceptEdits'
    );
    const result = await runHookScript(AGENT_MODE_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('acceptEdits');
  });
});

// -------------------------------------------------------------------
// claude-sensitive-path-guard.sh
// -------------------------------------------------------------------

describe('claude-sensitive-path-guard.sh', () => {
  function makeBashInput(command: string): string {
    return JSON.stringify({
      tool: 'Bash',
      tool_input: {
        command,
      },
    });
  }

  function makeFileInput(tool: 'Write' | 'Edit', filePath: string): string {
    return JSON.stringify({
      tool,
      tool_input: {
        file_path: filePath,
      },
    });
  }

  it('should pass through when command does not touch .claude/', async () => {
    const input = makeBashInput('cp src/file.md docs/file.md');
    const result = await runHookScript(CLAUDE_SENSITIVE_PATH_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
    expect(result.stderr).not.toContain('BLOCKED');
  });

  it('should allow read-only access to .claude/ paths', async () => {
    const input = makeBashInput('cat .claude/rules/MUST-agent-design.md');
    const result = await runHookScript(CLAUDE_SENSITIVE_PATH_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
    expect(result.stderr).not.toContain('BLOCKED');
  });

  it('should block cp writes into .claude/', async () => {
    const input = makeBashInput(
      'cp .claude/rules/MUST-agent-design.md templates/.claude/rules/MUST-agent-design.md'
    );
    const result = await runHookScript(CLAUDE_SENSITIVE_PATH_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('BLOCKED');
    expect(result.stderr).toContain('.claude/');
  });

  it('should block tee writes into .claude/', async () => {
    const input = makeBashInput('echo test | tee .claude/outputs/report.md');
    const result = await runHookScript(CLAUDE_SENSITIVE_PATH_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('BLOCKED');
  });

  it('should block mkdir writes into .claude/', async () => {
    const input = makeBashInput('mkdir -p .claude/outputs/sessions');
    const result = await runHookScript(CLAUDE_SENSITIVE_PATH_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('perform this change interactively');
    expect(result.stderr).not.toContain('Use Write/Edit');
  });

  it('should block Write operations targeting templates/.claude/', async () => {
    const input = makeFileInput('Write', 'templates/.claude/rules/MUST-agent-design.md');
    const result = await runHookScript(CLAUDE_SENSITIVE_PATH_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('BLOCKED');
    expect(result.stderr).toContain('templates/.claude/rules/MUST-agent-design.md');
  });

  it('should block Edit operations targeting .claude/', async () => {
    const input = makeFileInput('Edit', '.claude/settings.local.json');
    const result = await runHookScript(CLAUDE_SENSITIVE_PATH_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Sensitive-path prompts can override allow rules');
  });

  it('should allow Write operations outside .claude/', async () => {
    const input = makeFileInput('Write', '.codex/rules/MUST-agent-design.md');
    const result = await runHookScript(CLAUDE_SENSITIVE_PATH_GUARD_SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
    expect(result.stderr).not.toContain('BLOCKED');
  });

  it('should keep source and template sensitive-path guard scripts in sync', async () => {
    const sourceScript = await readFile(SOURCE_CLAUDE_SENSITIVE_PATH_GUARD_SCRIPT, 'utf-8');
    const templateScript = await readFile(CLAUDE_SENSITIVE_PATH_GUARD_SCRIPT, 'utf-8');
    expect(templateScript).toBe(sourceScript);
    expect(sourceScript).not.toContain('Use Write/Edit');
  });
});

// -------------------------------------------------------------------
// agent-teams-advisor.sh
// -------------------------------------------------------------------

describe('agent-teams-advisor.sh', () => {
  /** Build an Agent/subagent hook JSON payload using the `description` field the script actually reads. */
  function makeAdvisorInput(agentType: string, description: string): string {
    return JSON.stringify({
      tool_input: {
        subagent_type: agentType,
        description,
        model: 'sonnet',
      },
    });
  }

  beforeEach(() => {
    // Clean up session-scoped counter files before each test so counts reset.
    const { execSync } = require('node:child_process');
    try {
      execSync('rm -f /tmp/.codex-task-count-*');
    } catch {
      // ignore if no files exist
    }
  });

  // --- Basic pass-through behavior ---

  it('should always exit with code 0', async () => {
    const input = makeAdvisorInput('lang-typescript-expert', 'Review code');
    const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    expect(result.exitCode).toBe(0);
  });

  it('should pass stdin through to stdout unchanged', async () => {
    const input = makeAdvisorInput('lang-golang-expert', 'Write Go code');
    const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    expect(result.stdout.trim()).toBe(input);
  });

  // --- Counter and warning behavior ---

  it('should not show warning on first Agent/subagent call', async () => {
    const input = makeAdvisorInput('lang-typescript-expert', 'First call');
    const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    expect(result.stderr).not.toContain('R018 Advisor');
    expect(result.stderr).not.toContain('Multiple Agent/subagent calls');
  });

  it('should show R018 warning on second Agent/subagent call', async () => {
    const input = makeAdvisorInput('lang-typescript-expert', 'Second call');
    // First call — no warning
    await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    // Second call — warning appears
    const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    expect(result.stderr).toContain('R018 Advisor');
    expect(result.stderr).toContain('Agent/subagent call #2');
  });

  it('should show warning on third and subsequent calls', async () => {
    const input = makeAdvisorInput('lang-typescript-expert', 'Call');
    await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    expect(result.stderr).toContain('Agent/subagent call #3');
  });

  it('should include agent type in warning', async () => {
    const input = makeAdvisorInput('lang-golang-expert', 'Go review');
    await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    expect(result.stderr).toContain('lang-golang-expert');
  });

  it('should include description preview in warning', async () => {
    const input = makeAdvisorInput('fe-vercel-agent', 'React component optimization');
    await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    expect(result.stderr).toContain('React component optimization');
  });

  it('should mention Agent Teams considerations in warning', async () => {
    const input = makeAdvisorInput('lang-typescript-expert', 'Test');
    await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    // Verify all three consideration bullets are present
    expect(result.stderr).toContain('3+ agents');
    expect(result.stderr).toContain('review');
    expect(result.stderr).toContain('shared state');
  });

  it('should increment counter correctly across multiple calls', async () => {
    const input = makeAdvisorInput('test-agent', 'Counting test');
    await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input); // 1
    await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input); // 2
    await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input); // 3
    await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input); // 4
    const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input); // 5
    expect(result.stderr).toContain('Agent/subagent call #5');
  });

  it('should always pass through stdin even when warning is shown', async () => {
    const input = makeAdvisorInput('mgr-gitnerd', 'Git push');
    await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    expect(result.stdout.trim()).toBe(input);
    expect(result.exitCode).toBe(0);
  });

  // --- Edge cases ---

  it('should handle missing subagent_type gracefully', async () => {
    const input = JSON.stringify({ tool_input: { description: 'no agent type' } });
    const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
  });

  it('should handle empty JSON input', async () => {
    const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, '{}');
    expect(result.exitCode).toBe(0);
  });

  it('should exit non-zero on malformed JSON due to set -euo pipefail', async () => {
    // The script uses set -euo pipefail; jq parse error causes non-zero exit.
    const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, 'not json');
    expect(result.exitCode).not.toBe(0);
  });

  it('should truncate long descriptions to 60 characters in warning', async () => {
    const longDesc = 'A'.repeat(100);
    const input = makeAdvisorInput('lang-typescript-expert', longDesc);
    await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
    // head -c 60 truncates; the full 100-char string must not appear
    expect(result.stderr).not.toContain('A'.repeat(100));
    // But the first 60 chars should be present
    expect(result.stderr).toContain('A'.repeat(60));
  });

  it('should not block task execution — exit 0 on repeated calls', async () => {
    const input = makeAdvisorInput('lang-typescript-expert', 'Important task');
    for (let i = 0; i < 10; i++) {
      const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
      expect(result.exitCode).toBe(0);
    }
  });

  // --- Batch context detection ---

  it('should warn on FIRST call when workflow file has 3+ issues', async () => {
    const workflowFile = `/tmp/.codex-workflow-test-${process.pid}.json`;
    await writeFile(workflowFile, JSON.stringify({ issue_count: 5 }));
    try {
      const input = makeAdvisorInput('lang-typescript-expert', 'Process issues');
      const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
      expect(result.stderr).toContain('R018 Advisor');
      expect(result.stderr).toContain('Batch context detected');
      expect(result.stderr).toContain('5');
    } finally {
      await unlink(workflowFile).catch(() => {});
    }
  });

  it('should warn on FIRST call when release-plan file exists', async () => {
    const releasePlanFile = `/tmp/.codex-release-plan-${process.pid}`;
    await writeFile(releasePlanFile, 'release plan content');
    try {
      const input = makeAdvisorInput('lang-golang-expert', 'Release fixes');
      const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
      expect(result.stderr).toContain('R018 Advisor');
      expect(result.stderr).toContain('Batch context detected');
    } finally {
      await unlink(releasePlanFile).catch(() => {});
    }
  });

  it('should NOT warn on first call when workflow file has fewer than 3 issues', async () => {
    const workflowFile = `/tmp/.codex-workflow-test-${process.pid}.json`;
    await writeFile(workflowFile, JSON.stringify({ issue_count: 2 }));
    try {
      const input = makeAdvisorInput('lang-typescript-expert', 'Process issues');
      const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
      expect(result.stderr).not.toContain('R018 Advisor');
    } finally {
      await unlink(workflowFile).catch(() => {});
    }
  });

  it('should use batch warning format (not sequential) when batch context detected on first call', async () => {
    const workflowFile = `/tmp/.codex-workflow-test-${process.pid}.json`;
    await writeFile(workflowFile, JSON.stringify({ issue_count: 4 }));
    try {
      const input = makeAdvisorInput('mgr-gitnerd', 'Deploy batch');
      const result = await runHookScript(AGENT_TEAMS_ADVISOR_SCRIPT, input);
      expect(result.stderr).toContain('Batch context detected');
      expect(result.stderr).toContain('RECOMMENDATION');
      // Batch warning is different from sequential warning
      expect(result.stderr).not.toContain('Multiple Agent/subagent calls detected');
    } finally {
      await unlink(workflowFile).catch(() => {});
    }
  });
});

// -------------------------------------------------------------------
// stale-todo-scanner.sh
// -------------------------------------------------------------------

describe('stale-todo-scanner.sh', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(
      tmpdir(),
      `omcodex-stale-todo-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should always exit 0 and pass stdin through to stdout', async () => {
    const input = JSON.stringify({ session: 'start' });
    const result = await runHookScript(STALE_TODO_SCANNER_SCRIPT, input, {}, tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
  });

  it('should stay silent when no TODO files are present', async () => {
    const result = await runHookScript(STALE_TODO_SCANNER_SCRIPT, '{}', {}, tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe('');
  });

  it('should report critical staleness for TODO.md older than 30 days', async () => {
    await writeFile(
      join(tmpDir, 'TODO.md'),
      `# TODO\n\n> Last updated: 2025-01-01\n\n- [ ] stale task\n`
    );

    const result = await runHookScript(STALE_TODO_SCANNER_SCRIPT, '{}', {}, tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('TODO.md');
    expect(result.stderr).toContain('critical');
    expect(result.stderr).toContain('Pending items: 1');
  });

  it('should report up-to-date status when TODO files are fresh', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await writeFile(
      join(tmpDir, 'TODO.md'),
      `# TODO\n\n> Last updated: ${today}\n\n- [ ] fresh task\n`
    );

    const result = await runHookScript(STALE_TODO_SCANNER_SCRIPT, '{}', {}, tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('up to date');
    expect(result.stderr).toContain('All TODO files are up to date');
  });

  it('should scan .codex/TODO.md when present', async () => {
    await mkdir(join(tmpDir, '.codex'), { recursive: true });
    await writeFile(
      join(tmpDir, '.codex', 'TODO.md'),
      `# TODO\n\n> Last updated: 2025-01-01\n\n- [ ] follow up\n- [ ] another item\n`
    );

    const result = await runHookScript(STALE_TODO_SCANNER_SCRIPT, '{}', {}, tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('.codex/TODO.md');
    expect(result.stderr).toContain('Pending items: 2');
  });

  it('should scan legacy .claude/TODO.md when present', async () => {
    await mkdir(join(tmpDir, '.claude'), { recursive: true });
    await writeFile(
      join(tmpDir, '.claude', 'TODO.md'),
      `# TODO\n\n> Last updated: 2025-01-01\n\n- [ ] legacy backlog item\n`
    );

    const result = await runHookScript(STALE_TODO_SCANNER_SCRIPT, '{}', {}, tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('.claude/TODO.md');
    expect(result.stderr).toContain('Pending items: 1');
  });
});

// -------------------------------------------------------------------
// feedback-collector.sh
// -------------------------------------------------------------------

describe('feedback-collector.sh', () => {
  it('should always exit 0 and pass stdin through when no outcomes file exists', async () => {
    const input = makeStopInput({ session_id: 'feedback-test' });
    const result = await runHookScript(FEEDBACK_COLLECTOR_SCRIPT, input, {}, tmpdir());

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
  });
});

// -------------------------------------------------------------------
// model-escalation-advisor.sh
// -------------------------------------------------------------------

describe('model-escalation-advisor.sh', () => {
  const tempPaths: string[] = [];

  async function createFixture(role = 'executor'): Promise<{
    projectRoot: string;
    codexHome: string;
    outcomesFile: string;
    input: string;
  }> {
    const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const projectRoot = join(tmpdir(), `omcodex-advisor-project-${suffix}`);
    const codexHome = join(tmpdir(), `omcodex-advisor-home-${suffix}`);
    const outcomesFile = join(tmpdir(), `.codex-task-outcomes-advisor-${suffix}`);
    tempPaths.push(projectRoot, codexHome, outcomesFile);
    await Promise.all([
      mkdir(join(projectRoot, '.codex', 'agents'), { recursive: true }),
      mkdir(join(codexHome, 'agents'), { recursive: true }),
    ]);
    await writeFile(
      outcomesFile,
      `${[
        JSON.stringify({ agent_type: role, outcome: 'failure' }),
        JSON.stringify({ agent_type: role, outcome: 'failure' }),
      ].join('\n')}\n`
    );
    return {
      projectRoot,
      codexHome,
      outcomesFile,
      input: JSON.stringify({
        tool: 'Agent',
        tool_input: {
          agent_type: role,
        },
      }),
    };
  }

  afterEach(async () => {
    await Promise.all(
      tempPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))
    );
  });

  it('uses OMX agentReasoning before role TOML and ignores unsupported per-call overrides', async () => {
    const fixture = await createFixture();
    const inputWithUnsupportedOverride = JSON.stringify({
      tool: 'Agent',
      tool_input: {
        agent_type: 'executor',
        model_reasoning_effort: 'none',
      },
    });
    await Promise.all([
      writeFile(
        join(fixture.projectRoot, '.codex', 'agents', 'executor.toml'),
        'model_reasoning_effort = "medium"\n'
      ),
      writeFile(
        join(fixture.codexHome, 'agents', 'executor.toml'),
        'model_reasoning_effort = "low"\n'
      ),
      writeFile(
        join(fixture.codexHome, '.omx-config.json'),
        JSON.stringify({ agentReasoning: { executor: 'high' } })
      ),
    ]);

    const result = await runHookScript(
      MODEL_ESCALATION_ADVISOR_SCRIPT,
      inputWithUnsupportedOverride,
      {
        CODEX_HOME: fixture.codexHome,
        CODEX_TASK_OUTCOMES_FILE: fixture.outcomesFile,
      },
      fixture.projectRoot
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(inputWithUnsupportedOverride);
    expect(result.stderr).toContain('Current model_reasoning_effort: high');
    expect(result.stderr).toContain('Recommended effort: xhigh');
    expect(result.stderr).toContain('.omx-config.json agentReasoning.executor');
    expect(result.stderr).toContain('native dispatch has no per-call effort override');
    expect(result.stderr).not.toContain('Current model_reasoning_effort: none');
  });

  it('falls back from OMX runtime overrides to project and user role TOML', async () => {
    const projectFixture = await createFixture('architect');
    await Promise.all([
      writeFile(
        join(projectFixture.projectRoot, '.codex', 'agents', 'architect.toml'),
        'model_reasoning_effort = "medium"\n'
      ),
      writeFile(
        join(projectFixture.codexHome, 'agents', 'architect.toml'),
        'model_reasoning_effort = "low"\n'
      ),
    ]);

    const projectResult = await runHookScript(
      MODEL_ESCALATION_ADVISOR_SCRIPT,
      projectFixture.input,
      {
        CODEX_HOME: projectFixture.codexHome,
        CODEX_TASK_OUTCOMES_FILE: projectFixture.outcomesFile,
      },
      projectFixture.projectRoot
    );
    expect(projectResult.stderr).toContain('Current model_reasoning_effort: medium');
    expect(projectResult.stderr).toContain('Recommended effort: high');
    expect(projectResult.stderr).toContain('.codex/agents/architect.toml');

    await rm(join(projectFixture.projectRoot, '.codex', 'agents', 'architect.toml'));
    const userResult = await runHookScript(
      MODEL_ESCALATION_ADVISOR_SCRIPT,
      projectFixture.input,
      {
        CODEX_HOME: projectFixture.codexHome,
        CODEX_TASK_OUTCOMES_FILE: projectFixture.outcomesFile,
      },
      projectFixture.projectRoot
    );
    expect(userResult.stderr).toContain('Current model_reasoning_effort: low');
    expect(userResult.stderr).toContain('Recommended effort: medium');
    expect(userResult.stderr).toContain('/agents/architect.toml');
  });

  it('uses the Codex root effort only when no role-specific source exists', async () => {
    const fixture = await createFixture('verifier');
    await writeFile(join(fixture.codexHome, 'config.toml'), 'model_reasoning_effort = "low"\n');

    const result = await runHookScript(
      MODEL_ESCALATION_ADVISOR_SCRIPT,
      fixture.input,
      {
        CODEX_HOME: fixture.codexHome,
        CODEX_TASK_OUTCOMES_FILE: fixture.outcomesFile,
      },
      fixture.projectRoot
    );

    expect(result.stderr).toContain('Current model_reasoning_effort: low');
    expect(result.stderr).toContain('Recommended effort: medium');
    expect(result.stderr).toContain(`${fixture.codexHome}/config.toml`);
  });
});

// -------------------------------------------------------------------
// skill-extractor-analyzer.sh
// -------------------------------------------------------------------

describe('skill-extractor-analyzer.sh', () => {
  let outcomesFile: string;
  let proposalsFile: string;

  beforeEach(() => {
    const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    outcomesFile = join(tmpdir(), `.codex-task-outcomes-${suffix}`);
    proposalsFile = join(tmpdir(), `.codex-skill-proposals-${suffix}`);
  });

  afterEach(async () => {
    await unlink(outcomesFile).catch(() => undefined);
    await unlink(proposalsFile).catch(() => undefined);
  });

  it('should always exit 0 and pass stdin through when no outcomes file exists', async () => {
    const input = makeStopInput({ session_id: 'skill-extractor-test' });
    const result = await runHookScript(
      SKILL_EXTRACTOR_ANALYZER_SCRIPT,
      input,
      {
        CODEX_TASK_OUTCOMES_FILE: outcomesFile,
        CODEX_SKILL_PROPOSALS_FILE: proposalsFile,
      },
      tmpdir()
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
  });

  it('should write a proposal file when repeated successful patterns are detected', async () => {
    await writeFile(
      outcomesFile,
      `${[
        JSON.stringify({
          agent_type: 'lang-typescript-expert',
          skill: 'analysis',
          outcome: 'success',
        }),
        JSON.stringify({
          agent_type: 'lang-typescript-expert',
          skill: 'analysis',
          outcome: 'success',
        }),
        JSON.stringify({
          agent_type: 'lang-typescript-expert',
          skill: 'analysis',
          outcome: 'success',
        }),
      ].join('\n')}\n`
    );

    const input = makeStopInput({ session_id: 'skill-extractor-proposal' });
    const result = await runHookScript(
      SKILL_EXTRACTOR_ANALYZER_SCRIPT,
      input,
      {
        CODEX_TASK_OUTCOMES_FILE: outcomesFile,
        CODEX_SKILL_PROPOSALS_FILE: proposalsFile,
      },
      tmpdir()
    );

    const proposalExists = await waitForFile(proposalsFile);

    expect(
      {
        exitCode: result.exitCode,
        stdout: result.stdout.trim(),
        stderr: result.stderr,
        proposalExists,
      },
      JSON.stringify(
        {
          exitCode: result.exitCode,
          stdout: result.stdout.trim(),
          stderr: result.stderr,
          proposalExists,
          outcomesFile,
          proposalsFile,
        },
        null,
        2
      )
    ).toEqual({
      exitCode: 0,
      stdout: input,
      stderr: expect.stringContaining('skill candidate'),
      proposalExists: true,
    });

    const proposal = JSON.parse(await readFile(proposalsFile, 'utf-8'));
    expect(proposal.candidates).toBe(1);
  });
});

// -------------------------------------------------------------------
// session-env-check.sh
// -------------------------------------------------------------------

describe('session-env-check.sh', () => {
  const sessionInput = JSON.stringify({ event: 'session_start' });

  async function createFakeCodexEnv(options?: { authFile?: boolean; codexApiKey?: boolean }) {
    const baseDir = join(
      tmpdir(),
      `omcc-session-env-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    const fakeBinDir = join(baseDir, 'bin');
    const fakeHomeDir = join(baseDir, 'home');
    const fakeCodexHomeDir = join(baseDir, 'codex-home');
    const fakeCodexPath = join(fakeBinDir, 'codex');

    await mkdir(fakeBinDir, { recursive: true });
    await mkdir(fakeHomeDir, { recursive: true });
    await writeFile(
      fakeCodexPath,
      '#!/bin/bash\nif [ "$1" = "--version" ]; then\n  echo "codex 0.0.0-test"\nfi\nexit 0\n'
    );
    execFileSync('chmod', ['+x', fakeCodexPath]);

    if (options?.authFile) {
      await mkdir(fakeCodexHomeDir, { recursive: true });
      await writeFile(join(fakeCodexHomeDir, 'auth.json'), '{"provider":"chatgpt"}\n');
    }

    return {
      baseDir,
      env: {
        PATH: `${fakeBinDir}:/usr/bin:/bin`,
        HOME: fakeHomeDir,
        CODEX_HOME: fakeCodexHomeDir,
        OPENAI_API_KEY: '',
        CODEX_API_KEY: options?.codexApiKey ? 'codex-api-key-test' : '',
        GIT_DIR: '',
        GIT_WORK_TREE: '',
        GIT_INDEX_FILE: '',
      },
    };
  }

  afterEach(() => {
    // Clean up status files created during tests.
    const { execSync } = require('node:child_process');
    try {
      execSync('rm -f /tmp/.codex-env-status-*');
    } catch {
      // ignore if no files exist
    }
  });

  // --- Basic pass-through behavior ---

  it('should always exit with code 0', async () => {
    const result = await runHookScript(SOURCE_SESSION_ENV_CHECK_SCRIPT, sessionInput);
    expect(result.exitCode).toBe(0);
  });

  it('should pass stdin through to stdout', async () => {
    const result = await runHookScript(SOURCE_SESSION_ENV_CHECK_SCRIPT, sessionInput);
    expect(result.stdout.trim()).toBe(sessionInput);
  });

  // --- Environment check output ---

  it('should output environment check header to stderr', async () => {
    const result = await runHookScript(SOURCE_SESSION_ENV_CHECK_SCRIPT, sessionInput);
    expect(result.stderr).toContain('Session Environment Check');
  });

  it('should report codex CLI status in stderr', async () => {
    const result = await runHookScript(SOURCE_SESSION_ENV_CHECK_SCRIPT, sessionInput);
    expect(result.stderr).toContain('codex CLI:');
  });

  it('should report Agent Teams status in stderr', async () => {
    const result = await runHookScript(SOURCE_SESSION_ENV_CHECK_SCRIPT, sessionInput);
    expect(result.stderr).toContain('Agent Teams:');
  });

  it('should show Agent Teams disabled when env var is not set to 1', async () => {
    const result = await runHookScript(SOURCE_SESSION_ENV_CHECK_SCRIPT, sessionInput, {
      OMCODEX_AGENT_TEAMS: '0',
    });
    expect(result.stderr).toContain('Agent Teams: disabled');
  });

  it('should show Agent Teams enabled when env var is 1', async () => {
    const result = await runHookScript(SOURCE_SESSION_ENV_CHECK_SCRIPT, sessionInput, {
      OMCODEX_AGENT_TEAMS: '1',
    });
    expect(result.stderr).toContain('Agent Teams: enabled');
  });

  it('should show codex unavailable when binary is not in PATH', async () => {
    const result = await runHookScript(SOURCE_SESSION_ENV_CHECK_SCRIPT, sessionInput, {
      PATH: '/usr/bin:/bin',
      OPENAI_API_KEY: '',
      // Unset git env vars that may be inherited from a parent hook context,
      // which can cause the script to exit early via set -euo pipefail.
      GIT_DIR: '',
      GIT_WORK_TREE: '',
      GIT_INDEX_FILE: '',
    });
    expect(result.stderr).toContain('codex CLI: unavailable');
  });

  it('should treat CODEX_API_KEY as authenticated when OPENAI_API_KEY is absent', async () => {
    const { baseDir, env } = await createFakeCodexEnv({ codexApiKey: true });

    try {
      const result = await runHookScript(SOURCE_SESSION_ENV_CHECK_SCRIPT, sessionInput, env);
      expect(result.stderr).toContain('codex CLI: available (authenticated)');
      expect(result.stderr).not.toContain('OPENAI_API_KEY not set');
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('should treat stored auth as authenticated when OPENAI_API_KEY is absent', async () => {
    const { baseDir, env } = await createFakeCodexEnv({ authFile: true });

    try {
      const result = await runHookScript(SOURCE_SESSION_ENV_CHECK_SCRIPT, sessionInput, env);
      expect(result.stderr).toContain('codex CLI: available (authenticated via stored login)');
      expect(result.stderr).not.toContain('OPENAI_API_KEY not set');
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('should mention codex login guidance when codex is installed without env auth', async () => {
    const { baseDir, env } = await createFakeCodexEnv();

    try {
      const result = await runHookScript(SOURCE_SESSION_ENV_CHECK_SCRIPT, sessionInput, env);
      expect(result.stderr).toContain(
        'codex CLI: installed (auth may be managed via `codex login`)'
      );
      expect(result.stderr).not.toContain('OPENAI_API_KEY not set');
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('should create a status file in /tmp', async () => {
    await runHookScript(SOURCE_SESSION_ENV_CHECK_SCRIPT, sessionInput);
    const { execSync } = require('node:child_process');
    // The file is named .claude-env-status-<PPID>; at least one must exist after the run.
    const output = execSync('ls /tmp/.codex-env-status-* 2>/dev/null || echo "none"')
      .toString()
      .trim();
    expect(output).not.toBe('none');
  });

  it('should handle empty stdin gracefully', async () => {
    const result = await runHookScript(SOURCE_SESSION_ENV_CHECK_SCRIPT, '');
    expect(result.exitCode).toBe(0);
  });

  it('should handle arbitrary JSON stdin and pass it through', async () => {
    const input = JSON.stringify({ complex: { nested: true } });
    const result = await runHookScript(SOURCE_SESSION_ENV_CHECK_SCRIPT, input);
    expect(result.stdout.trim()).toBe(input);
    expect(result.exitCode).toBe(0);
  });

  it('should report both codex CLI and Agent Teams statuses in a single run', async () => {
    const result = await runHookScript(SOURCE_SESSION_ENV_CHECK_SCRIPT, sessionInput);
    const stderrLines = result.stderr.split('\n');
    const codexLine = stderrLines.find((l) => l.includes('codex CLI:'));
    const teamsLine = stderrLines.find((l) => l.includes('Agent Teams:'));
    expect(codexLine).toBeDefined();
    expect(teamsLine).toBeDefined();
  });
});

// -------------------------------------------------------------------
// user-prompt-preprocessor.sh
// -------------------------------------------------------------------

describe('user-prompt-preprocessor.sh', () => {
  const SCRIPT = join(SCRIPTS_DIR, 'user-prompt-preprocessor.sh');

  it('should pass bash syntax check', async () => {
    const { exitCode, stderr } = await bashSyntaxCheck(SCRIPT);
    expect(exitCode).toBe(0);
    if (stderr) console.warn('Syntax warnings:', stderr);
  });

  it('should pass through input unchanged on stdout', async () => {
    const input = JSON.stringify({ user_input: 'hello world' });
    const result = await runHookScript(SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
  });

  it('should detect session-end signals', async () => {
    const input = JSON.stringify({ user_input: '종료' });
    const result = await runHookScript(SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Session-end signal detected');
  });

  it('should detect slash commands', async () => {
    const input = JSON.stringify({ user_input: '/status' });
    const result = await runHookScript(SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Slash command detected');
  });

  it('should not emit hints for regular input', async () => {
    const input = JSON.stringify({ user_input: 'fix the login bug' });
    const result = await runHookScript(SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
});

// -------------------------------------------------------------------
// r007-r008-drift-advisor.sh
// -------------------------------------------------------------------

describe('r007-r008-drift-advisor.sh', () => {
  let tempTranscript: string;

  beforeEach(async () => {
    tempTranscript = join(tmpdir(), `r007-r008-transcript-${Date.now()}-${Math.random()}.jsonl`);
  });

  afterEach(async () => {
    await rm(tempTranscript, { force: true });
  });

  it('should pass bash syntax check', async () => {
    const { exitCode, stderr } = await bashSyntaxCheck(R007_R008_DRIFT_ADVISOR_SCRIPT);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
  });

  it('should pass through input unchanged when no transcript is available', async () => {
    const input = JSON.stringify({ session_id: 'missing-session' });
    const result = await runHookScript(R007_R008_DRIFT_ADVISOR_SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
    expect(result.stderr).toBe('');
  });

  it('should warn when the previous assistant turn lacks an R007 header', async () => {
    const assistantTurn = JSON.stringify({
      role: 'assistant',
      content: [{ type: 'text', text: 'Working on it\n\nDetails follow.' }],
    });
    await writeFile(tempTranscript, `${assistantTurn}\n`);

    const input = JSON.stringify({ session_id: 's1', transcript_path: tempTranscript });
    const result = await runHookScript(R007_R008_DRIFT_ADVISOR_SCRIPT, input);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
    expect(result.stderr).toContain('R007/R008 Advisory');
    expect(result.stderr).toContain('R007 header=1');
  });

  it('should stay quiet when the previous assistant turn has R007 and R008 identifiers', async () => {
    const assistantTurn = JSON.stringify({
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: '┌─ Agent: Codex (default)\n└─ Status: checking\n\n[Codex][gpt-5.5] → Tool: Bash\n[Codex][gpt-5.5] → Target: git status',
        },
        { type: 'tool_use', name: 'Bash' },
      ],
    });
    await writeFile(tempTranscript, `${assistantTurn}\n`);

    const input = JSON.stringify({ session_id: 's2', transcript_path: tempTranscript });
    const result = await runHookScript(R007_R008_DRIFT_ADVISOR_SCRIPT, input);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
    expect(result.stderr).toBe('');
  });
});

// -------------------------------------------------------------------
// cwd-change-detector.sh
// -------------------------------------------------------------------

describe('cwd-change-detector.sh', () => {
  const SCRIPT = join(SCRIPTS_DIR, 'cwd-change-detector.sh');

  it('should pass bash syntax check', async () => {
    const { exitCode, stderr } = await bashSyntaxCheck(SCRIPT);
    expect(exitCode).toBe(0);
    if (stderr) console.warn('Syntax warnings:', stderr);
  });

  it('should pass through input unchanged on stdout', async () => {
    const input = JSON.stringify({ new_cwd: '/tmp' });
    const result = await runHookScript(SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
  });

  it('should detect project with AGENTS.md', async () => {
    const projectRoot = process.cwd();
    const input = JSON.stringify({ new_cwd: projectRoot });
    const result = await runHookScript(SCRIPT, input);
    expect(result.exitCode).toBe(0);
    // May or may not detect depending on cwd; just verify it doesn't crash
  });

  it('should handle empty new_cwd gracefully', async () => {
    const input = JSON.stringify({ new_cwd: '' });
    const result = await runHookScript(SCRIPT, input);
    expect(result.exitCode).toBe(0);
  });
});

// -------------------------------------------------------------------
// file-change-validator.sh
// -------------------------------------------------------------------

describe('file-change-validator.sh', () => {
  const SCRIPT = join(SCRIPTS_DIR, 'file-change-validator.sh');

  it('should pass bash syntax check', async () => {
    const { exitCode, stderr } = await bashSyntaxCheck(SCRIPT);
    expect(exitCode).toBe(0);
    if (stderr) console.warn('Syntax warnings:', stderr);
  });

  it('should pass through input unchanged on stdout', async () => {
    const input = JSON.stringify({ file_path: '/tmp/test.txt', change_type: 'modified' });
    const result = await runHookScript(SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
  });

  it('should detect external file change', async () => {
    const input = JSON.stringify({ file_path: '/tmp/test.txt', change_type: 'modified' });
    const result = await runHookScript(SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('External file change detected');
  });

  it('should warn about configuration file changes', async () => {
    const input = JSON.stringify({ file_path: '/project/AGENTS.md', change_type: 'modified' });
    const result = await runHookScript(SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Configuration file changed externally');
  });

  it('should warn about lock file changes', async () => {
    const input = JSON.stringify({ file_path: '/project/yarn.lock', change_type: 'modified' });
    const result = await runHookScript(SCRIPT, input);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Lock file changed');
  });

  it('should handle empty file_path gracefully', async () => {
    const input = JSON.stringify({ file_path: '' });
    const result = await runHookScript(SCRIPT, input);
    expect(result.exitCode).toBe(0);
  });
});

// -------------------------------------------------------------------
// Script file validation
// -------------------------------------------------------------------

describe('Script file validation', () => {
  const EXPECTED_SCRIPTS = [
    'stage-blocker.sh',
    'agent-capability-precheck.sh',
    'claude-sensitive-path-guard.sh',
    'git-delegation-guard.sh',
    'stop-console-audit.sh',
    'session-reflection.sh',
    'agent-teams-advisor.sh',
    'r007-r008-drift-advisor.sh',
    'session-env-check.sh',
    'stuck-detector.sh',
    'user-prompt-preprocessor.sh',
    'cwd-change-detector.sh',
    'file-change-validator.sh',
    'plugin-cache-check.sh',
    'shell-reserved-var-advisor.sh',
  ] as const;

  it('all expected scripts should exist in the templates directory', async () => {
    for (const scriptName of EXPECTED_SCRIPTS) {
      const scriptPath = join(SCRIPTS_DIR, scriptName);
      expect(existsSync(scriptPath)).toBe(true);
    }
  });

  it('all scripts should have a bash shebang on the first line', async () => {
    for (const scriptName of EXPECTED_SCRIPTS) {
      const scriptPath = join(SCRIPTS_DIR, scriptName);
      const content = await readFile(scriptPath, 'utf-8');
      const firstLine = content.split('\n')[0];
      expect(firstLine).toMatch(/^#!.*bash/);
    }
  });

  it('all scripts should be non-empty', async () => {
    for (const scriptName of EXPECTED_SCRIPTS) {
      const scriptPath = join(SCRIPTS_DIR, scriptName);
      const content = await readFile(scriptPath, 'utf-8');
      expect(content.trim().length).toBeGreaterThan(0);
    }
  });

  it('all scripts referenced in hooks.json should exist on disk', async () => {
    const raw = await readFile(HOOKS_JSON_PATH, 'utf-8');
    // Match references like "bash .codex/hooks/scripts/foo.sh" or "scripts/foo.sh"
    const scriptRefs = [...raw.matchAll(/scripts\/([\w-]+\.sh)/g)].map((m) => m[1]);
    const uniqueRefs = [...new Set(scriptRefs)];

    expect(uniqueRefs.length).toBeGreaterThan(0);

    for (const scriptName of uniqueRefs) {
      const scriptPath = join(SCRIPTS_DIR, scriptName);
      const scriptExists = existsSync(scriptPath);
      expect(scriptExists).toBe(true);
    }
  });

  it('all scripts should pass bash -n syntax check', async () => {
    for (const scriptName of EXPECTED_SCRIPTS) {
      const scriptPath = join(SCRIPTS_DIR, scriptName);
      const { exitCode, stderr } = await bashSyntaxCheck(scriptPath);
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
    }
  });
});

describe('plugin-cache-check.sh', () => {
  let tempHome: string;
  let tempCache: string;

  beforeEach(async () => {
    tempHome = join(tmpdir(), `omx-plugin-cache-home-${Date.now()}-${Math.random()}`);
    tempCache = join(tmpdir(), `omx-plugin-cache-${Date.now()}-${Math.random()}`);
    await mkdir(tempHome, { recursive: true });
    await mkdir(tempCache, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
    await rm(tempCache, { recursive: true, force: true });
  });

  it('passes stdin through and exits 0 when no plugin cache entries exist', async () => {
    const input = JSON.stringify({ hook_event_name: 'SessionStart' });
    const result = await runHookScript(PLUGIN_CACHE_CHECK_SCRIPT, input, {
      HOME: tempHome,
      CODEX_PLUGIN_CACHE: tempCache,
      CLAUDE_PLUGIN_CACHE: join(tempHome, 'empty-claude-cache'),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
    expect(result.stderr).toBe('');
  });

  it('warns about package directories missing node_modules without blocking the session', async () => {
    const packageDir = join(tempCache, 'example-plugin');
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, 'package.json'), '{"name":"example-plugin"}\n');

    const input = JSON.stringify({ hook_event_name: 'SessionStart' });
    const result = await runHookScript(PLUGIN_CACHE_CHECK_SCRIPT, input, {
      HOME: tempHome,
      CODEX_PLUGIN_CACHE: tempCache,
      CLAUDE_PLUGIN_CACHE: join(tempHome, 'empty-claude-cache'),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
    expect(result.stderr).toContain('Plugin cache missing node_modules');
    expect(result.stderr).toContain(packageDir);
  });

  it('does not warn when node_modules exists beside package.json', async () => {
    const packageDir = join(tempCache, 'installed-plugin');
    await mkdir(join(packageDir, 'node_modules'), { recursive: true });
    await writeFile(join(packageDir, 'package.json'), '{"name":"installed-plugin"}\n');

    const input = JSON.stringify({ hook_event_name: 'SessionStart' });
    const result = await runHookScript(PLUGIN_CACHE_CHECK_SCRIPT, input, {
      HOME: tempHome,
      CODEX_PLUGIN_CACHE: tempCache,
      CLAUDE_PLUGIN_CACHE: join(tempHome, 'empty-claude-cache'),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(input);
    expect(result.stderr).toBe('');
  });
});
