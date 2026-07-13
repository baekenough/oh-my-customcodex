/**
 * Snapshot installation for oh-my-customcodex
 * Handles installing from a pre-configured team snapshot directory
 */

import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import packageJson from '../../package.json';
import { readLockFile, writeLockFile } from '../cli/projects.js';
import { i18n } from '../i18n/index.js';
import {
  copyDirectory,
  copyFile,
  prevalidateCopyDirectory,
  prevalidateSafeWritePath,
} from '../utils/fs.js';
import { getComponentPath, getProviderLayout } from './layout.js';
import { generateAndWriteLockfileForDir } from './lockfile.js';
import { ensureOmxProjectReady } from './omx-installer.js';
import { registerProject } from './registry.js';

/**
 * Options for the init command
 */
export interface InitOptions {
  /** Language for templates and messages (en|ko) */
  lang?: 'en' | 'ko';
  /** Whether to overwrite existing files */
  force?: boolean;
  /**
   * Install only agents for the specified domain.
   * Valid values: backend, frontend, data-engineering, devops.
   * When omitted, all agents are installed (backward compatible).
   */
  domain?: string;
  /** Skip interactive wizard, use defaults */
  yes?: boolean;
  /** Install from a pre-configured team snapshot directory */
  fromSnapshot?: string;
}

/**
 * Result of the init command
 */
export interface InitResult {
  success: boolean;
  message: string;
  installedPaths?: string[];
  errors?: string[];
}

export interface SnapshotInstallDependencies {
  /** Injectable project provisioning boundary for isolated snapshot tests. */
  ensureOmxProjectReady?: (projectRoot: string) => {
    success: boolean;
    command: string;
    error?: string;
  };
  /** Injectable final managed-lock boundary for ordering and failure tests. */
  generateAndWriteLockfileForDir?: typeof generateAndWriteLockfileForDir;
  /** Injectable registry boundary so success ordering can be verified without HOME writes. */
  registerProject?: typeof registerProject;
}

interface SnapshotCopyOperation {
  kind: 'directory' | 'file';
  source: string;
  destination: string;
}

interface SnapshotInstallPlan {
  installOperations: SnapshotCopyOperation[];
  backupOperations: SnapshotCopyOperation[];
  backupDir?: string;
}

async function lstatIfPresent(path: string): Promise<import('node:fs').Stats | null> {
  const fs = await import('node:fs/promises');
  try {
    return await fs.lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function assertRegularSourceFile(path: string, description: string): Promise<void> {
  const stats = await lstatIfPresent(path);
  if (!stats) {
    throw new Error(`Snapshot source disappeared during validation: ${path}`);
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`Unsafe ${description}: symbolic links are not allowed: ${path}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Unsafe ${description}: expected a regular file: ${path}`);
  }
}

/**
 * Snapshot content is data, not a filesystem capability. Reject links and
 * special files rather than preserving or following them into a project or a
 * backup. This also prevents a backup from reading a secret through a link.
 */
async function assertRegularSourceTree(path: string, description: string): Promise<void> {
  const fs = await import('node:fs/promises');
  const stats = await lstatIfPresent(path);
  if (!stats) {
    throw new Error(`Snapshot source disappeared during validation: ${path}`);
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`Unsafe ${description}: symbolic links are not allowed: ${path}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Unsafe ${description}: expected a directory: ${path}`);
  }

  for (const entry of await fs.readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Unsafe ${description}: symbolic links are not allowed: ${entryPath}`);
    }
    if (entry.isDirectory()) {
      await assertRegularSourceTree(entryPath, description);
      continue;
    }
    if (entry.isFile()) continue;
    throw new Error(`Unsafe ${description}: special files are not allowed: ${entryPath}`);
  }
}

async function assertTrustedProjectRoot(targetDir: string): Promise<void> {
  const stats = await lstatIfPresent(targetDir);
  if (!stats) {
    throw new Error(`Snapshot target directory not found: ${targetDir}`);
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`Unsafe snapshot target: project root is a symbolic link: ${targetDir}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Unsafe snapshot target: project root is not a directory: ${targetDir}`);
  }
}

async function canonicalizePathForOverlap(path: string): Promise<string> {
  let current = resolve(path);
  const unresolvedSuffix: string[] = [];

  while (true) {
    try {
      return resolve(await realpath(current), ...unresolvedSuffix);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Unable to canonicalize snapshot path: ${path}`);
    }
    unresolvedSuffix.unshift(basename(current));
    current = parent;
  }
}

function isSameOrDescendant(path: string, ancestor: string): boolean {
  const pathFromAncestor = relative(resolve(ancestor), resolve(path));
  return (
    pathFromAncestor === '' ||
    (pathFromAncestor !== '..' &&
      !pathFromAncestor.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromAncestor))
  );
}

