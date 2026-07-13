/**
 * Snapshot installation for oh-my-customcodex
 * Handles installing from a pre-configured team snapshot directory
 */

import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

interface SnapshotOmxProvisionResult {
  success: boolean;
  command: string;
  error?: string;
  assessment?: {
    project?: {
      hookReadiness?: {
        status?: string;
      };
    };
  };
}

export interface SnapshotInstallDependencies {
  /** Injectable project provisioning boundary for isolated snapshot tests. */
  ensureOmxProjectReady?: (projectRoot: string) => SnapshotOmxProvisionResult;
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

interface SnapshotRollbackTransaction {
  directory: string;
  managedPaths: string[];
  restoreOperations: SnapshotCopyOperation[];
  pathMetadata: SnapshotRollbackPathMetadata[];
  backupDir?: string;
}

interface SnapshotRollbackSource {
  kind: SnapshotCopyOperation['kind'];
  source: string;
}

interface SnapshotRollbackPathMetadata {
  kind: SnapshotCopyOperation['kind'];
  path: string;
  mode: number;
}

interface ValidatedRollbackSources {
  sources: SnapshotRollbackSource[];
  pathMetadata: SnapshotRollbackPathMetadata[];
}

const SNAPSHOT_ROLLBACK_PREFIX = 'omcodex-snapshot-rollback-';
const POSIX_PERMISSION_MASK = 0o7777;
const SNAPSHOT_MANAGED_ROOT_PATHS = [
  '.omx',
  '.gitignore',
  'guides',
  '.omcodex.lock.json',
  '.omcustom.lock.json',
  '.omcodexrc.json',
  '.omcustomrc.json',
] as const;

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
  if (backupDir && (await lstatIfPresent(backupDir))) {
    throw new Error(`Unsafe snapshot backup destination already exists: ${backupDir}`);
  }
  for (const operation of copyOperations) {
    await prevalidateCopyOperation(operation, targetDir);
  }
  await prevalidateSafeWritePath(join(targetDir, '.omcodex.lock.json'), targetDir);

  return { installOperations, backupOperations, backupDir };
}

function getSnapshotManagedPaths(targetDir: string): string[] {
  const layout = getProviderLayout();
  const skillsRoot = getComponentPath('skills').split('/')[0];
  return [
    ...new Set([layout.rootDir, skillsRoot, layout.entryFile, ...SNAPSHOT_MANAGED_ROOT_PATHS]),
  ].map((relativePath) => join(targetDir, relativePath));
}

async function collectRollbackPathMetadata(
  path: string,
  pathMetadata: SnapshotRollbackPathMetadata[]
): Promise<SnapshotCopyOperation['kind']> {
  const fs = await import('node:fs/promises');
  const stats = await lstatIfPresent(path);
  if (!stats) {
    throw new Error(`Snapshot source disappeared during rollback metadata capture: ${path}`);
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`Unsafe snapshot rollback source: symbolic links are not allowed: ${path}`);
  }
  if (stats.isFile()) {
    pathMetadata.push({ kind: 'file', path, mode: stats.mode & POSIX_PERMISSION_MASK });
    return 'file';
  }
  if (!stats.isDirectory()) {
    throw new Error(`Unsafe snapshot rollback source: special files are not allowed: ${path}`);
  }

  pathMetadata.push({ kind: 'directory', path, mode: stats.mode & POSIX_PERMISSION_MASK });
  for (const entry of await fs.readdir(path)) {
    await collectRollbackPathMetadata(join(path, entry), pathMetadata);
  }
  return 'directory';
}

async function validateRollbackSources(managedPaths: string[]): Promise<ValidatedRollbackSources> {
  const sources: SnapshotRollbackSource[] = [];
  const pathMetadata: SnapshotRollbackPathMetadata[] = [];
  for (const source of managedPaths) {
    if (!(await lstatIfPresent(source))) continue;
    const kind = await collectRollbackPathMetadata(source, pathMetadata);
    sources.push({ kind, source });
  }
  return { sources, pathMetadata };
}

