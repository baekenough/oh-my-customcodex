import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '../../../.codex/hooks/scripts/playwright-compress.sh');
const HOOKS_JSON = resolve(import.meta.dir, '../../../.codex/hooks/hooks.json');
const TEMPLATE_SCRIPT = resolve(
  import.meta.dir,
  '../../../templates/.claude/hooks/scripts/playwright-compress.sh'
);
const TEMPLATE_HOOKS_JSON = resolve(import.meta.dir, '../../../templates/.claude/hooks/hooks.json');

interface ScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runScript(stdinInput: string): Promise<ScriptResult> {
  return new Promise((resolveResult) => {
    const child = spawn('bash', [SCRIPT], {
      env: process.env,
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
      resolveResult({
        stdout,
        stderr,
        exitCode: code ?? -1,
      });
    });

    child.stdin.write(stdinInput);
    child.stdin.end();
  });
}

describe('playwright-compress.sh', () => {
  it('passes bash syntax validation', async () => {
    const child = spawn('bash', ['-n', SCRIPT]);
    const exitCode = await new Promise<number>((resolveCode) => {
      child.on('close', (code: number | null) => resolveCode(code ?? -1));
    });

    expect(exitCode).toBe(0);
  });

  it('does not emit replacement output for short payloads', async () => {
    const input = JSON.stringify({
      tool_name: 'mcp__playwright__snapshot',
      tool_response: 'short payload ref=btn-1',
    });

    const result = await runScript(input);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it('emits valid updatedMCPToolOutput for long payloads', async () => {
    const longPayload = Array.from(
      { length: 90 },
      () => 'line ref=btn-1 url=https://example.com title=Home text=Click me'
    ).join('\n');

    const input = JSON.stringify({
      tool_name: 'mcp__playwright__snapshot',
      tool_response: longPayload,
    });

    const result = await runScript(input);
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(parsed.additionalContext).toContain('Playwright MCP output compressed');
    expect(parsed.updatedMCPToolOutput).toContain('ref=btn-1');
    expect(parsed.updatedMCPToolOutput).toContain('https://example.com');
    expect(parsed.updatedMCPToolOutput).toContain('Original size');
  });

  it('stays non-fatal for long payloads without refs or urls', async () => {
    const longPayload = Array.from(
      { length: 120 },
      () => 'plain long line without refs or urls'
    ).join('\n');

    const input = JSON.stringify({
      tool_name: 'mcp__playwright__snapshot',
      tool_response: longPayload,
    });

    const result = await runScript(input);
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(parsed.updatedMCPToolOutput).toContain('Original size');
    expect(parsed.updatedMCPToolOutput).toContain('plain long line without refs or urls');
  });

  it('registers the compressor in the live Codex hooks file', async () => {
    const content = await readFile(HOOKS_JSON, 'utf8');
    const parsed = JSON.parse(content);
    const postToolUse = parsed.hooks?.PostToolUse ?? [];

    const hook = postToolUse.find(
      (entry: { matcher?: string; hooks?: Array<{ command?: string }> }) =>
        entry.matcher === 'tool matches "^mcp__playwright__"' &&
        entry.hooks?.some(
          (item) => item.command === 'bash .codex/hooks/scripts/playwright-compress.sh'
        )
    );

    expect(hook).toBeDefined();
  });

  it('keeps the shipped template hook in sync with the live one', async () => {
    const [liveContent, templateContent] = await Promise.all([
      readFile(HOOKS_JSON, 'utf8'),
      readFile(TEMPLATE_HOOKS_JSON, 'utf8'),
    ]);

    const liveParsed = JSON.parse(liveContent);
    const templateParsed = JSON.parse(templateContent);
    const livePostToolUse = liveParsed.hooks?.PostToolUse ?? [];
    const templatePostToolUse = templateParsed.hooks?.PostToolUse ?? [];

    const liveHook = livePostToolUse.find(
      (entry: { matcher?: string; hooks?: Array<{ command?: string }> }) =>
        entry.matcher === 'tool matches "^mcp__playwright__"' &&
        entry.hooks?.some(
          (item) => item.command === 'bash .codex/hooks/scripts/playwright-compress.sh'
        )
    );
    const templateHook = templatePostToolUse.find(
      (entry: { matcher?: string; hooks?: Array<{ command?: string }> }) =>
        entry.matcher === 'tool matches "^mcp__playwright__"' &&
        entry.hooks?.some(
          (item) => item.command === 'bash .codex/hooks/scripts/playwright-compress.sh'
        )
    );

    expect(liveHook).toBeDefined();
    expect(templateHook).toBeDefined();
  });

  it('ships the template compressor script alongside the live script', async () => {
    const [liveScript, templateScript] = await Promise.all([
      readFile(SCRIPT, 'utf8'),
      readFile(TEMPLATE_SCRIPT, 'utf8'),
    ]);

    expect(templateScript).toBe(liveScript);
  });
});
