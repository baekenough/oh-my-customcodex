/**
 * Additional doctor check tests for uncovered warning paths
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkContexts, checkGuides, checkHooks } from '../../../src/cli/doctor.js';

function nativeHooksRegistry(): string {
  return JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: '^Bash$',
          hooks: [{ type: 'command', command: 'echo validated', timeout: 5 }],
        },
      ],
    },
  });
}

describe('doctor check warning paths', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-doctor-checks-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('checkGuides', () => {
    it('should warn when guides directory exists but is empty (0 topics)', async () => {
      // Setup: create empty guides directory
      const guidesDir = join(tempDir, 'guides');
      await mkdir(guidesDir, { recursive: true });

      const result = await checkGuides(tempDir);

      expect(result.status).toBe('warn');
      expect(result.name).toBe('Guides');
      expect(result.message).toContain('0 topics found');
      expect(result.fixable).toBe(false);
    });

    it('should pass when guides directory has subdirectories', async () => {
      // Setup: create guides directory with topics
      const guidesDir = join(tempDir, 'guides');
      await mkdir(join(guidesDir, 'golang'), { recursive: true });
      await mkdir(join(guidesDir, 'python'), { recursive: true });

      const result = await checkGuides(tempDir);

      expect(result.status).toBe('pass');
      expect(result.message).toContain('2 topics');
    });

    it('should fail when guides directory does not exist', async () => {
      // No guides directory created

      const result = await checkGuides(tempDir);

      expect(result.status).toBe('fail');
      expect(result.message).toContain('not found');
      expect(result.fixable).toBe(true);
    });
  });

  describe('checkHooks', () => {
    it('should fail when only native hook scripts exist', async () => {
      const scriptsDir = join(tempDir, '.codex', 'hooks', 'scripts');
      await mkdir(scriptsDir, { recursive: true });
      await writeFile(join(scriptsDir, 'pre-tool-use.sh'), '#!/bin/bash');

      const result = await checkHooks(tempDir);

      expect(result.status).toBe('fail');
      expect(result.name).toBe('Hooks');
      expect(result.message).toContain('.codex/hooks.json');
      expect(result.details).toEqual(['Missing native hook registry: .codex/hooks.json']);
      expect(result.fixable).toBe(false);
    });

    it('should fail when only the compatibility registry exists', async () => {
      const compatibilityDir = join(tempDir, '.codex', 'hooks', 'compatibility');
      await mkdir(compatibilityDir, { recursive: true });
      await writeFile(join(compatibilityDir, 'claude-hooks.json'), nativeHooksRegistry());

      const result = await checkHooks(tempDir);

      expect(result.status).toBe('fail');
      expect(result.details).toEqual(['Missing native hook registry: .codex/hooks.json']);
    });

    it('should pass when the root native registry is structurally valid', async () => {
      await mkdir(join(tempDir, '.codex'), { recursive: true });
      await writeFile(join(tempDir, '.codex', 'hooks.json'), nativeHooksRegistry());

      const result = await checkHooks(tempDir);

      expect(result.status).toBe('pass');
      expect(result.message).toContain('1 events');
    });

    it('should fail with actionable details when the root registry is malformed JSON', async () => {
      await mkdir(join(tempDir, '.codex'), { recursive: true });
      await writeFile(join(tempDir, '.codex', 'hooks.json'), '{"hooks":');

      const result = await checkHooks(tempDir);

      expect(result.status).toBe('fail');
      expect(result.message).toContain('malformed');
      expect(result.details?.[0]).toContain('Invalid JSON');
      expect(result.fixable).toBe(false);
    });

    it('should fail when the root registry violates the native hook contract', async () => {
      await mkdir(join(tempDir, '.codex'), { recursive: true });
      await writeFile(
        join(tempDir, '.codex', 'hooks.json'),
        JSON.stringify({ hooks: { PreToolUse: [{ matcher: '^Bash$' }] } })
      );

      const result = await checkHooks(tempDir);

      expect(result.status).toBe('fail');
      expect(result.details?.[0]).toContain('Invalid Codex hook registry');
    });

    for (const [label, registry] of [
      ['has no events', { hooks: {} }],
      ['has no event groups', { hooks: { PreToolUse: [] } }],
      ['has no runnable handlers', { hooks: { PreToolUse: [{ matcher: '^Bash$', hooks: [] }] } }],
    ] as const) {
      it(`should fail when the root registry ${label}`, async () => {
        await mkdir(join(tempDir, '.codex'), { recursive: true });
        await writeFile(join(tempDir, '.codex', 'hooks.json'), JSON.stringify(registry));

        const result = await checkHooks(tempDir);

        expect(result.status).toBe('fail');
        expect(result.details?.[0]).toContain('at least one runnable command handler');
      });
    }

    it('should fail when the root registry uses an unsupported event name', async () => {
      await mkdir(join(tempDir, '.codex'), { recursive: true });
      await writeFile(
        join(tempDir, '.codex', 'hooks.json'),
        JSON.stringify({
          hooks: {
            IgnoredByCodex: [
              { hooks: [{ type: 'command', command: 'echo never-runs', timeout: 5 }] },
            ],
          },
        })
      );

      const result = await checkHooks(tempDir);

      expect(result.status).toBe('fail');
      expect(result.details?.[0]).toContain('Unsupported Codex hook event: IgnoredByCodex');
    });
  });

  describe('checkContexts', () => {
    it('should warn when contexts directory exists but is empty', async () => {
      // Setup: create empty contexts directory
      const contextsDir = join(tempDir, '.codex', 'contexts');
      await mkdir(contextsDir, { recursive: true });

      const result = await checkContexts(tempDir);

      expect(result.status).toBe('warn');
      expect(result.name).toBe('Contexts');
      expect(result.message).toContain('directory is empty');
      expect(result.fixable).toBe(false);
    });

    it('should pass when contexts directory has markdown files', async () => {
      // Setup: create contexts directory with files
      const contextsDir = join(tempDir, '.codex', 'contexts');
      await mkdir(contextsDir, { recursive: true });
      await writeFile(join(contextsDir, 'dev.md'), '# Development context');
      await writeFile(join(contextsDir, 'prod.md'), '# Production context');

      const result = await checkContexts(tempDir);

      expect(result.status).toBe('pass');
      expect(result.message).toContain('2 files');
    });

    it('should fail when contexts directory does not exist', async () => {
      // No contexts directory created

      const result = await checkContexts(tempDir);

      expect(result.status).toBe('fail');
      expect(result.message).toContain('not found');
      expect(result.fixable).toBe(true);
    });

    it('should count only .md files', async () => {
      // Setup: create contexts directory with mixed files
      const contextsDir = join(tempDir, '.codex', 'contexts');
      await mkdir(contextsDir, { recursive: true });
      await writeFile(join(contextsDir, 'dev.md'), '# Dev');
      await writeFile(join(contextsDir, 'staging.md'), '# Staging');
      await writeFile(join(contextsDir, 'config.json'), '{}'); // Should not be counted
      await writeFile(join(contextsDir, 'readme.txt'), 'not markdown'); // Should not be counted

      const result = await checkContexts(tempDir);

      expect(result.status).toBe('pass');
      expect(result.message).toContain('2 files'); // Only .md files
    });
  });

  describe('edge cases', () => {
    it('should handle guides directory with files but no subdirectories', async () => {
      // Setup: create guides directory with files (not subdirectories)
      const guidesDir = join(tempDir, 'guides');
      await mkdir(guidesDir, { recursive: true });
      await writeFile(join(guidesDir, 'README.md'), '# Guides');
      await writeFile(join(guidesDir, 'index.md'), '# Index');

      const result = await checkGuides(tempDir);

      // Should warn because countDirectories only counts directories, not files
      expect(result.status).toBe('warn');
      expect(result.message).toContain('0 topics');
    });

    it('should handle custom rootDir parameter for hooks', async () => {
      // Test with custom root directory
      const customRoot = '.custom';
      await mkdir(join(tempDir, customRoot), { recursive: true });
      await writeFile(join(tempDir, customRoot, 'hooks.json'), nativeHooksRegistry());

      const result = await checkHooks(tempDir, customRoot);

      expect(result.status).toBe('pass');
      expect(result.message).toContain('Hooks OK');
    });

    it('should handle custom rootDir parameter for contexts', async () => {
      // Test with custom root directory
      const customRoot = '.custom';
      const contextsDir = join(tempDir, customRoot, 'contexts');
      await mkdir(contextsDir, { recursive: true });
      await writeFile(join(contextsDir, 'dev.md'), '# Dev');

      const result = await checkContexts(tempDir, customRoot);

      expect(result.status).toBe('pass');
      expect(result.message).toContain('Contexts OK');
    });

    it('should handle nested subdirectories in guides', async () => {
      // Setup: create nested structure in guides
      const guidesDir = join(tempDir, 'guides');
      await mkdir(join(guidesDir, 'golang', 'advanced'), { recursive: true });
      await mkdir(join(guidesDir, 'python'), { recursive: true });

      const result = await checkGuides(tempDir);

      // countDirectories only counts one level deep
      expect(result.status).toBe('pass');
      expect(result.message).toContain('2 topics'); // golang and python
    });
  });
});