async function removeRollbackDirectory(directory: string): Promise<void> {
  const fs = await import('node:fs/promises');
  const stats = await lstatIfPresent(directory);
  if (!stats) return;
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Unsafe snapshot rollback staging path: ${directory}`);
  }
  await fs.rm(directory, { recursive: true, force: true });
}

async function createSnapshotRollbackTransaction(
  targetDir: string,
  backupDir?: string
): Promise<SnapshotRollbackTransaction> {
  const managedPaths = getSnapshotManagedPaths(targetDir);
  const { sources: rollbackSources, pathMetadata } = await validateRollbackSources(managedPaths);

  const directory = await mkdtemp(join(tmpdir(), SNAPSHOT_ROLLBACK_PREFIX));
  try {
    const captureOperations = rollbackSources.map(({ kind, source }) =>
      makeCopyOperation(kind, source, join(directory, relative(targetDir, source)))
    );
    await assertNonOverlappingCopyOperations(captureOperations);
    for (const operation of captureOperations) {
      // executeCopyOperation performs the destination preflight immediately
      // before copying into the private staging root. Avoiding a redundant full
      // tree preflight matters for large .omx state directories.
      await executeCopyOperation(operation, directory);
    }

    return {
      directory,
      managedPaths,
      restoreOperations: captureOperations.map((operation) => ({
        ...operation,
        source: operation.destination,
        destination: operation.source,
      })),
      pathMetadata,
      backupDir,
    };
  } catch (captureError) {
    try {
      await removeRollbackDirectory(directory);
    } catch (cleanupError) {
      throw new AggregateError(
        [captureError, cleanupError],
        `Snapshot rollback capture failed and staging cleanup was incomplete: ${directory}`
      );
    }
    throw captureError;
  }
}

function assertDirectTargetChild(targetDir: string, path: string): void {
  const pathFromTarget = relative(resolve(targetDir), resolve(path));
  if (
    pathFromTarget === '' ||
    pathFromTarget.startsWith('..') ||
    isAbsolute(pathFromTarget) ||
    pathFromTarget.includes(sep)
  ) {
    throw new Error(`Unsafe snapshot rollback path outside managed target boundary: ${path}`);
  }
}

async function removeManagedTargetPath(targetDir: string, path: string): Promise<void> {
  const fs = await import('node:fs/promises');
  assertDirectTargetChild(targetDir, path);
  await assertTrustedProjectRoot(targetDir);
  const stats = await lstatIfPresent(path);
  if (!stats) return;

  // A readiness command may have replaced a managed leaf with a symlink. Unlink
  // that leaf directly; recursive removal is reserved for a real directory and
  // therefore never follows the leaf outside the project boundary.
  if (stats.isDirectory() && !stats.isSymbolicLink()) {
    await fs.rm(path, { recursive: true, force: true });
  } else {
    await fs.unlink(path);
  }
}

function targetPathDepth(targetDir: string, path: string): number {
  return relative(resolve(targetDir), resolve(path)).split(sep).filter(Boolean).length;
}

async function restoreRollbackPathMetadata(
  targetDir: string,
  pathMetadata: SnapshotRollbackPathMetadata[]
): Promise<void> {
  const fs = await import('node:fs/promises');
  const deepestFirst = [...pathMetadata].sort(
    (left, right) => targetPathDepth(targetDir, right.path) - targetPathDepth(targetDir, left.path)
  );

  for (const metadata of deepestFirst) {
    const pathFromTarget = relative(resolve(targetDir), resolve(metadata.path));
    if (pathFromTarget === '' || pathFromTarget.startsWith('..') || isAbsolute(pathFromTarget)) {
      throw new Error(`Unsafe snapshot rollback metadata path: ${metadata.path}`);
    }

    if (metadata.kind === 'directory') {
      await prevalidateSafeWritePath(
        join(metadata.path, '.omcodex-rollback-mode-probe'),
        targetDir
      );
    } else {
      await prevalidateSafeWritePath(metadata.path, targetDir);
    }
    const stats = await lstatIfPresent(metadata.path);
    if (
      !stats ||
      stats.isSymbolicLink() ||
      (metadata.kind === 'directory' ? !stats.isDirectory() : !stats.isFile())
    ) {
      throw new Error(`Unsafe snapshot rollback metadata target: ${metadata.path}`);
    }

    // chmod restores every permission/special bit on POSIX. Node exposes the
    // same API on Windows, where the platform applies its supported subset.
    // Any chmod error aborts rollback and is reported beside the original cause.
    await fs.chmod(metadata.path, metadata.mode);
  }
}

async function rollbackSnapshotTransaction(
  targetDir: string,
  transaction: SnapshotRollbackTransaction
): Promise<void> {
  for (const operation of transaction.restoreOperations) {
    await validateCopySource(operation, 'snapshot rollback staging source');
  }

  // The permanent non-force backup belongs to a successful install only. Remove
  // the exact directory allocated by this attempt before replacing managed roots.
  if (transaction.backupDir) {
    await removeManagedTargetPath(targetDir, transaction.backupDir);
  }
  for (const managedPath of transaction.managedPaths) {
    await removeManagedTargetPath(targetDir, managedPath);
  }
  for (const operation of transaction.restoreOperations) {
    await prevalidateCopyOperation(operation, targetDir);
  }
  for (const operation of transaction.restoreOperations) {
    await executeCopyOperation(operation, targetDir);
  }
  await restoreRollbackPathMetadata(targetDir, transaction.pathMetadata);
  await removeRollbackDirectory(transaction.directory);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function approvalNeededRecovery(
  targetDir: string,
  provision: SnapshotOmxProvisionResult
): string | null {
  const provisionError = provision.error ?? '';
  const approvalNeeded =
    provision.assessment?.project?.hookReadiness?.status === 'approval-needed' ||
    /(?:approval-needed|needs? approval)/i.test(provisionError);
  if (!approvalNeeded) return null;

  return [
    provisionError || 'OMX project hooks are installed but need approval.',
    'Snapshot installation never auto-trusts project hooks; it attempts exact rollback before returning failure and reports rollback failure separately.',
    `Recovery for ${targetDir}:`,
    `(1) run \`${provision.command}\` from the project root to recreate the OMX project surfaces;`,
    '(2) enable hooks in the user-level $CODEX_HOME/config.toml with `[features] hooks = true`;',
    '(3) open and trust the project in Codex;',
    '(4) review and explicitly approve the project hooks with `/hooks`;',
    '(5) retry snapshot installation.',
  ].join(' ');
}

