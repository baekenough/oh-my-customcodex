import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import type { InitOptions } from '../../../src/cli/init.js';
import { computeFileHash, readLockfile } from '../../../src/core/lockfile.js';
import {
  installFromSnapshot as installFromSnapshotWithDependencies,
  type SnapshotInstallDependencies,
} from '../../../src/core/snapshot.js';

describe('installFromSnapshot', () => {
  let targetDir: string;
  let snapshotDir: string;

  const readyDependencies: SnapshotInstallDependencies = {
    ensureOmxProjectReady: () => ({
      success: true,
      command: 'omx setup --scope project --merge-agents',
    }),
    registerProject: async () => {},
  };

  function installFromSnapshot(
    target: string,
    snapshot: string,
    options: InitOptions,
    dependencies: SnapshotInstallDependencies = readyDependencies
  ) {
    return installFromSnapshotWithDependencies(target, snapshot, options, dependencies);
  }

  beforeEach(async () => {
    targetDir = await mkdtemp(join(tmpdir(), 'omcodex-snapshot-target-'));
    snapshotDir = await mkdtemp(join(tmpdir(), 'omcodex-snapshot-src-'));
  });

  afterEach(async () => {
    await rm(targetDir, { recursive: true, force: true });
    await rm(snapshotDir, { recursive: true, force: true });
  });

  async function createMinimalSnapshot(dir: string): Promise<void> {
    const claudeDir = join(dir, '.codex');
    await mkdir(join(claudeDir, 'agents'), { recursive: true });
    await mkdir(join(claudeDir, 'rules'), { recursive: true });
    await writeFile(join(claudeDir, 'agents', 'sample-agent.md'), '# sample-agent\n');
    await writeFile(join(claudeDir, 'rules', 'MUST-sample.md'), '# Sample Rule\n');
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
        const content = await readFile(current);
        records.push(`file:${name}:${createHash('sha256').update(content).digest('hex')}`);
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

  describe('success cases', () => {
    it('succeeds with a valid snapshot', async () => {
      await createMinimalSnapshot(snapshotDir);

      const options: InitOptions = {};
      const result = await installFromSnapshot(targetDir, snapshotDir, options);

      expect(result.success).toBe(true);
      expect(result.message).toContain(snapshotDir);
    });

    it('provisions after copy and generates the managed lock before registry metadata', async () => {
      await createMinimalSnapshot(snapshotDir);
      const calls: string[] = [];

      const result = await installFromSnapshot(
        targetDir,
        snapshotDir,
        {},
        {
          ensureOmxProjectReady: (projectRoot) => {
            expect(projectRoot).toBe(targetDir);
            calls.push('provision');
            return {
              success: true,
              command: 'omx setup --scope project --merge-agents',
            };
          },
          generateAndWriteLockfileForDir: async () => {
            expect(
              await readFile(join(targetDir, '.codex', 'rules', 'MUST-sample.md'), 'utf-8')
            ).toBe('# Sample Rule\n');
            calls.push('lockfile');
            return { fileCount: 2 };
          },
          registerProject: async () => {
            calls.push('registry');
          },
        }
      );

      expect(result.success).toBe(true);
      expect(calls).toEqual(['provision', 'lockfile', 'registry']);
    });

    it('hashes the final state produced by snapshot OMX provisioning', async () => {
      await createMinimalSnapshot(snapshotDir);
      const hooksPath = join(targetDir, '.codex', 'hooks.json');

      const result = await installFromSnapshot(
        targetDir,
        snapshotDir,
        {},
        {
          ensureOmxProjectReady: () => {
            writeFileSync(hooksPath, '{"hooks":{"SessionStart":[]}}\n');
            return {
              success: true,
              command: 'omx setup --scope project --merge-agents',
            };
          },
          registerProject: async () => {},
        }
      );

      expect(result.success).toBe(true);
      const lockfile = await readLockfile(targetDir);
      expect(lockfile?.files['.codex/hooks.json']?.templateHash).toBe(
        await computeFileHash(hooksPath)
      );
    });

    it('copies .codex/ directory from snapshot', async () => {
      await createMinimalSnapshot(snapshotDir);

      await installFromSnapshot(targetDir, snapshotDir, {});

      const agentPath = join(targetDir, '.codex', 'agents', 'sample-agent.md');
      const agentStat = await stat(agentPath);
      expect(agentStat.isFile()).toBe(true);

      const content = await readFile(agentPath, 'utf-8');
      expect(content).toContain('sample-agent');
    });

    it('copies guides/ if present in snapshot', async () => {
      await createMinimalSnapshot(snapshotDir);
      const guidesDir = join(snapshotDir, 'guides');
      await mkdir(join(guidesDir, 'typescript'), { recursive: true });
      await writeFile(join(guidesDir, 'typescript', 'README.md'), '# TypeScript Guide\n');

      await installFromSnapshot(targetDir, snapshotDir, {});

      const guideFile = join(targetDir, 'guides', 'typescript', 'README.md');
      const guideStat = await stat(guideFile);
      expect(guideStat.isFile()).toBe(true);
    });

    it('does not create guides/ in target when snapshot has none', async () => {
      await createMinimalSnapshot(snapshotDir);

      await installFromSnapshot(targetDir, snapshotDir, {});

      const guidesDir = join(targetDir, 'guides');
      let guidesExist = false;
      try {
        await stat(guidesDir);
        guidesExist = true;
      } catch {
        guidesExist = false;
      }
      expect(guidesExist).toBe(false);
    });

    it('copies AGENTS.md if present in snapshot', async () => {
      await createMinimalSnapshot(snapshotDir);
      await writeFile(join(snapshotDir, 'AGENTS.md'), '# Team AGENTS.md\n');

      await installFromSnapshot(targetDir, snapshotDir, {});

      const entryFile = join(targetDir, 'AGENTS.md');
      const content = await readFile(entryFile, 'utf-8');
      expect(content).toContain('Team AGENTS.md');
    });

    it('does not create AGENTS.md in target when snapshot has none', async () => {
      await createMinimalSnapshot(snapshotDir);
      // No AGENTS.md in snapshot

      await installFromSnapshot(targetDir, snapshotDir, {});

      let entryExists = false;
      try {
        await stat(join(targetDir, 'AGENTS.md'));
        entryExists = true;
      } catch {
        entryExists = false;
      }
      expect(entryExists).toBe(false);
    });
  });

  describe('failure cases', () => {
    it('fails with non-existent snapshot path', async () => {
      const nonExistentPath = join(tmpdir(), `does-not-exist-omcodex-${Date.now()}`);
      const options: InitOptions = {};
      const result = await installFromSnapshot(targetDir, nonExistentPath, options);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]).toContain('Snapshot path not found');
      expect(result.errors?.[0]).toContain(nonExistentPath);
    });

    it('fails when snapshot directory is missing .codex/', async () => {
      // snapshotDir exists but has no .codex/ subdirectory
      await writeFile(join(snapshotDir, 'README.md'), '# Some project\n');

      const result = await installFromSnapshot(targetDir, snapshotDir, {});

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]).toContain('Invalid snapshot');
      expect(result.errors?.[0]).toContain('.codex');
    });

    it('does not finalize or report success when OMX readiness remains incomplete', async () => {
      await createMinimalSnapshot(snapshotDir);
      let lockfileCalled = false;
      let registryCalled = false;

      const result = await installFromSnapshot(
        targetDir,
        snapshotDir,
        {},
        {
          ensureOmxProjectReady: () => ({
            success: false,
            command: 'omx setup --scope project --merge-agents',
            error: 'OMX project setup remains partial',
          }),
          generateAndWriteLockfileForDir: async () => {
            lockfileCalled = true;
            return { fileCount: 0 };
          },
          registerProject: async () => {
            registryCalled = true;
          },
        }
      );

      expect(result.success).toBe(false);
      expect(result.errors).toContain('OMX project setup remains partial');
      expect(lockfileCalled).toBe(false);
      expect(registryCalled).toBe(false);
      await expect(lstat(join(targetDir, '.omcodex.lock.json'))).rejects.toThrow();
    });

    it('does not register or report success when final lockfile generation fails', async () => {
      await createMinimalSnapshot(snapshotDir);
      let registryCalled = false;

      const result = await installFromSnapshot(
        targetDir,
        snapshotDir,
        {},
        {
          ensureOmxProjectReady: readyDependencies.ensureOmxProjectReady,
          generateAndWriteLockfileForDir: async () => ({
            fileCount: 0,
            warning: 'Lockfile generation failed: injected failure',
          }),
          registerProject: async () => {
            registryCalled = true;
          },
        }
      );

      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('injected failure');
      expect(registryCalled).toBe(false);
    });

    it('rejects a snapshot root leaf symlink even when it points to a valid snapshot', async () => {
      const snapshotLink = join(tmpdir(), `omcodex-snapshot-root-link-${randomUUID()}`);
      try {
        await createMinimalSnapshot(snapshotDir);
        await symlink(snapshotDir, snapshotLink);
        const before = {
          target: await treeDigest(targetDir),
          source: await treeDigest(snapshotDir),
        };

        const result = await installFromSnapshot(targetDir, snapshotLink, { force: true });

        expect(result.success).toBe(false);
        expect(result.errors?.[0]).toContain('root must be a real directory');
        expect(await treeDigest(targetDir)).toBe(before.target);
        expect(await treeDigest(snapshotDir)).toBe(before.source);
      } finally {
        await rm(snapshotLink, { force: true });
      }
    });

    it('preflights a late entry symlink before copying any snapshot content', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-snapshot-outside-'));
      try {
        await createMinimalSnapshot(snapshotDir);
        await writeFile(join(snapshotDir, 'AGENTS.md'), '# Snapshot entry\n');
        await mkdir(join(targetDir, '.codex', 'rules'), { recursive: true });
        await writeFile(join(targetDir, '.codex', 'rules', 'keep.md'), '# Keep\n');
        await writeFile(join(outsideDir, 'sentinel.md'), 'OUTSIDE-SENTINEL\n');
        await symlink(join(outsideDir, 'sentinel.md'), join(targetDir, 'AGENTS.md'));

        const before = {
          target: await treeDigest(targetDir),
          outside: await treeDigest(outsideDir),
          source: await treeDigest(snapshotDir),
        };

        const result = await installFromSnapshot(targetDir, snapshotDir, { force: true });

        expect(result.success).toBe(false);
        expect(await treeDigest(targetDir)).toBe(before.target);
        expect(await treeDigest(outsideDir)).toBe(before.outside);
        expect(await treeDigest(snapshotDir)).toBe(before.source);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects a symlink in a backup source before creating the backup or installing', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-snapshot-secret-'));
      try {
        await createMinimalSnapshot(snapshotDir);
        const currentAgents = join(targetDir, '.codex', 'agents');
        await mkdir(currentAgents, { recursive: true });
        await writeFile(join(currentAgents, 'current.md'), '# Current\n');
        await writeFile(join(outsideDir, 'secret.md'), 'DO-NOT-COPY\n');
        await symlink(join(outsideDir, 'secret.md'), join(currentAgents, 'secret-link.md'));

        const before = {
          target: await treeDigest(targetDir),
          outside: await treeDigest(outsideDir),
          source: await treeDigest(snapshotDir),
        };

        const result = await installFromSnapshot(targetDir, snapshotDir, {});

        expect(result.success).toBe(false);
        expect(await treeDigest(targetDir)).toBe(before.target);
        expect(await treeDigest(outsideDir)).toBe(before.outside);
        expect(await treeDigest(snapshotDir)).toBe(before.source);
        expect((await readdir(targetDir)).some((entry) => entry.startsWith('.codex-backup-'))).toBe(
          false
        );
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects a hard-linked install destination without changing source or outside trees', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-snapshot-hardlink-outside-'));
      try {
        await createMinimalSnapshot(snapshotDir);
        await mkdir(join(targetDir, '.codex', 'rules'), { recursive: true });
        const outsideFile = join(outsideDir, 'MUST-sample.md');
        await writeFile(outsideFile, 'OUTSIDE-SNAPSHOT-SENTINEL\n');
        await link(outsideFile, join(targetDir, '.codex', 'rules', 'MUST-sample.md'));
        const before = {
          target: await treeDigest(targetDir),
          outside: await treeDigest(outsideDir),
          source: await treeDigest(snapshotDir),
        };

        const result = await installFromSnapshot(targetDir, snapshotDir, { force: true });

        expect(result.success).toBe(false);
        expect(result.errors?.[0]).toContain('multiple hard links');
        expect(await treeDigest(targetDir)).toBe(before.target);
        expect(await treeDigest(outsideDir)).toBe(before.outside);
        expect(await treeDigest(snapshotDir)).toBe(before.source);
        expect(await readFile(outsideFile, 'utf-8')).toBe('OUTSIDE-SNAPSHOT-SENTINEL\n');
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects snapshot source symlinks without following or preserving them', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-snapshot-source-link-'));
      try {
        await createMinimalSnapshot(snapshotDir);
        await writeFile(join(outsideDir, 'secret.md'), 'SOURCE-SECRET\n');
        await symlink(
          join(outsideDir, 'secret.md'),
          join(snapshotDir, '.codex', 'rules', 'linked-secret.md')
        );
        await writeFile(join(targetDir, 'keep.txt'), 'TARGET-KEEP\n');

        const before = {
          target: await treeDigest(targetDir),
          outside: await treeDigest(outsideDir),
          source: await treeDigest(snapshotDir),
        };

        const result = await installFromSnapshot(targetDir, snapshotDir, { force: true });

        expect(result.success).toBe(false);
        expect(await treeDigest(targetDir)).toBe(before.target);
        expect(await treeDigest(outsideDir)).toBe(before.outside);
        expect(await treeDigest(snapshotDir)).toBe(before.source);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects a nested target that overlaps the snapshot source without mutation', async () => {
      await createMinimalSnapshot(snapshotDir);
      targetDir = join(snapshotDir, '.codex', 'nested-project');
      await mkdir(targetDir);
      await writeFile(join(targetDir, 'sentinel.txt'), 'TARGET-SENTINEL\n');
      const before = await treeDigest(snapshotDir);

      const result = await installFromSnapshot(targetDir, snapshotDir, { force: true });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('destination overlaps source tree');
      expect(await treeDigest(snapshotDir)).toBe(before);
      await expect(lstat(join(targetDir, '.omcodex.lock.json'))).rejects.toThrow();
    });

    it('rejects canonical overlap through a snapshot symlink alias without mutation', async () => {
      const snapshotParentAlias = join(tmpdir(), `omcodex-snapshot-parent-alias-${randomUUID()}`);
      try {
        await createMinimalSnapshot(snapshotDir);
        targetDir = join(snapshotDir, '.codex', 'nested-project');
        await mkdir(targetDir);
        await writeFile(join(targetDir, 'sentinel.txt'), 'TARGET-SENTINEL\n');
        await symlink(dirname(snapshotDir), snapshotParentAlias);
        const snapshotAlias = join(snapshotParentAlias, basename(snapshotDir));
        const before = await treeDigest(snapshotDir);

        const result = await installFromSnapshot(targetDir, snapshotAlias, { force: true });

        expect(result.success).toBe(false);
        expect(result.errors?.[0]).toContain('destination overlaps source tree');
        expect(await treeDigest(snapshotDir)).toBe(before);
      } finally {
        await rm(snapshotParentAlias, { force: true });
      }
    });

    it('preflights every backup destination against every install source', async () => {
      const fixedNow = new Date('2026-07-13T06:30:00.000Z');
      setSystemTime(fixedNow);
      try {
        const currentAgents = join(targetDir, '.codex', 'agents');
        await mkdir(currentAgents, { recursive: true });
        await writeFile(join(currentAgents, 'current.md'), '# Current\n');
        const overlappingSnapshotDir = join(targetDir, '.codex-backup-2026-07-13T06-30-00-000');
        await createMinimalSnapshot(overlappingSnapshotDir);
        const before = await treeDigest(targetDir);

        const result = await installFromSnapshot(targetDir, overlappingSnapshotDir, {});

        expect(result.success).toBe(false);
        expect(result.errors?.[0]).toContain('destination overlaps source tree');
        expect(await treeDigest(targetDir)).toBe(before);
        expect(await readFile(join(currentAgents, 'current.md'), 'utf-8')).toBe('# Current\n');
      } finally {
        setSystemTime();
      }
    });
  });

  describe('backup behavior', () => {
    it('backs up existing .codex/ when installation is present and force is not set', async () => {
      // Pre-install an existing .codex/ in target
      const existingClaudeDir = join(targetDir, '.codex', 'agents');
      await mkdir(existingClaudeDir, { recursive: true });
      await writeFile(join(existingClaudeDir, 'old-agent.md'), '# Old Agent\n');

      await createMinimalSnapshot(snapshotDir);

      await installFromSnapshot(targetDir, snapshotDir, {});

      // A backup directory should have been created
      const entries = await readdir(targetDir);
      const backupEntry = entries.find((e) => e.startsWith('.codex-backup-'));
      expect(backupEntry).toBeDefined();

      // The backup should contain the original old-agent.md
      const backupAgentPath = join(
        targetDir,
        backupEntry ?? '',
        '.codex',
        'agents',
        'old-agent.md'
      );
      const backupStat = await stat(backupAgentPath);
      expect(backupStat.isFile()).toBe(true);
    });

    it('skips backup when force is true', async () => {
      // Pre-install an existing .codex/ in target
      const existingClaudeDir = join(targetDir, '.codex', 'agents');
      await mkdir(existingClaudeDir, { recursive: true });
      await writeFile(join(existingClaudeDir, 'old-agent.md'), '# Old Agent\n');

      await createMinimalSnapshot(snapshotDir);

      await installFromSnapshot(targetDir, snapshotDir, { force: true });

      // No backup directory should have been created
      const entries = await readdir(targetDir);
      const backupEntry = entries.find((e) => e.startsWith('.codex-backup-'));
      expect(backupEntry).toBeUndefined();
    });
  });

  describe('error catch behavior (lines 134-141)', () => {
    it('returns failure result when cp throws during installation (Error instance)', async () => {
      await createMinimalSnapshot(snapshotDir);

      // Place a regular file at the destination path where cp expects to write a directory.
      // cp(src_dir, dest_file, { recursive: true }) fails with EEXIST/ENOTDIR on all platforms,
      // which triggers the outer catch block (lines 134-141).
      await writeFile(join(targetDir, '.codex'), 'not-a-directory');

      const result = await installFromSnapshot(targetDir, snapshotDir, {});

      expect(result.success).toBe(false);
      // i18next is not initialized in tests — message will be undefined (i18n.t returns undefined)
      // We only verify the error structure, not the i18n message string.
      expect(result.errors).toBeDefined();
      expect(result.errors).toHaveLength(1);
      // The error message should be a non-empty string from the Error instance
      expect(typeof result.errors?.[0]).toBe('string');
      expect((result.errors?.[0] ?? '').length).toBeGreaterThan(0);
    });
  });
});