async function assertNonOverlappingCopyOperations(
  operations: SnapshotCopyOperation[]
): Promise<void> {
  const canonicalOperations = await Promise.all(
    operations.map(async (operation) => ({
      operation,
      source: await canonicalizePathForOverlap(operation.source),
      destination: await canonicalizePathForOverlap(operation.destination),
    }))
  );

  // A backup destination can overlap a later install source, so pairwise
  // self-checks are insufficient. Check every destination against every source
  // that has not yet been fully consumed. A later install destination may
  // intentionally replace an earlier backup source after that backup read has
  // completed, which is the sole temporal exception to the cross-plan guard.
  for (
    let destinationIndex = 0;
    destinationIndex < canonicalOperations.length;
    destinationIndex++
  ) {
    const destinationOperation = canonicalOperations[destinationIndex];
    for (
      let sourceIndex = destinationIndex;
      sourceIndex < canonicalOperations.length;
      sourceIndex++
    ) {
      const sourceOperation = canonicalOperations[sourceIndex];
      if (
        isSameOrDescendant(destinationOperation.destination, sourceOperation.source) ||
        isSameOrDescendant(sourceOperation.source, destinationOperation.destination)
      ) {
        throw new Error(
          `Unsafe snapshot install: destination overlaps source tree: ${sourceOperation.operation.source}`
        );
      }
    }
  }
}

function getSnapshotPaths(snapshotPath: string) {
  const layout = getProviderLayout();
  return {
    layout,
    snapshotRuntime: join(snapshotPath, layout.rootDir),
    snapshotSkills: join(snapshotPath, getComponentPath('skills')),
    snapshotGuides: join(snapshotPath, 'guides'),
    snapshotEntry: join(snapshotPath, layout.entryFile),
  };
}

async function validateSnapshot(
  snapshotPath: string
): Promise<{ valid: true } | { valid: false; error: string }> {
  // The user-selected snapshot leaf must itself be a real directory. Symlinked
  // ancestors (including macOS /var aliases) remain valid workspace paths.
  const rootStats = await lstatIfPresent(snapshotPath);
  if (!rootStats) {
    return { valid: false, error: `Snapshot path not found: ${snapshotPath}` };
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    return {
      valid: false,
      error: `Invalid snapshot: root must be a real directory: ${snapshotPath}`,
    };
  }

  const { layout, snapshotRuntime, snapshotSkills } = getSnapshotPaths(snapshotPath);
  const [runtimeStats, skillsStats] = await Promise.all([
    lstatIfPresent(snapshotRuntime),
    lstatIfPresent(snapshotSkills),
  ]);
  if (!runtimeStats && !skillsStats) {
    return {
      valid: false,
      error: `Invalid snapshot: missing ${layout.rootDir}/ or ${getComponentPath('skills')} in ${snapshotPath}`,
    };
  }

  return { valid: true };
}

function makeCopyOperation(
  kind: SnapshotCopyOperation['kind'],
  source: string,
  destination: string
): SnapshotCopyOperation {
  return { kind, source, destination };
}

async function buildInstallOperations(
  targetDir: string,
  snapshotPath: string
): Promise<SnapshotCopyOperation[]> {
  const { layout, snapshotRuntime, snapshotSkills, snapshotGuides, snapshotEntry } =
    getSnapshotPaths(snapshotPath);
  const operations: SnapshotCopyOperation[] = [];

  for (const [source, destination] of [
    [snapshotRuntime, join(targetDir, layout.rootDir)],
    [snapshotSkills, join(targetDir, getComponentPath('skills'))],
    [snapshotGuides, join(targetDir, 'guides')],
  ] as const) {
    if (await lstatIfPresent(source)) {
      operations.push(makeCopyOperation('directory', source, destination));
    }
  }

  if (await lstatIfPresent(snapshotEntry)) {
    operations.push(makeCopyOperation('file', snapshotEntry, join(targetDir, layout.entryFile)));
  }

  return operations;
}

async function checkExistingInstallation(targetDir: string): Promise<boolean> {
  const layout = getProviderLayout();
  const markers = [layout.entryFile, layout.rootDir];
  if (layout.provider === 'codex') markers.push('.agents');
  for (const marker of markers) {
    if (await lstatIfPresent(join(targetDir, marker))) return true;
  }
  return false;
}

async function buildBackupOperations(
  targetDir: string,
  backupDir: string
): Promise<SnapshotCopyOperation[]> {
  const layout = getProviderLayout();
  const operations: SnapshotCopyOperation[] = [];

  for (const relativePath of [layout.rootDir, '.agents', 'guides']) {
    const source = join(targetDir, relativePath);
    if (await lstatIfPresent(source)) {
      operations.push(makeCopyOperation('directory', source, join(backupDir, relativePath)));
    }
  }

  const entrySource = join(targetDir, layout.entryFile);
  if (await lstatIfPresent(entrySource)) {
    operations.push(makeCopyOperation('file', entrySource, join(backupDir, layout.entryFile)));
  }

  return operations;
}

async function validateCopySource(operation: SnapshotCopyOperation, description: string) {
  if (operation.kind === 'directory') {
    await assertRegularSourceTree(operation.source, description);
  } else {
    await assertRegularSourceFile(operation.source, description);
  }
}

