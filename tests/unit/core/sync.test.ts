/**
 * Unit tests for the sync module (drift detection and snapshot export)
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createIsolatedGitEnvironment } from '../../../src/core/codex-project-root.js';
import {
  computeFileHash,
  LOCKFILE_NAME,
  LOCKFILE_VERSION,
  type Lockfile,
  readLockfile,
  writeLockfile,
} from '../../../src/core/lockfile.js';
import { exportSnapshot, syncCheck } from '../../../src/core/sync.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLockfile(overrides: Partial<Lockfile> = {}): Lockfile {
  return {
    lockfileVersion: LOCKFILE_VERSION,
    generatorVersion: '0.72.0',
    generatedAt: '2025-01-01T00:00:00.000Z',
    templateVersion: '0.72.0',
    files: {},
    ...overrides,
  };
}

async function writeTestLockfile(dir: string, overrides: Partial<Lockfile> = {}): Promise<void> {
  const lockfile = makeLockfile(overrides);
  await writeFile(join(dir, LOCKFILE_NAME), JSON.stringify(lockfile, null, 2), 'utf-8');
}

async function treeDigest(root: string): Promise<string> {
  const records: string[] = [];

  async function walk(current: string): Promise<void> {
    const stats = await lstat(current);
    const name = relative(root, current) || '.';
    if (stats.isSymbolicLink()) {
      records.push(`link:${name}:${await readlink(current)}`);
      return;
    }
    if (stats.isFile()) {
      records.push(
        `file:${name}:${createHash('sha256')
          .update(await readFile(current))
          .digest('hex')}`
      );
      return;
    }
    records.push(`dir:${name}`);
    for (const entry of (await readdir(current)).sort()) {
      await walk(join(current, entry));
    }
  }

  await walk(root);
  return createHash('sha256').update(records.join('\n')).digest('hex');
}

function git(args: string[], cwd: string): void {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    env: createIsolatedGitEnvironment(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sync', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-sync-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  describe('syncCheck', () => {
    it('returns inSync: false with null versions when no lockfile exists', async () => {
      const result = await syncCheck(tempDir);

      expect(result.inSync).toBe(false);
      expect(result.referenceVersion).toBeNull();
      expect(result.currentVersion).toBeNull();
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
    });

    it('reports inSync: true when current state matches lockfile exactly', async () => {
      // Create a rules directory with one file
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(rulesDir, 'MUST-safety.md'), '# Safety', 'utf-8');

      // Write a lockfile that was generated from the same state
      // We use writeLockfile (via the core module) after generating it
      const { generateLockfile } = await import('../../../src/core/lockfile.js');
      const lockfile = await generateLockfile(tempDir, '0.72.0', '0.72.0');
      await writeLockfile(tempDir, lockfile);

      const result = await syncCheck(tempDir);

      expect(result.inSync).toBe(true);
      expect(result.unchanged).toBeGreaterThan(0);
      expect(result.modified).toHaveLength(0);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });

    it('detects files modified since install', async () => {
      // Create a file and record its hash in the lockfile
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(rulesDir, 'MUST-safety.md'), 'original content', 'utf-8');

      const { generateLockfile } = await import('../../../src/core/lockfile.js');
      const lockfile = await generateLockfile(tempDir, '0.72.0', '0.72.0');
      await writeLockfile(tempDir, lockfile);

      // Modify the file after recording the lockfile
      await writeFile(join(rulesDir, 'MUST-safety.md'), 'modified content', 'utf-8');

      const result = await syncCheck(tempDir);

      expect(result.inSync).toBe(false);
      expect(result.modified).toContain('.codex/rules/MUST-safety.md');
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });

    it('detects files added after install', async () => {
      // Create lockfile when only one file exists
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(rulesDir, 'MUST-safety.md'), '# Safety', 'utf-8');

      const { generateLockfile } = await import('../../../src/core/lockfile.js');
      const lockfile = await generateLockfile(tempDir, '0.72.0', '0.72.0');
      await writeLockfile(tempDir, lockfile);

      // Add a new file that was not tracked at install time
      await writeFile(join(rulesDir, 'MUST-new.md'), '# New rule', 'utf-8');

      const result = await syncCheck(tempDir);

      expect(result.inSync).toBe(false);
      expect(result.added).toContain('.codex/rules/MUST-new.md');
      expect(result.modified).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });

    it('detects files removed after install', async () => {
      // Create lockfile with two files
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(rulesDir, 'MUST-safety.md'), '# Safety', 'utf-8');
      await writeFile(join(rulesDir, 'MUST-permissions.md'), '# Permissions', 'utf-8');

      const { generateLockfile } = await import('../../../src/core/lockfile.js');
      const lockfile = await generateLockfile(tempDir, '0.72.0', '0.72.0');
      await writeLockfile(tempDir, lockfile);

      // Remove one of the tracked files
      await rm(join(rulesDir, 'MUST-permissions.md'));

      const result = await syncCheck(tempDir);

      expect(result.inSync).toBe(false);
      expect(result.removed).toContain('.codex/rules/MUST-permissions.md');
      expect(result.modified).toHaveLength(0);
    });

    it('uses external reference directory when provided', async () => {
      // Create a reference snapshot directory with its own lockfile
      const refDir = await mkdtemp(join(tmpdir(), 'omcodex-sync-ref-'));

      try {
        // Reference lockfile records one file
        const refLockfile = makeLockfile({
          generatorVersion: '0.70.0',
          files: {
            '.codex/rules/MUST-safety.md': {
              templateHash: 'different-hash',
              size: 100,
              component: 'rules',
            },
          },
        });
        await writeFile(join(refDir, LOCKFILE_NAME), JSON.stringify(refLockfile, null, 2), 'utf-8');

        // Current state has the same file but with a different hash
        const rulesDir = join(tempDir, '.codex', 'rules');
        await mkdir(rulesDir, { recursive: true });
        await writeFile(join(rulesDir, 'MUST-safety.md'), '# Safety', 'utf-8');

        const result = await syncCheck(tempDir, { reference: refDir });

        expect(result.referenceVersion).toBe('0.70.0');
        // The file exists in both but hashes differ → modified
        expect(result.modified).toContain('.codex/rules/MUST-safety.md');
      } finally {
        await rm(refDir, { recursive: true, force: true });
      }
    });

    it('returns referenceVersion from lockfile when present', async () => {
      await writeTestLockfile(tempDir, { generatorVersion: '0.55.0' });

      // No runtime root directory — current generation produces empty files
      const result = await syncCheck(tempDir);

      expect(result.referenceVersion).toBe('0.55.0');
    });

    it('returns totalTracked count of current files', async () => {
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(rulesDir, 'a.md'), '# a', 'utf-8');
      await writeFile(join(rulesDir, 'b.md'), '# b', 'utf-8');

      const { generateLockfile } = await import('../../../src/core/lockfile.js');
      const lockfile = await generateLockfile(tempDir, '0.72.0', '0.72.0');
      await writeLockfile(tempDir, lockfile);

      const result = await syncCheck(tempDir);

      expect(result.totalTracked).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  describe('exportSnapshot', () => {
    it('returns success: false when no runtime root directory exists', async () => {
      const outputDir = join(tempDir, 'snapshot');
      const result = await exportSnapshot(tempDir, outputDir);

      expect(result.success).toBe(false);
      expect(result.fileCount).toBe(0);
    });

    it('creates the output directory and copies .codex/ contents', async () => {
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(rulesDir, 'MUST-safety.md'), '# Safety', 'utf-8');

      const outputDir = join(tempDir, 'snapshot');
      const result = await exportSnapshot(tempDir, outputDir);

      expect(result.success).toBe(true);
      expect(result.exportPath).toBe(outputDir);
      expect(result.fileCount).toBeGreaterThan(0);
    });

    it('includes a lockfile in the exported snapshot', async () => {
      const { existsSync } = await import('node:fs');
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(rulesDir, 'MUST-safety.md'), '# Safety', 'utf-8');

      const outputDir = join(tempDir, 'snapshot');
      await exportSnapshot(tempDir, outputDir);

      expect(existsSync(join(outputDir, LOCKFILE_NAME))).toBe(true);
    });

    it('exports authoritative main hooks instead of dormant linked-worktree hooks', async () => {
      const linked = `${tempDir}-linked-export`;
      try {
        git(['init', '-q'], tempDir);
        await writeFile(join(tempDir, 'README.md'), '# fixture\n');
        git(['add', 'README.md'], tempDir);
        git(
          [
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.com',
            'commit',
            '-qm',
            'fixture',
          ],
          tempDir
        );
        git(['worktree', 'add', '-qb', 'linked-export-fixture', linked], tempDir);

        const mainHooks = join(tempDir, '.codex', 'hooks');
        const linkedHooks = join(linked, '.codex', 'hooks');
        await Promise.all([
          mkdir(join(mainHooks, 'scripts'), { recursive: true }),
          mkdir(join(linkedHooks, 'scripts'), { recursive: true }),
        ]);
        await writeFile(join(tempDir, '.codex', 'hooks.json'), '{"hooks":{"safe":[]}}');
        await writeFile(join(mainHooks, 'scripts', 'managed.sh'), '# main-safe\n');
        await writeFile(join(linked, '.codex', 'hooks.json'), '{"hooks":{"pwned":[]}}');
        await writeFile(join(linkedHooks, 'scripts', 'managed.sh'), '# linked-pwned\n');
        await writeFile(join(linkedHooks, 'scripts', 'linked-only.sh'), '# dormant\n');

        const outputDir = join(tempDir, 'snapshot');
        const result = await exportSnapshot(linked, outputDir);

        expect(result.success).toBe(true);
        const exportedRegistry = join(outputDir, '.codex', 'hooks.json');
        const exportedScript = join(outputDir, '.codex', 'hooks', 'scripts', 'managed.sh');
        expect(await readFile(exportedRegistry, 'utf-8')).toBe('{"hooks":{"safe":[]}}');
        expect(await readFile(exportedScript, 'utf-8')).toBe('# main-safe\n');
        expect(
          await Bun.file(join(outputDir, '.codex', 'hooks', 'scripts', 'linked-only.sh')).exists()
        ).toBe(false);

        const exportedLockfile = await readLockfile(outputDir);
        expect(exportedLockfile?.files['.codex/hooks.json']).toEqual(
          expect.objectContaining({
            root: 'codex-project',
            templateHash: await computeFileHash(exportedRegistry),
          })
        );
        expect(exportedLockfile?.files['.codex/hooks/scripts/managed.sh']).toEqual(
          expect.objectContaining({
            root: 'codex-project',
            templateHash: await computeFileHash(exportedScript),
          })
        );
      } finally {
        await rm(linked, { recursive: true, force: true });
      }
    });

    it('excludes agent-memory directories from the snapshot', async () => {
      const { existsSync } = await import('node:fs');

      // Create .codex/rules (tracked) and .codex/agent-memory (excluded)
      const rulesDir = join(tempDir, '.codex', 'rules');
      const memoryDir = join(tempDir, '.codex', 'agent-memory', 'lang-typescript-expert');
      await mkdir(rulesDir, { recursive: true });
      await mkdir(memoryDir, { recursive: true });
      await writeFile(join(rulesDir, 'MUST-safety.md'), '# Safety', 'utf-8');
      await writeFile(join(memoryDir, 'MEMORY.md'), '# Memory', 'utf-8');

      const outputDir = join(tempDir, 'snapshot');
      await exportSnapshot(tempDir, outputDir);

      expect(existsSync(join(outputDir, '.codex', 'rules', 'MUST-safety.md'))).toBe(true);
      expect(existsSync(join(outputDir, '.codex', 'agent-memory'))).toBe(false);
    });

    it('preserves agent-memory-local and settings.local exclusion contracts', async () => {
      const { existsSync } = await import('node:fs');
      const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-sync-excluded-outside-'));
      try {
        const rulesDir = join(tempDir, '.codex', 'rules');
        const localMemoryDir = join(tempDir, '.codex', 'agent-memory-local');
        await mkdir(rulesDir, { recursive: true });
        await mkdir(localMemoryDir, { recursive: true });
        await writeFile(join(rulesDir, 'MUST-safety.md'), '# Safety', 'utf-8');
        await writeFile(join(localMemoryDir, 'MEMORY.md'), '# Local memory', 'utf-8');
        await writeFile(join(tempDir, '.codex', 'settings.local.json'), '{}', 'utf-8');
        await writeFile(join(outsideDir, 'secret.md'), 'EXCLUDED-SECRET\n');
        await symlink(join(outsideDir, 'secret.md'), join(localMemoryDir, 'secret-link.md'));

        const outputDir = join(tempDir, 'snapshot');
        const result = await exportSnapshot(tempDir, outputDir);

        expect(result.success).toBe(true);
        expect(existsSync(join(outputDir, '.codex', 'rules', 'MUST-safety.md'))).toBe(true);
        expect(existsSync(join(outputDir, '.codex', 'agent-memory-local'))).toBe(false);
        expect(existsSync(join(outputDir, '.codex', 'settings.local.json'))).toBe(false);
        expect(await readFile(join(outsideDir, 'secret.md'), 'utf-8')).toBe('EXCLUDED-SECRET\n');
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('excludes outputs directory from the snapshot', async () => {
      const { existsSync } = await import('node:fs');

      const rulesDir = join(tempDir, '.codex', 'rules');
      const outputsDir = join(tempDir, '.codex', 'outputs', 'sessions');
      await mkdir(rulesDir, { recursive: true });
      await mkdir(outputsDir, { recursive: true });
      await writeFile(join(rulesDir, 'MUST-safety.md'), '# Safety', 'utf-8');
      await writeFile(join(outputsDir, 'session.md'), '# Session log', 'utf-8');

      const outputDir = join(tempDir, 'snapshot');
      await exportSnapshot(tempDir, outputDir);

      expect(existsSync(join(outputDir, '.codex', 'rules', 'MUST-safety.md'))).toBe(true);
      expect(existsSync(join(outputDir, '.codex', 'outputs'))).toBe(false);
    });

    it('includes guides/ directory when present', async () => {
      const { existsSync } = await import('node:fs');

      const rulesDir = join(tempDir, '.codex', 'rules');
      const guidesDir = join(tempDir, 'guides', 'typescript');
      await mkdir(rulesDir, { recursive: true });
      await mkdir(guidesDir, { recursive: true });
      await writeFile(join(rulesDir, 'MUST-safety.md'), '# Safety', 'utf-8');
      await writeFile(join(guidesDir, 'guide.md'), '# TS Guide', 'utf-8');

      const outputDir = join(tempDir, 'snapshot');
      await exportSnapshot(tempDir, outputDir);

      expect(existsSync(join(outputDir, 'guides', 'typescript', 'guide.md'))).toBe(true);
    });

    it('succeeds without guides/ directory when it is absent', async () => {
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(rulesDir, 'MUST-safety.md'), '# Safety', 'utf-8');

      const outputDir = join(tempDir, 'snapshot');
      const result = await exportSnapshot(tempDir, outputDir);

      // No guides/ dir — should still succeed
      expect(result.success).toBe(true);
    });

    it('reports the correct exported file count', async () => {
      const rulesDir = join(tempDir, '.codex', 'rules');
      await mkdir(rulesDir, { recursive: true });
      await writeFile(join(rulesDir, 'a.md'), '# a', 'utf-8');
      await writeFile(join(rulesDir, 'b.md'), '# b', 'utf-8');

      const outputDir = join(tempDir, 'snapshot');
      const result = await exportSnapshot(tempDir, outputDir);

      // a.md + b.md + lockfile
      expect(result.fileCount).toBe(3);
    });

    it('rejects a symlink output root before changing source or outside trees', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-sync-outside-'));
      try {
        const rulesDir = join(tempDir, '.codex', 'rules');
        await mkdir(rulesDir, { recursive: true });
        await writeFile(join(rulesDir, 'MUST-safety.md'), '# Safety', 'utf-8');
        await writeFile(join(outsideDir, 'sentinel.txt'), 'OUTSIDE-SENTINEL\n');
        const outputLink = join(tempDir, 'snapshot-link');
        await symlink(outsideDir, outputLink);
        const before = {
          source: await treeDigest(tempDir),
          outside: await treeDigest(outsideDir),
        };

        await expect(exportSnapshot(tempDir, outputLink)).rejects.toThrow('Unsafe write path');

        expect(await treeDigest(tempDir)).toBe(before.source);
        expect(await treeDigest(outsideDir)).toBe(before.outside);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('preflights a late lockfile symlink before copying runtime content', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-sync-lock-outside-'));
      try {
        const rulesDir = join(tempDir, '.codex', 'rules');
        await mkdir(rulesDir, { recursive: true });
        await writeFile(join(rulesDir, 'MUST-safety.md'), '# Safety', 'utf-8');
        const outputDir = join(tempDir, 'snapshot');
        await mkdir(outputDir);
        await writeFile(join(outsideDir, 'sentinel.json'), '{"outside":true}\n');
        await symlink(join(outsideDir, 'sentinel.json'), join(outputDir, LOCKFILE_NAME));
        const before = {
          source: await treeDigest(tempDir),
          outside: await treeDigest(outsideDir),
        };

        await expect(exportSnapshot(tempDir, outputDir)).rejects.toThrow('symbolic link');

        expect(await treeDigest(tempDir)).toBe(before.source);
        expect(await treeDigest(outsideDir)).toBe(before.outside);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects source symlinks without creating the output directory', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-sync-source-outside-'));
      try {
        const rulesDir = join(tempDir, '.codex', 'rules');
        await mkdir(rulesDir, { recursive: true });
        await writeFile(join(outsideDir, 'secret.md'), 'DO-NOT-EXPORT\n');
        await symlink(join(outsideDir, 'secret.md'), join(rulesDir, 'linked-secret.md'));
        const outputDir = join(tempDir, 'snapshot');
        const before = {
          source: await treeDigest(tempDir),
          outside: await treeDigest(outsideDir),
        };

        await expect(exportSnapshot(tempDir, outputDir)).rejects.toThrow(
          'symbolic links are not allowed'
        );

        expect(
          await lstat(outputDir).then(
            () => true,
            () => false
          )
        ).toBe(false);
        expect(await treeDigest(tempDir)).toBe(before.source);
        expect(await treeDigest(outsideDir)).toBe(before.outside);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects a non-existent output that canonically overlaps an aliased source', async () => {
      const workspaceRoot = await mkdtemp(join(tmpdir(), 'omcodex-sync-alias-overlap-'));
      try {
        const realProject = join(workspaceRoot, 'real', 'project');
        await mkdir(join(realProject, '.codex', 'rules'), { recursive: true });
        await writeFile(join(realProject, '.codex', 'rules', 'MUST-safety.md'), '# Safety');
        const workspaceAlias = join(workspaceRoot, 'link');
        await symlink(join(workspaceRoot, 'real'), workspaceAlias);
        const aliasedProject = join(workspaceAlias, 'project');
        const outputDir = join(realProject, '.codex', 'nested-snapshot');
        const before = await treeDigest(workspaceRoot);

        await expect(exportSnapshot(aliasedProject, outputDir)).rejects.toThrow(
          'output overlaps source tree'
        );

        expect(await treeDigest(workspaceRoot)).toBe(before);
        await expect(lstat(outputDir)).rejects.toThrow();
      } finally {
        await rm(workspaceRoot, { recursive: true, force: true });
      }
    });

    it('allows a symlink workspace root when exporting to a separate real directory', async () => {
      const workspaceRoot = await mkdtemp(join(tmpdir(), 'omcodex-sync-alias-workspace-'));
      try {
        const realProject = join(workspaceRoot, 'project');
        const outputDir = join(workspaceRoot, 'snapshot');
        await mkdir(join(realProject, '.codex', 'rules'), { recursive: true });
        await writeFile(join(realProject, '.codex', 'rules', 'MUST-safety.md'), '# Safety');
        const projectAlias = join(workspaceRoot, 'project-link');
        await symlink(realProject, projectAlias);

        const result = await exportSnapshot(projectAlias, outputDir);

        expect(result.success).toBe(true);
        expect(await readFile(join(outputDir, '.codex', 'rules', 'MUST-safety.md'), 'utf-8')).toBe(
          '# Safety'
        );
      } finally {
        await rm(workspaceRoot, { recursive: true, force: true });
      }
    });
  });
});
