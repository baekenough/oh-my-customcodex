import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatPreflightWarnings,
  isCI,
  type PreflightResult,
  resolveCommandInvocation,
  runPreflightCheck,
} from '../../../src/core/preflight.js';

describe('preflight', () => {
  // Save original environment
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.OMCODEX_SKIP_PREFLIGHT;
    delete process.env.OMCUSTOM_SKIP_PREFLIGHT;
  });

  describe('isCI', () => {
    it('should return true when CI env var is set', () => {
      process.env.CI = 'true';
      expect(isCI()).toBe(true);
    });

    it('should return true when GITHUB_ACTIONS env var is set', () => {
      process.env.GITHUB_ACTIONS = 'true';
      expect(isCI()).toBe(true);
    });

    it('should return true when OMCODEX_SKIP_PREFLIGHT env var is set', () => {
      process.env.OMCODEX_SKIP_PREFLIGHT = 'true';
      expect(isCI()).toBe(true);
    });

    it('should return false when no CI env vars are set', () => {
      expect(isCI()).toBe(false);
    });

    it('should return false when CI env vars are not "true"', () => {
      process.env.CI = 'false';
      process.env.GITHUB_ACTIONS = '0';
      expect(isCI()).toBe(false);
    });
  });

  describe('resolveCommandInvocation', () => {
    it('uses cmd.exe for Windows npm-style shims without enabling shell mode', () => {
      const invocation = resolveCommandInvocation(
        'npm',
        ['view', '@openai/codex', 'version', '--json'],
        'win32',
        'C:\\Windows\\System32\\cmd.exe'
      );

      expect(invocation).toEqual({
        executable: 'C:\\Windows\\System32\\cmd.exe',
        args: ['/d', '/s', '/v:off', '/c', 'npm view @openai/codex version --json'],
      });
    });

    it('rejects Windows command and argument tokens with shell metacharacters', () => {
      expect(() =>
        resolveCommandInvocation('npm & whoami', ['--version'], 'win32', 'cmd.exe')
      ).toThrow('Unsafe Windows pre-flight command token');
      expect(() =>
        resolveCommandInvocation('npm', ['view', 'safe-package & whoami'], 'win32', 'cmd.exe')
      ).toThrow('Unsafe Windows pre-flight command token');
      expect(() =>
        resolveCommandInvocation('npm', ['view', '%COMSPEC%'], 'win32', 'cmd.exe')
      ).toThrow('Unsafe Windows pre-flight command token');
    });

    it('passes arguments directly to execFile on non-Windows platforms', () => {
      const args = ['view', 'package name & still-an-argument'];

      expect(resolveCommandInvocation('/custom/npm', args, 'linux')).toEqual({
        executable: '/custom/npm',
        args,
      });
    });
  });

  describe('runPreflightCheck', () => {
    it('should return skipped result when skip option is true', async () => {
      const result = await runPreflightCheck({ skip: true });

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('Skipped by --skip-version-check flag');
      expect(result.hasUpdates).toBe(false);
      expect(result.tools.length).toBe(0);
    });

    it('should return skipped result in CI environment', async () => {
      process.env.CI = 'true';

      const result = await runPreflightCheck();

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('CI environment detected');
      expect(result.hasUpdates).toBe(false);
    });

    // Note: Testing timeout (lines 302-308) and error handling (lines 335-343) paths
    // would require mocking execSync, which is read-only in Node.js and not easily
    // mockable in Bun's test environment. These paths are defensive error handling
    // and can be validated through integration tests or manual testing.
    // The core logic (CI detection, skip flags, formatting) is tested above.
  });

  describe('persistent result cache', () => {
    let tempDir: string;
    let cachePath: string;

    const successfulResult = (toolNames: string[], version: string): PreflightResult => ({
      tools: toolNames.map((name) => ({
        name,
        installed: true,
        currentVersion: version,
        latestVersion: version,
        updateAvailable: false,
        installMethod: 'path',
      })),
      hasUpdates: false,
      warnings: [],
      skipped: false,
    });

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'omcodex-preflight-cache-'));
      cachePath = join(tempDir, 'preflight-cache.json');
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('reuses a fresh result without starting another probe', async () => {
      let collectionCount = 0;
      const collect = (toolNames: string[]): PreflightResult => {
        collectionCount += 1;
        return successfulResult(toolNames, '1.0.0');
      };

      const first = await runPreflightCheck({
        tools: ['codex', 'omx'],
        _cachePath: cachePath,
        _cacheTtlMs: 1000,
        _now: 10_000,
        _collectFn: collect,
      });
      const second = await runPreflightCheck({
        tools: ['codex', 'omx'],
        _cachePath: cachePath,
        _cacheTtlMs: 1000,
        _now: 10_999,
        _collectFn: () => {
          throw new Error('fresh cache should bypass collection');
        },
      });

      expect(collectionCount).toBe(1);
      expect(second).toEqual(first);
    });

    it('refreshes an entry at the TTL boundary', async () => {
      await runPreflightCheck({
        tools: ['codex'],
        _cachePath: cachePath,
        _cacheTtlMs: 1000,
        _now: 10_000,
        _collectFn: (toolNames) => successfulResult(toolNames, '1.0.0'),
      });

      const refreshed = await runPreflightCheck({
        tools: ['codex'],
        _cachePath: cachePath,
        _cacheTtlMs: 1000,
        _now: 11_000,
        _collectFn: (toolNames) => successfulResult(toolNames, '2.0.0'),
      });

      expect(refreshed.tools[0].currentVersion).toBe('2.0.0');
    });

    it('ignores broken JSON and replaces it with a valid cache document', async () => {
      writeFileSync(cachePath, '{not-json');

      const result = await runPreflightCheck({
        tools: ['codex'],
        _cachePath: cachePath,
        _now: 10_000,
        _collectFn: (toolNames) => successfulResult(toolNames, '1.0.0'),
      });
      const stored = JSON.parse(readFileSync(cachePath, 'utf8')) as {
        version: number;
        entries: unknown[];
      };

      expect(result.tools[0].name).toBe('codex');
      expect(stored.version).toBe(1);
      expect(stored.entries).toHaveLength(1);
    });

    it('rejects a cache entry whose result belongs to another tool list', async () => {
      writeFileSync(
        cachePath,
        JSON.stringify({
          version: 1,
          entries: [
            {
              checkedAt: 10_000,
              toolNames: ['codex'],
              result: successfulResult(['omx'], '9.0.0'),
            },
          ],
        })
      );

      const result = await runPreflightCheck({
        tools: ['codex'],
        _cachePath: cachePath,
        _now: 10_001,
        _collectFn: (toolNames) => successfulResult(toolNames, '1.0.0'),
      });

      expect(result.tools[0].name).toBe('codex');
      expect(result.tools[0].currentVersion).toBe('1.0.0');
    });

    it('keeps results isolated by the exact requested tool list', async () => {
      let collectionCount = 0;
      const collect = (toolNames: string[]): PreflightResult => {
        collectionCount += 1;
        return successfulResult(toolNames, `${collectionCount}.0.0`);
      };

      await runPreflightCheck({
        tools: ['codex'],
        _cachePath: cachePath,
        _now: 10_000,
        _collectFn: collect,
      });
      const omx = await runPreflightCheck({
        tools: ['omx'],
        _cachePath: cachePath,
        _now: 10_001,
        _collectFn: collect,
      });
      const codex = await runPreflightCheck({
        tools: ['codex'],
        _cachePath: cachePath,
        _now: 10_002,
        _collectFn: () => {
          throw new Error('the codex entry should remain cached');
        },
      });

      expect(collectionCount).toBe(2);
      expect(omx.tools.map((tool) => tool.name)).toEqual(['omx']);
      expect(codex.tools.map((tool) => tool.name)).toEqual(['codex']);
      expect(codex.tools[0].currentVersion).toBe('1.0.0');
    });

    it('treats a future-dated entry as stale after a clock rollback', async () => {
      await runPreflightCheck({
        tools: ['codex'],
        _cachePath: cachePath,
        _now: 20_000,
        _collectFn: (toolNames) => successfulResult(toolNames, '1.0.0'),
      });

      const result = await runPreflightCheck({
        tools: ['codex'],
        _cachePath: cachePath,
        _now: 10_000,
        _collectFn: (toolNames) => successfulResult(toolNames, '2.0.0'),
      });

      expect(result.tools[0].currentVersion).toBe('2.0.0');
    });
  });

  describe('formatPreflightWarnings', () => {
    it('should return empty string when no updates available', () => {
      const result: PreflightResult = {
        tools: [
          {
            name: 'claude-code',
            installed: true,
            currentVersion: '1.0.0',
            latestVersion: '1.0.0',
            updateAvailable: false,
            installMethod: 'homebrew',
          },
        ],
        hasUpdates: false,
        warnings: [],
        skipped: false,
      };

      const formatted = formatPreflightWarnings(result);
      expect(formatted).toBe('');
    });

    it('should format single tool update correctly', () => {
      const result: PreflightResult = {
        tools: [
          {
            name: 'claude-code',
            installed: true,
            currentVersion: '1.0.0',
            latestVersion: '2.0.0',
            updateAvailable: true,
            installMethod: 'homebrew',
          },
        ],
        hasUpdates: true,
        warnings: [],
        skipped: false,
      };

      const formatted = formatPreflightWarnings(result);

      expect(formatted).toContain('claude-code');
      expect(formatted).toContain('2.0.0');
      expect(formatted).toContain('current: 1.0.0');
      expect(formatted).toContain('brew upgrade claude-code');
      expect(formatted).toContain('--skip-version-check');
    });

    it('should format multiple tool updates correctly', () => {
      const result: PreflightResult = {
        tools: [
          {
            name: 'claude-code',
            installed: true,
            currentVersion: '1.0.0',
            latestVersion: '2.0.0',
            updateAvailable: true,
            installMethod: 'homebrew',
          },
          {
            name: 'some-tool',
            installed: true,
            currentVersion: '0.5.0',
            latestVersion: '1.0.0',
            updateAvailable: true,
            installMethod: 'homebrew',
          },
        ],
        hasUpdates: true,
        warnings: [],
        skipped: false,
      };

      const formatted = formatPreflightWarnings(result);

      expect(formatted).toContain('Run the following to upgrade:');
      expect(formatted).toContain('brew upgrade claude-code');
      expect(formatted).toContain('brew upgrade some-tool');
      expect(formatted).toContain('2.0.0');
      expect(formatted).toContain('1.0.0');
      expect(formatted).toContain('--skip-version-check');
    });

    it('should only show tools with updates available', () => {
      const result: PreflightResult = {
        tools: [
          {
            name: 'claude-code',
            installed: true,
            currentVersion: '1.0.0',
            latestVersion: '2.0.0',
            updateAvailable: true,
            installMethod: 'homebrew',
          },
          {
            name: 'some-tool',
            installed: true,
            currentVersion: '1.0.0',
            latestVersion: '1.0.0',
            updateAvailable: false,
            installMethod: 'homebrew',
          },
        ],
        hasUpdates: true,
        warnings: [],
        skipped: false,
      };

      const formatted = formatPreflightWarnings(result);

      expect(formatted).toContain('claude-code');
      expect(formatted).not.toContain('some-tool');
      // Should use single-tool format
      expect(formatted).toContain('⚠ claude-code 2.0.0 is available');
    });
  });
});