async function prevalidateCopyOperation(
  operation: SnapshotCopyOperation,
  trustedWriteRoot: string
): Promise<void> {
  if (operation.kind === 'directory') {
    await prevalidateCopyDirectory(operation.source, operation.destination, {
      overwrite: true,
      trustedWriteRoot,
    });
  } else {
    await prevalidateSafeWritePath(operation.destination, trustedWriteRoot);
  }
}

async function executeCopyOperation(
  operation: SnapshotCopyOperation,
  trustedWriteRoot: string
): Promise<void> {
  if (operation.kind === 'directory') {
    await copyDirectory(operation.source, operation.destination, {
      overwrite: true,
      trustedWriteRoot,
    });
  } else {
    await copyFile(operation.source, operation.destination, trustedWriteRoot);
  }
}

async function buildAndValidateInstallPlan(
  targetDir: string,
  snapshotPath: string,
  force: boolean
): Promise<SnapshotInstallPlan> {
  await assertTrustedProjectRoot(targetDir);
  const installOperations = await buildInstallOperations(targetDir, snapshotPath);
  for (const operation of installOperations) {
    await validateCopySource(operation, 'snapshot source');
  }

  let backupDir: string | undefined;
  let backupOperations: SnapshotCopyOperation[] = [];
  if (!force && (await checkExistingInstallation(targetDir))) {
    const layout = getProviderLayout();
    backupDir = join(
      targetDir,
      `${layout.backupDirPrefix}${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1)}`
    );
    backupOperations = await buildBackupOperations(targetDir, backupDir);
    for (const operation of backupOperations) {
      await validateCopySource(operation, 'snapshot backup source');
    }
  }

  // Validate the complete backup, install, and finalization destination plan
  // before the first directory or file is created.
  const copyOperations = [...backupOperations, ...installOperations];
  await assertNonOverlappingCopyOperations(copyOperations);
  for (const operation of copyOperations) {
    await prevalidateCopyOperation(operation, targetDir);
  }
  await prevalidateSafeWritePath(join(targetDir, '.omcodex.lock.json'), targetDir);

  return { installOperations, backupOperations, backupDir };
}

async function ensureSnapshotRuntimeReady(
  targetDir: string,
  dependencies: SnapshotInstallDependencies
): Promise<void> {
  const provisionOmxProject = dependencies.ensureOmxProjectReady ?? ensureOmxProjectReady;
  const provision = provisionOmxProject(targetDir);
  if (!provision.success) {
    throw new Error(
      provision.error ?? `OMX project setup is incomplete. Run manually: ${provision.command}`
    );
  }

  const writeManagedLockfile =
    dependencies.generateAndWriteLockfileForDir ?? generateAndWriteLockfileForDir;
  const managedLockfile = await writeManagedLockfile(targetDir, {
    trustedWriteRoot: targetDir,
  });
  if (managedLockfile.warning) {
    throw new Error(managedLockfile.warning);
  }
}

/**
 * Install from a pre-configured team snapshot
 */
export async function installFromSnapshot(
  targetDir: string,
  snapshotPath: string,
  options: InitOptions,
  dependencies: SnapshotInstallDependencies = {}
): Promise<InitResult> {
  const snapshotValidation = await validateSnapshot(snapshotPath);
  if (!snapshotValidation.valid) {
    return {
      success: false,
      message: i18n.t('cli.init.failed'),
      errors: [snapshotValidation.error],
    };
  }

  console.log(`Installing from snapshot: ${snapshotPath}`);

  try {
    const plan = await buildAndValidateInstallPlan(targetDir, snapshotPath, options.force === true);

    if (plan.backupDir) {
      const { layout } = getSnapshotPaths(snapshotPath);
      console.log(i18n.t('cli.init.exists', { rootDir: layout.rootDir }));
      console.log(i18n.t('cli.init.backing_up'));
      for (const operation of plan.backupOperations) {
        await executeCopyOperation(operation, targetDir);
      }
      console.log(`  Backed up to: ${plan.backupDir}`);
    }

    for (const operation of plan.installOperations) {
      await executeCopyOperation(operation, targetDir);
    }

    await ensureSnapshotRuntimeReady(targetDir, dependencies);

    // Merge registry metadata only after the managed lock captures the final
    // post-provisioning runtime state. The destination was included in preflight.
    try {
      const existing = await readLockFile(targetDir);
      await writeLockFile(targetDir, packageJson.version, existing);
    } catch {
      // Non-blocking after a successful, explicit preflight.
    }

    // Register project in the local registry (non-blocking)
    try {
      const registerInstalledProject = dependencies.registerProject ?? registerProject;
      await registerInstalledProject(targetDir, packageJson.version);
    } catch {
      // Registry write is informational only — never block snapshot install
    }

    console.log(i18n.t('cli.init.success'));
    console.log(`\nInstalled from snapshot: ${snapshotPath}`);

    return {
      success: true,
      message: `Installed from snapshot: ${snapshotPath}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(i18n.t('cli.init.failed'), errorMessage);
    return {
      success: false,
      message: i18n.t('cli.init.failed'),
      errors: [errorMessage],
    };
  }
}
