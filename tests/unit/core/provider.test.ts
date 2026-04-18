import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectProvider, type ProviderDetection } from '../../../src/core/provider.js';

describe('provider detection', () => {
  describe('detectProvider', () => {
    it('should return codex as default provider', async () => {
      const result = await detectProvider();

      expect(result.provider).toBe('codex');
      expect(result.source).toBe('default');
      expect(result.confidence).toBe('high');
      expect(result.reason).toBe('codex-default');
    });

    it('should return codex when codex runtime files exist', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'omcodex-provider-test-'));
      try {
        await mkdir(join(tempDir, '.codex'), { recursive: true });
        await writeFile(join(tempDir, 'AGENTS.md'), '# Test');

        const result = await detectProvider({ targetDir: tempDir });

        expect(result.provider).toBe('codex');
        expect(result.source).toBe('filesystem');
        expect(result.reason).toBe('codex-runtime-found');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should return claude when only claude runtime files exist', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'omcodex-provider-test-'));
      try {
        await mkdir(join(tempDir, '.claude'), { recursive: true });
        await writeFile(join(tempDir, 'CLAUDE.md'), '# Test');

        const result = await detectProvider({ targetDir: tempDir });

        expect(result.provider).toBe('claude');
        expect(result.source).toBe('filesystem');
        expect(result.reason).toBe('claude-runtime-found');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should fall back to codex when targetDir does not match a known layout', async () => {
      const result = await detectProvider({ targetDir: '/nonexistent/path' });

      expect(result.provider).toBe('codex');
      expect(result.source).toBe('default');
    });

    it('should return valid ProviderDetection type', async () => {
      const result: ProviderDetection = await detectProvider();

      expect(result).toHaveProperty('provider');
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reason');

      expect(result.provider).toBe('codex');
      expect(result.source).toBe('default');
      expect(result.confidence).toBe('high');
      expect(typeof result.reason).toBe('string');
    });
  });
});