async function errorsAfterSnapshotFailure(
  targetDir: string,
  error: unknown,
  transaction: SnapshotRollbackTransaction | undefined,
  mutationStarted: boolean
): Promise<string[]> {
  const errors = [errorMessage(error)];
  if (!transaction || !mutationStarted) return errors;

  try {
    await rollbackSnapshotTransaction(targetDir, transaction);
  } catch (rollbackError) {
    errors.push(
      `Rollback failed: ${errorMessage(rollbackError)}. Recovery staging retained at: ${transaction.directory}`
    );
  }
  return errors;
}

async function ensureSnapshotRuntimeReady(
  targetDir: string,
  dependencies: SnapshotInstallDependencies
): Promise<void> {
  const provisionOmxProject = dependencies.ensureOmxProjectReady ?? ensureOmxProjectReady;
  const provision = provisionOmxProject(targetDir);
  if (!provision.success) {
    const recovery = approvalNeededRecovery(targetDir, provision);
    throw new Error(
      recovery ??
        provision.error ??
        `OMX project setup is incomplete. Run manually: ${provision.command}`
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

  let transaction: SnapshotRollbackTransaction | undefined;
  let mutationStarted = false;
  try {
    const plan = await buildAndValidateInstallPlan(targetDir, snapshotPath, options.force === true);
    transaction = await createSnapshotRollbackTransaction(targetDir, plan.backupDir);
    mutationStarted = true;

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

    // The target is now durably committed. Staging cleanup is housekeeping: a
    // cleanup failure must not turn a committed target into a reported failed
    // install whose bytes cannot be rolled back after a partial recursive delete.
    try {
      await removeRollbackDirectory(transaction.directory);
    } catch (cleanupError) {
      console.warn(
        `Snapshot installed, but rollback staging cleanup failed (${transaction.directory}): ${errorMessage(cleanupError)}`
      );
    }
    transaction = undefined;

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
    const errors = await errorsAfterSnapshotFailure(targetDir, error, transaction, mutationStarted);
    console.error(i18n.t('cli.init.failed'), errors.join(' | '));
    return {
      success: false,
      message: i18n.t('cli.init.failed'),
      errors,
    };
  }
}
