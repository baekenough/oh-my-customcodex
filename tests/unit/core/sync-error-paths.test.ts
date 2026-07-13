/**
 * Isolated error-path tests for src/core/sync.ts.
 *
 * These tests use dependency injection to avoid Bun mock.module global state.
 *
 * Covered lines:
 *   - generateCurrentLockfile catch (line 71): generateLockfile throws → returns null
 *   - syncCheck if (!current) branch (lines 108-111): generateCurrentLockfile returns null
 *
 * Note on lines 58-59 (loadVersions catch):
 *   loadVersions calls readJsonFile from utils/fs.js. Mocking utils/fs.js affects all
 *   other test files in the same bun process (global mock.module pollution). Since
 *   snapshot.ts also imports from utils/fs.js, mocking it breaks installer backup tests.
 *   Lines 58-59 are intentionally excluded from this file. The remaining coverage
 *   (≥98%) satisfies the project threshold.
 *
 * Dependency strategy:
 *   Injects lockfile functions only for the exercised call.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCKFILE_NAME, LOCKFILE_VERSION, type Lockfile } from '../../../src/core/lockfile.js';

describe('sync error paths (isolated mock.module tests)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-sync-err-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('syncCheck hits if (!current) branch when generateLockfile throws (lines 71, 108-111)', async () => {
    // Write a valid lockfile so readLockfile returns a reference object.
    const lockfileData: Lockfile = {
      lockfileVersion: LOCKFILE_VERSION,
      generatorVersion: '0.72.0',
      generatedAt: '2025-01-01T00:00:00.000Z',
      templateVersion: '0.72.0',
      files: {},
    };
    await writeFile(join(tempDir, LOCKFILE_NAME), JSON.stringify(lockfileData, null, 2), 'utf-8');

    // readLockfile succeeds (returns the lockfile above), but generateLockfile throws.
    // This forces generateCurrentLockfile to return null (line 71), causing syncCheck
    // to enter the if (!current) branch (lines 108-111).
    const { syncCheck } = await import('../../../src/core/sync.js');

    const result = await syncCheck(tempDir, {
      dependencies: {
        readLockfile: async () => lockfileData,
        generateLockfile: async () => {
          throw new Error('simulated generateLockfile failure');
        },
        diffLockfiles: () => ({ added: [], removed: [], modified: [], unchanged: [] }),
      },
    });

    // generateCurrentLockfile returned null → if (!current) branch returns early
    // with referenceVersion set but currentVersion null
    expect(result.inSync).toBe(false);
    expect(result.referenceVersion).toBe('0.72.0');
    expect(result.currentVersion).toBeNull();
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  });
});
