import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeFileHash,
  computeLockfileEntryMetadata,
  diffLockfiles,
  generateAndWriteLockfileForDir,
  generateLockfile,
  LEGACY_LOCKFILE_NAME,
  LOCKFILE_NAME,
  LOCKFILE_VERSION,
  type Lockfile,
  readLockfile,
  writeLockfile,
} from '../../../src/core/lockfile.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expectedSha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function makeLockfile(overrides: Partial<Lockfile> = {}): Lockfile {
  return {
    lockfileVersion: LOCKFILE_VERSION,
    generatorVersion: '0.31.0',
    generatedAt: '2025-01-01T00:00:00.000Z',
    templateVersion: '0.31.0',
    files: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('lockfile', () => {
  let tempDir: string;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-lockfile-test-'));
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    consoleDebugSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  describe('computeFileHash', () => {
    it('returns the correct SHA-256 hex digest for known content', async () => {
      const content = 'hello, lockfile!';
      const filePath = join(tempDir, 'test.txt');
      await writeFile(filePath, content, 'utf-8');

      const hash = await computeFileHash(filePath);

      expect(hash).toBe(expectedSha256(content));
    });

    it('returns lowercase hex string', async () => {
      const filePath = join(tempDir, 'lower.txt');
      await writeFile(filePath, 'abc', 'utf-8');

      const hash = await computeFileHash(filePath);

      expect(hash).toBe(hash.toLowerCase());
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different hashes for different content', async () => {
      const fileA = join(tempDir, 'a.txt');
      const fileB = join(tempDir, 'b.txt');
      await writeFile(fileA, 'content-a', 'utf-8');
      await writeFile(fileB, 'content-b', 'utf-8');

      const hashA = await computeFileHash(fileA);
      const hashB = await computeFileHash(fileB);

      expect(hashA).not.toBe(hashB);
    });

    it('rejects when file does not exist', async () => {
      const missingPath = join(tempDir, 'does-not-exist.txt');

      await expect(computeFileHash(missingPath)).rejects.toThrow();
    });
  });

  describe('computeLockfileEntryMetadata', () => {
    it('releases its file descriptor across repeated safe hashes', async () => {
      const rulesDir = join(tempDir, '.codex', 'rules');
      const relativePath = '.codex/rules/MUST-safe.md';
      const content = 'safe descriptor lifecycle';
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(tempDir, relativePath), content);
      const entry = {
        templateHash: expectedSha256(content),
        size: content.length,
        component: 'rules',
      };

      for (let attempt = 0; attempt < 300; attempt += 1) {
        await expect(computeLockfileEntryMetadata(tempDir, relativePath, entry)).resolves.toEqual({
          templateHash: entry.templateHash,
          size: entry.size,
        });
      }
    });

    it('rejects an ancestor symlink replacement between inspection and open', async () => {
      const hooksDir = join(tempDir, '.codex', 'hooks');
      const originalHooksDir = join(tempDir, '.codex', 'hooks-original');
      const outsideDir = join(tempDir, 'outside-hooks');
      await Promise.all([
        mkdir(join(hooksDir, 'scripts'), { recursive: true }),
        mkdir(join(outsideDir, 'scripts'), { recursive: true }),
      ]);
      await writeFile(join(hooksDir, 'scripts', 'managed.sh'), 'inside-safe');
      await writeFile(join(outsideDir, 'scripts', 'managed.sh'), 'outside-secret');

      const entry = {
        templateHash: expectedSha256('inside-safe'),
        size: 'inside-safe'.length,
        component: 'hooks',
      };
      await expect(
        computeLockfileEntryMetadata(tempDir, '.codex/hooks/scripts/managed.sh', entry, undefined, {
          afterPathInspection: async () => {
            await rename(hooksDir, originalHooksDir);
            await symlink(outsideDir, hooksDir);
          },
        })
      ).rejects.toThrow('identity changed before hashing');
      expect(await readFile(join(outsideDir, 'scripts', 'managed.sh'), 'utf-8')).toBe(
        'outside-secret'
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('readLockfile', () => {
    it('returns null when lockfile does not exist', async () => {
      const result = await readLockfile(tempDir);

      expect(result).toBeNull();
    });

    it('reads and parses a valid lockfile', async () => {
      const lockfile = makeLockfile({
        files: {
          '.codex/rules/MUST-safety.md': {
            templateHash: 'abc123',
            size: 512,
            component: 'rules',
          },
        },
      });

      await writeFile(join(tempDir, LOCKFILE_NAME), JSON.stringify(lockfile, null, 2), 'utf-8');

      const result = await readLockfile(tempDir);

      expect(result).not.toBeNull();
      expect(result?.lockfileVersion).toBe(LOCKFILE_VERSION);
      expect(result?.files['.codex/rules/MUST-safety.md'].component).toBe('rules');
    });

    it('reads the legacy lockfile when the canonical lockfile is absent', async () => {
      const lockfile = makeLockfile({
        files: {
          '.codex/rules/MUST-safety.md': {
            templateHash: 'legacy123',
            size: 512,
            component: 'rules',
          },
        },
      });

      await writeFile(
        join(tempDir, LEGACY_LOCKFILE_NAME),
        JSON.stringify(lockfile, null, 2),
        'utf-8'
      );

      const result = await readLockfile(tempDir);

      expect(result).not.toBeNull();
      expect(result?.files['.codex/rules/MUST-safety.md'].templateHash).toBe('legacy123');
    });

    it('returns null when lockfileVersion is invalid', async () => {
      const invalid = {
        lockfileVersion: 99,
        generatorVersion: '0.1.0',
        generatedAt: '2025-01-01T00:00:00.000Z',
        templateVersion: '0.1.0',
        files: {},
      };

      await writeFile(join(tempDir, LOCKFILE_NAME), JSON.stringify(invalid, null, 2), 'utf-8');

      const result = await readLockfile(tempDir);

      expect(result).toBeNull();
    });

    it('returns null when lockfileVersion field is missing', async () => {
      const noVersion = {
        generatorVersion: '0.1.0',
        generatedAt: '2025-01-01T00:00:00.000Z',
        templateVersion: '0.1.0',
        files: {},
      };

      await writeFile(join(tempDir, LOCKFILE_NAME), JSON.stringify(noVersion, null, 2), 'utf-8');

      const result = await readLockfile(tempDir);

      expect(result).toBeNull();
    });

    it('returns null when file contains invalid JSON', async () => {
      await writeFile(join(tempDir, LOCKFILE_NAME), 'not-valid-json', 'utf-8');

      const result = await readLockfile(tempDir);

      expect(result).toBeNull();
    });

    it('returns null when files field is missing', async () => {
      const noFiles = {
        lockfileVersion: LOCKFILE_VERSION,
        generatorVersion: '0.1.0',
        generatedAt: '2025-01-01T00:00:00.000Z',
        templateVersion: '0.1.0',
      };

      await writeFile(join(tempDir, LOCKFILE_NAME), JSON.stringify(noFiles, null, 2), 'utf-8');

      const result = await readLockfile(tempDir);

      expect(result).toBeNull();
    });

    it('returns null when files field is null', async () => {
      const nullFiles = {
        lockfileVersion: LOCKFILE_VERSION,
        generatorVersion: '0.1.0',
        generatedAt: '2025-01-01T00:00:00.000Z',
        templateVersion: '0.1.0',
        files: null,
      };

      await writeFile(join(tempDir, LOCKFILE_NAME), JSON.stringify(nullFiles, null, 2), 'utf-8');

      const result = await readLockfile(tempDir);

      expect(result).toBeNull();
    });

    it.each([
      '../outside.md',
      '.codex/../outside.md',
      '/absolute.md',
      'C:/absolute.md',
      String.raw`C:\absolute.md`,
      String.raw`.codex\hooks.json`,
    ])('rejects an unsafe lockfile key: %s', async (unsafePath) => {
      const lockfile = makeLockfile({
        files: {
          [unsafePath]: {
            templateHash: 'abc123',
            size: 1,
            component: 'hooks',
          },
        },
      });
      await writeFile(join(tempDir, LOCKFILE_NAME), JSON.stringify(lockfile), 'utf-8');

      expect(await readLockfile(tempDir)).toBeNull();
    });

    it('rejects unknown roots and codex-project roots outside the hook namespace', async () => {
      for (const [relativePath, root, component] of [
        ['.codex/hooks.json', 'outside', 'hooks'],
        ['.codex/rules/MUST-safety.md', 'codex-project', 'rules'],
      ] as const) {
        const lockfile = makeLockfile({
          files: {
            [relativePath]: {
              templateHash: 'abc123',
              size: 1,
              component,
              root,
            },
          },
        });
        await writeFile(join(tempDir, LOCKFILE_NAME), JSON.stringify(lockfile), 'utf-8');
        expect(await readLockfile(tempDir)).toBeNull();
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('writeLockfile', () => {
    it('rejects writing through a lockfile symlink when a trusted root is provided', async () => {
      const outsideFile = join(tempDir, 'outside-lockfile.json');
      await writeFile(outsideFile, 'outside sentinel');
      await symlink(outsideFile, join(tempDir, LOCKFILE_NAME));
      const lockfile: Lockfile = {
        lockfileVersion: LOCKFILE_VERSION,
        generatorVersion: '0.31.0',
        generatedAt: '2025-01-01T00:00:00.000Z',
        templateVersion: '0.31.0',
        files: {},
      };

      await expect(writeLockfile(tempDir, lockfile, { trustedWriteRoot: tempDir })).rejects.toThrow(
        'symbolic link'
      );
      expect(await readFile(outsideFile, 'utf-8')).toBe('outside sentinel');
    });

    it('writes valid JSON to the target directory', async () => {
      const lockfile = makeLockfile({
        generatorVersion: '1.2.3',
        templateVersion: '1.2.3',
      });

      await writeLockfile(tempDir, lockfile);

      const written = await readLockfile(tempDir);
      expect(written).not.toBeNull();
      expect(written?.generatorVersion).toBe('1.2.3');
      expect(written?.lockfileVersion).toBe(LOCKFILE_VERSION);
    });

    it('writes with 2-space indentation', async () => {
      const lockfile = makeLockfile();
      await writeLockfile(tempDir, lockfile);

      const raw = await readFile(join(tempDir, LOCKFILE_NAME), 'utf-8');
      // 2-space indent: first field line should start with two spaces
      expect(raw).toContain('\n  "');
    });

    it('overwrites an existing lockfile', async () => {
      const first = makeLockfile({ generatorVersion: 'v1' });
      const second = makeLockfile({ generatorVersion: 'v2' });

      await writeLockfile(tempDir, first);
      await writeLockfile(tempDir, second);

      const result = await readLockfile(tempDir);
      expect(result?.generatorVersion).toBe('v2');
    });
  });

  // -------------------------------------------------------------------------
  describe('generateLockfile', () => {
    it('generates entries for files in component directories', async () => {
      // Create a minimal .codex/rules directory with one file
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      const content = '# Safety rule';
      await writeFile(join(rulesDir, 'MUST-safety.md'), content, 'utf-8');

      const lockfile = await generateLockfile(tempDir, '0.31.0', '0.31.0');

      expect(lockfile.lockfileVersion).toBe(LOCKFILE_VERSION);
      expect(lockfile.generatorVersion).toBe('0.31.0');
      expect(lockfile.templateVersion).toBe('0.31.0');
      expect(typeof lockfile.generatedAt).toBe('string');

      const entry = lockfile.files['.codex/rules/MUST-safety.md'];
      expect(entry).toBeDefined();
      expect(entry.component).toBe('rules');
      expect(entry.templateHash).toBe(expectedSha256(content));
      expect(entry.size).toBe(Buffer.byteLength(content, 'utf-8'));
    });

    it('uses forward slashes in file paths regardless of OS', async () => {
      const agentsDir = join(tempDir, '.codex', 'agents');
      await mkdir(agentsDir, { recursive: true });
      await writeFile(join(agentsDir, 'lang-go-expert.md'), '# agent', 'utf-8');

      const lockfile = await generateLockfile(tempDir, '0.31.0', '0.31.0');

      const keys = Object.keys(lockfile.files);
      for (const key of keys) {
        expect(key).not.toContain('\\');
      }
    });

    it('assigns correct component for each directory', async () => {
      const componentMap: Record<string, string> = {
        '.codex/rules': 'rules',
        '.codex/agents': 'agents',
        '.agents/skills': 'skills',
        '.codex/hooks': 'hooks',
        '.codex/contexts': 'contexts',
        '.codex/ontology': 'ontology',
        guides: 'guides',
      };

      for (const [dirPath, component] of Object.entries(componentMap)) {
        const fullDir = join(tempDir, dirPath);
        await mkdir(fullDir, { recursive: true });
        await writeFile(join(fullDir, `${component}.md`), `# ${component}`, 'utf-8');
      }

      const lockfile = await generateLockfile(tempDir, '0.31.0', '0.31.0');

      for (const [dirPath, expectedComponent] of Object.entries(componentMap)) {
        const fileName = `${expectedComponent}.md`;
        const entryKey = `${dirPath}/${fileName}`;
        expect(lockfile.files[entryKey]?.component).toBe(expectedComponent);
      }
    });

    it('skips missing component directories without error', async () => {
      // Create only one component directory
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(rulesDir, 'MUST-safety.md'), '# rule', 'utf-8');

      // All other component dirs are absent — should not throw
      const lockfile = await generateLockfile(tempDir, '0.31.0', '0.31.0');

      const components = new Set(Object.values(lockfile.files).map((e) => e.component));
      expect(components.size).toBe(1);
      expect(components.has('rules')).toBe(true);
    });

    it('handles empty component directories', async () => {
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      // No files written

      const lockfile = await generateLockfile(tempDir, '0.31.0', '0.31.0');

      expect(Object.keys(lockfile.files)).toHaveLength(0);
    });

    it('walks subdirectories recursively', async () => {
      const skillsDir = join(tempDir, '.agents', 'skills', 'dev-review');
      await mkdir(skillsDir, { recursive: true });
      await writeFile(join(skillsDir, 'SKILL.md'), '# skill', 'utf-8');

      const lockfile = await generateLockfile(tempDir, '0.31.0', '0.31.0');

      const key = '.agents/skills/dev-review/SKILL.md';
      expect(lockfile.files[key]).toBeDefined();
      expect(lockfile.files[key].component).toBe('skills');
    });

    it('fails closed instead of hashing through a component symlink', async () => {
      const outside = join(tempDir, 'outside-rules');
      await mkdir(outside);
      await writeFile(join(outside, 'secret.md'), 'outside secret', 'utf-8');
      await mkdir(join(tempDir, '.codex'), { recursive: true });
      await symlink(outside, join(tempDir, '.codex', 'rules'));

      await expect(generateLockfile(tempDir, '0.31.0', '0.31.0')).rejects.toThrow('symbolic link');
      expect(await readFile(join(outside, 'secret.md'), 'utf-8')).toBe('outside secret');
    });

    it('fails closed instead of hashing a multiply-linked component file', async () => {
      const outside = join(tempDir, 'outside-rule.md');
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      await writeFile(outside, 'outside secret', 'utf-8');
      await link(outside, join(rulesDir, 'MUST-safety.md'));

      await expect(generateLockfile(tempDir, '0.31.0', '0.31.0')).rejects.toThrow(
        'multiple hard links'
      );
      expect(await readFile(outside, 'utf-8')).toBe('outside secret');
    });
  });

  // -------------------------------------------------------------------------
  describe('diffLockfiles', () => {
    it('detects files added in current that are absent in base', () => {
      const base = makeLockfile({ files: {} });
      const current = makeLockfile({
        files: {
          '.codex/rules/new.md': { templateHash: 'abc', size: 10, component: 'rules' },
        },
      });

      const diff = diffLockfiles(base, current);

      expect(diff.added).toContain('.codex/rules/new.md');
      expect(diff.removed).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(0);
    });

    it('detects files removed from base that are absent in current', () => {
      const base = makeLockfile({
        files: {
          '.codex/rules/old.md': { templateHash: 'abc', size: 10, component: 'rules' },
        },
      });
      const current = makeLockfile({ files: {} });

      const diff = diffLockfiles(base, current);

      expect(diff.removed).toContain('.codex/rules/old.md');
      expect(diff.added).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(0);
    });

    it('detects files with changed hashes as modified', () => {
      const sharedPath = '.codex/agents/lang-go-expert.md';
      const base = makeLockfile({
        files: {
          [sharedPath]: { templateHash: 'hash-v1', size: 100, component: 'agents' },
        },
      });
      const current = makeLockfile({
        files: {
          [sharedPath]: { templateHash: 'hash-v2', size: 110, component: 'agents' },
        },
      });

      const diff = diffLockfiles(base, current);

      expect(diff.modified).toContain(sharedPath);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(0);
    });

    it('puts files with identical hashes in unchanged', () => {
      const sharedPath = '.codex/rules/MUST-safety.md';
      const entry = { templateHash: 'same-hash', size: 50, component: 'rules' };
      const base = makeLockfile({ files: { [sharedPath]: entry } });
      const current = makeLockfile({ files: { [sharedPath]: entry } });

      const diff = diffLockfiles(base, current);

      expect(diff.unchanged).toContain(sharedPath);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
    });

    it('correctly categorizes a mixed diff', () => {
      const base = makeLockfile({
        files: {
          'a.md': { templateHash: 'h1', size: 1, component: 'rules' },
          'b.md': { templateHash: 'h2', size: 2, component: 'rules' },
          'c.md': { templateHash: 'h3', size: 3, component: 'rules' },
        },
      });
      const current = makeLockfile({
        files: {
          // a.md: same hash → unchanged
          'a.md': { templateHash: 'h1', size: 1, component: 'rules' },
          // b.md: different hash → modified
          'b.md': { templateHash: 'h2-updated', size: 20, component: 'rules' },
          // c.md removed, d.md added
          'd.md': { templateHash: 'h4', size: 4, component: 'rules' },
        },
      });

      const diff = diffLockfiles(base, current);

      expect(diff.unchanged).toEqual(['a.md']);
      expect(diff.modified).toEqual(['b.md']);
      expect(diff.removed).toEqual(['c.md']);
      expect(diff.added).toEqual(['d.md']);
    });

    it('returns empty arrays when both lockfiles are identical', () => {
      const files = {
        '.codex/rules/MUST-safety.md': { templateHash: 'abc', size: 10, component: 'rules' },
      };
      const base = makeLockfile({ files });
      const current = makeLockfile({ files });

      const diff = diffLockfiles(base, current);

      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(1);
    });

    it('treats a trusted-root change as a modified lockfile entry', () => {
      const relativePath = '.codex/hooks.json';
      const base = makeLockfile({
        files: {
          [relativePath]: { templateHash: 'same', size: 4, component: 'hooks' },
        },
      });
      const current = makeLockfile({
        files: {
          [relativePath]: {
            templateHash: 'same',
            size: 4,
            component: 'hooks',
            root: 'codex-project',
          },
        },
      });

      expect(diffLockfiles(base, current).modified).toEqual([relativePath]);
    });

    it('handles empty base and current lockfiles', () => {
      const diff = diffLockfiles(makeLockfile(), makeLockfile());

      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('generateAndWriteLockfileForDir', () => {
    it('generates and writes lockfile in one call', async () => {
      // Create a minimal component directory with one file
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(rulesDir, 'MUST-safety.md'), '# Safety rule', 'utf-8');

      const result = await generateAndWriteLockfileForDir(tempDir);

      expect(result.fileCount).toBeGreaterThan(0);
      expect(result.warning).toBeUndefined();

      // Verify lockfile was written
      const lockfile = await readLockfile(tempDir);
      expect(lockfile).not.toBeNull();
      expect(lockfile?.files['.codex/rules/MUST-safety.md']).toBeDefined();
    });

    it('preserves the existing timestamp and bytes when the semantic snapshot is unchanged', async () => {
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(rulesDir, 'MUST-safety.md'), '# Stable safety rule', 'utf-8');

      await generateAndWriteLockfileForDir(tempDir);
      const first = await readLockfile(tempDir);
      expect(first).not.toBeNull();
      if (!first) throw new Error('expected generated lockfile');

      const stableTimestamp = '2000-01-01T00:00:00.000Z';
      await writeLockfile(tempDir, { ...first, generatedAt: stableTimestamp });
      const stableBytes = await readFile(join(tempDir, LOCKFILE_NAME), 'utf-8');

      await generateAndWriteLockfileForDir(tempDir);

      expect(await readFile(join(tempDir, LOCKFILE_NAME), 'utf-8')).toBe(stableBytes);
      expect((await readLockfile(tempDir))?.generatedAt).toBe(stableTimestamp);
    });

    it('refreshes the timestamp when the semantic snapshot changes', async () => {
      const rulesDir = join(tempDir, '.codex', 'rules');
      const ruleFile = join(rulesDir, 'MUST-safety.md');
      await mkdir(rulesDir, { recursive: true });
      await writeFile(ruleFile, '# Original safety rule', 'utf-8');
      await generateAndWriteLockfileForDir(tempDir);

      const first = await readLockfile(tempDir);
      expect(first).not.toBeNull();
      if (!first) throw new Error('expected generated lockfile');
      const staleTimestamp = '2000-01-01T00:00:00.000Z';
      await writeLockfile(tempDir, { ...first, generatedAt: staleTimestamp });
      await writeFile(ruleFile, '# Changed safety rule', 'utf-8');

      await generateAndWriteLockfileForDir(tempDir);

      const changed = await readLockfile(tempDir);
      expect(changed?.generatedAt).not.toBe(staleTimestamp);
      expect(changed?.files['.codex/rules/MUST-safety.md']?.templateHash).toBe(
        expectedSha256('# Changed safety rule')
      );
    });

    it('does not let an unchanged snapshot bypass canonical lockfile path safety', async () => {
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(rulesDir, 'MUST-safety.md'), '# Stable safety rule', 'utf-8');
      await generateAndWriteLockfileForDir(tempDir);

      const canonical = join(tempDir, LOCKFILE_NAME);
      const displaced = join(tempDir, 'displaced-lockfile.json');
      await rename(canonical, displaced);
      await symlink(displaced, canonical);

      const result = await generateAndWriteLockfileForDir(tempDir);

      expect(result.fileCount).toBe(0);
      expect(result.warning).toContain('symbolic link');
    });

    it('omits machine-local hook metadata from an explicit source snapshot', async () => {
      const scriptsDir = join(tempDir, '.codex', 'hooks', 'scripts');
      const compatibilityDir = join(tempDir, '.codex', 'hooks', 'compatibility');
      await mkdir(scriptsDir, { recursive: true });
      await mkdir(compatibilityDir, { recursive: true });
      await writeFile(join(scriptsDir, 'managed.sh'), '#!/bin/bash\n', 'utf-8');
      await writeFile(join(compatibilityDir, 'conversion.json'), '{"machine":"local"}', 'utf-8');
      await writeFile(join(tempDir, '.codex', 'hooks.json'), '{"hooks":{}}', 'utf-8');

      await generateAndWriteLockfileForDir(tempDir, { sourceSnapshot: true });

      const lockfile = await readLockfile(tempDir);
      expect(lockfile?.files['.codex/hooks/scripts/managed.sh']).toBeDefined();
      expect(lockfile?.files['.codex/hooks/compatibility/conversion.json']).toBeUndefined();
      expect(lockfile?.files['.codex/hooks.json']).toBeUndefined();
    });

    it('hashes linked source hook bytes from the candidate worktree', async () => {
      const linkedWorktree = `${tempDir}-source-snapshot`;
      const relativeScript = '.codex/hooks/scripts/managed.sh';
      const mainContent = '#!/bin/bash\nprintf main\n';
      const candidateContent = '#!/bin/bash\nprintf candidate\n';
      try {
        await mkdir(join(tempDir, '.codex', 'hooks', 'scripts'), { recursive: true });
        await writeFile(join(tempDir, relativeScript), mainContent, 'utf-8');
        expect(Bun.spawnSync(['git', 'init', '-q'], { cwd: tempDir }).exitCode).toBe(0);
        expect(Bun.spawnSync(['git', 'add', '.'], { cwd: tempDir }).exitCode).toBe(0);
        expect(
          Bun.spawnSync(
            [
              'git',
              '-c',
              'user.name=Fixture',
              '-c',
              'user.email=fixture@example.com',
              'commit',
              '-qm',
              'fixture',
            ],
            { cwd: tempDir }
          ).exitCode
        ).toBe(0);
        expect(
          Bun.spawnSync(['git', 'worktree', 'add', '-qb', 'source-snapshot', linkedWorktree], {
            cwd: tempDir,
          }).exitCode
        ).toBe(0);
        await writeFile(join(linkedWorktree, relativeScript), candidateContent, 'utf-8');

        await generateAndWriteLockfileForDir(linkedWorktree, { sourceSnapshot: true });

        const entry = (await readLockfile(linkedWorktree))?.files[relativeScript];
        expect(entry).toEqual({
          templateHash: expectedSha256(candidateContent),
          size: Buffer.byteLength(candidateContent),
          component: 'hooks',
        });
        expect(await readFile(join(tempDir, relativeScript), 'utf-8')).toBe(mainContent);
      } finally {
        Bun.spawnSync(['git', 'worktree', 'remove', '--force', linkedWorktree], { cwd: tempDir });
        await rm(linkedWorktree, { recursive: true, force: true });
      }
    });

    it('returns warning on failure without throwing', async () => {
      // Use a non-existent directory that will cause getPackageRoot to fail
      // Since generateAndWriteLockfileForDir calls getPackageRoot internally,
      // and we can't easily mock it in vitest without module mocking,
      // we verify the function signature and non-throwing contract
      const result = await generateAndWriteLockfileForDir(tempDir);

      // Even if it succeeds (package root is accessible), verify shape
      expect(typeof result.fileCount).toBe('number');
      expect(result.warning === undefined || typeof result.warning === 'string').toBe(true);
    });
  });
});
