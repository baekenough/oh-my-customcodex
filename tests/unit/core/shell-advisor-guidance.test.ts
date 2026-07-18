import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dir, '../../..');

describe('FSD and R020 Code Mode shell status guidance', () => {
  for (const relativePath of [
    '.codex/skills/fsd/SKILL.md',
    '.codex/rules/MUST-completion-verification.md',
  ]) {
    it(`${relativePath} requires exact readiness and numeric Code Mode completion`, async () => {
      const source = await readFile(resolve(PROJECT_ROOT, relativePath), 'utf8');
      const template = await readFile(
        resolve(PROJECT_ROOT, 'templates/.claude', relativePath.replace(/^\.codex\//, '')),
        'utf8'
      );

      expect(template).toBe(source);
      expect(source).toContain('omcustomcodex doctor --require-shell-advisor');
      expect(source).toContain('omcustomcodex update --hooks');
      expect(source).toContain('[features] hooks = true');
      expect(source).toContain('trust the project');
      expect(source).toContain('/hooks');
      expect(source).toContain('untrusted linked checkout');
      expect(source.toLowerCase()).toContain('never write trust state automatically');
      expect(source).toContain('tools.exec_command');
      expect(source).toContain('Bash PreToolUse');
      expect(source).toContain('exit_code');
      expect(source).toContain('status=$?');
      expect(source).toContain('path=...');
      expect(source).toContain('argv=...');
      expect(source).toContain('set -euo pipefail');
      expect(source).toContain('terminal');
      expect(source).toContain('outer JavaScript parser');
      expect(source).toContain('NATIVE_TOOL_NAMES');
      expect(source).toContain('advisory');
    });
  }

  it('does not widen the Codex-native tool map or add an outer Code Mode parser', async () => {
    const source = await readFile(resolve(PROJECT_ROOT, 'src/core/codex-hooks.ts'), 'utf8');
    const nativeToolMap = source.match(/const NATIVE_TOOL_NAMES:[\s\S]*?\n};/)?.[0];

    expect(nativeToolMap).toBeDefined();
    expect(nativeToolMap).not.toContain('functions.exec');
    expect(nativeToolMap).not.toContain('exec_command');
    expect(source).not.toContain('parseCodeModeJavaScript');
  });
});
