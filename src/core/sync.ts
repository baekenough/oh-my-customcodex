/**
 * Sync check and snapshot export for team drift detection
 *
 * Compares the current runtime state against the installed lockfile to detect
 * configuration drift. Also supports exporting the current state as a reusable
 * snapshot that team members can install with `omcodex init --from-snapshot`.
 */

import { mkdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  copyDirectory,
  copyFile,
  getPackageRoot,
  prevalidateCopyDirectory,
  prevalidateSafeWritePath,
  readJsonFile,
} from '../utils/fs.js';
import { getComponentPath, getProviderLayout } from './layout.js';
import {
  diffLockfiles,
  generateLockfile,
  LOCKFILE_NAME,
  type Lockfile,
  readLockfile,
  resolveLockfileRootContext,
  writeLockfile,
} from './lockfile.js';
import { detectProvider } from './provider.js';

export interface SyncCheckResult {
  /** True when no added, removed, or modified files are detected */
  inSync: boolean;
  /** Files present in the current state but absent in the reference lockfile */
  added: string[];
  /** Files recorded in the reference lockfile that no longer exist */
  removed: string[];
  /** Files present in both but with different hashes */
  modified: string[];
  /** Count of files that match exactly */
  unchanged: number;
  /** Version string from the reference lockfile, or null when none exists */
  referenceVersion: string | null;
  /** Version string from the current generated lockfile, or null on failure */
  currentVersion: string | null;
  /** Total number of files tracked in the current state */
  totalTracked: number;
}

export interface SyncExportResult {
  success: boolean;
  exportPath: string;
  fileCount: number;
}

export interface SyncDependencies {
  readLockfile?: typeof readLockfile;
  generateLockfile?: typeof generateLockfile;
  diffLockfiles?: typeof diffLockfiles;
}

export interface SyncCheckOptions {
  reference?: string;
  dependencies?: SyncDependencies;
}

/**
 * Load generator and template versions from the package root.
 * Returns fallback strings on failure so callers never throw.
 */
async function loadVersions(): Promise<{ generatorVersion: string; templateVersion: string }> {
  try {
    const packageRoot = getPackageRoot();
    const manifest = await readJsonFile<{ version: string }>(
      join(packageRoot, 'templates', 'manifest.json')
    );
    const pkg = await readJsonFile<{ version: string }>(join(packageRoot, 'package.json'));
    return { generatorVersion: pkg.version, templateVersion: manifest.version };
  } catch {
    return { generatorVersion: '0.0.0', templateVersion: '0.0.0' };
  }
}

/**
 * Generate the current lockfile snapshot for a target directory.
 * Reads package and manifest versions from the installed package root.
 */
async function generateCurrentLockfile(
  targetDir: string,
  dependencies: SyncDependencies = {}
): Promise<Lockfile | null> {
  try {
    const generate = dependencies.generateLockfile ?? generateLockfile;
    const { generatorVersion, templateVersion } = await loadVersions();
    return await generate(targetDir, generatorVersion, templateVersion);
  } catch {
    return null;
  }
}

/**
 * Compare current runtime state against an installed lockfile (or an external
 * reference snapshot).
 *
 * @param targetDir - Project root containing the current harness lockfile
 * @param options.reference - Optional path to an external snapshot directory;
 *   when omitted, uses the lockfile found in targetDir
 */
export async function syncCheck(
  targetDir: string,
  options: SyncCheckOptions = {}
): Promise<SyncCheckResult> {
  const empty: SyncCheckResult = {
    inSync: false,
    added: [],
    removed: [],
    modified: [],
    unchanged: 0,
    referenceVersion: null,
    currentVersion: null,
    totalTracked: 0,
  };

  const referenceDir = options.reference ?? targetDir;
  const read = options.dependencies?.readLockfile ?? readLockfile;
  const diff = options.dependencies?.diffLockfiles ?? diffLockfiles;
  const reference = await read(referenceDir);

  if (!reference) {
    return empty;
  }

  const current = await generateCurrentLockfile(targetDir, options.dependencies);
  if (!current) {
    return {
      ...empty,
      referenceVersion: reference.generatorVersion,
    };
  }

  const lockfileDiff = diff(reference, current);

  return {
    inSync:
      lockfileDiff.added.length === 0 &&
      lockfileDiff.removed.length === 0 &&
      lockfileDiff.modified.length === 0,
    added: lockfileDiff.added,
    removed: lockfileDiff.removed,
    modified: lockfileDiff.modified,
    unchanged: lockfileDiff.unchanged.length,
    referenceVersion: reference.generatorVersion,
    currentVersion: current.generatorVersion,
    totalTracked: Object.keys(current.files).length,
  };
}

const EXPORT_EXCLUDE_PATTERNS = [
  'agent-memory',
  'agent-memory-local',
  'outputs',
  '*settings.local*',
];

function isExcludedExportEntry(name: string, additionalNames: ReadonlySet<string>): boolean {
  return (
    additionalNames.has(name) ||
    name === 'agent-memory' ||
    name === 'agent-memory-local' ||
    name === 'outputs' ||
    name.includes('settings.local')
  );
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

async function assertRegularExportTree(
  path: string,
  description: string,
  additionalExcludedNames: ReadonlySet<string> = new Set(),
  sourceRoot: string = path
): Promise<void> {
  const fs = await import('node:fs/promises');
  const stats = await lstatIfPresent(path);
  if (!stats) throw new Error(`Snapshot export source disappeared: ${path}`);
  if (stats.isSymbolicLink()) {
    throw new Error(`Unsafe ${description}: symbolic links are not allowed: ${path}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Unsafe ${description}: expected a directory: ${path}`);
  }

  for (const entry of await fs.readdir(path, { withFileTypes: true })) {
    // Source validation and copy must use the same exclusion contract. An
    // ignored runtime-local tree is neither followed nor copied.
    const rootOnlyExcludes = path === sourceRoot ? additionalExcludedNames : new Set<string>();
    if (isExcludedExportEntry(entry.name, rootOnlyExcludes)) continue;
    const entryPath = join(path, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Unsafe ${description}: symbolic links are not allowed: ${entryPath}`);
    }
    if (entry.isDirectory()) {
      await assertRegularExportTree(entryPath, description, additionalExcludedNames, sourceRoot);
      continue;
    }
    if (entry.isFile()) continue;
    throw new Error(`Unsafe ${description}: special files are not allowed: ${entryPath}`);
  }
}

async function assertRegularExportFile(path: string, description: string): Promise<void> {
  const stats = await lstatIfPresent(path);
  if (!stats) throw new Error(`Snapshot export source disappeared: ${path}`);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    throw new Error(`Unsafe ${description}: expected a single-link regular file: ${path}`);
  }
}

interface SnapshotExportOperation {
  kind: 'directory' | 'file';
  source: string;
  destination: string;
  exclude?: string[];
  skipPaths?: string[];
  excludedSourceNames?: ReadonlySet<string>;
}

async function appendDirectoryExport(
  operations: SnapshotExportOperation[],
  source: string,
  destination: string,
  options: Pick<SnapshotExportOperation, 'exclude' | 'skipPaths' | 'excludedSourceNames'> = {}
): Promise<void> {
  if (!(await lstatIfPresent(source))) return;
  operations.push({ kind: 'directory', source, destination, ...options });
}

async function appendFileExport(
  operations: SnapshotExportOperation[],
  source: string,
  destination: string
): Promise<void> {
  if (!(await lstatIfPresent(source))) return;
  operations.push({ kind: 'file', source, destination });
}

async function buildSnapshotExportOperations(
  targetDir: string,
  outputPath: string,
  provider: 'codex' | 'claude'
): Promise<SnapshotExportOperation[]> {
  const layout = getProviderLayout(provider);
  const roots = resolveLockfileRootContext(targetDir);
  const operations: SnapshotExportOperation[] = [];
  const linked = provider === 'codex' && roots.codexProjectRoot !== roots.targetRoot;
  const linkedRuntimeExcludes = linked ? new Set(['hooks', 'hooks.json']) : new Set<string>();

  await appendDirectoryExport(
    operations,
    join(roots.targetRoot, layout.rootDir),
    join(outputPath, layout.rootDir),
    {
      exclude: EXPORT_EXCLUDE_PATTERNS,
      skipPaths: linked ? ['hooks/', 'hooks.json'] : undefined,
      excludedSourceNames: linkedRuntimeExcludes,
    }
  );
  const skillsPath = getComponentPath('skills', provider);
  await appendDirectoryExport(
    operations,
    join(roots.targetRoot, skillsPath),
    join(outputPath, skillsPath),
    { exclude: EXPORT_EXCLUDE_PATTERNS }
  );
  await appendDirectoryExport(
    operations,
    join(roots.targetRoot, 'guides'),
    join(outputPath, 'guides'),
    { exclude: EXPORT_EXCLUDE_PATTERNS }
  );
  if (linked) {
    await appendFileExport(
      operations,
      join(roots.codexProjectRoot, '.codex', 'hooks.json'),
      join(outputPath, '.codex', 'hooks.json')
    );
    await appendDirectoryExport(
      operations,
      join(roots.codexProjectRoot, '.codex', 'hooks'),
      join(outputPath, '.codex', 'hooks')
    );
  }
  return operations;
}

async function validateSnapshotExportSources(
  operations: SnapshotExportOperation[],
  outputPath: string
): Promise<void> {
  for (const operation of operations) {
    if (operation.kind === 'directory') {
      await assertRegularExportTree(
        operation.source,
        'snapshot export source',
        operation.excludedSourceNames
      );
    } else {
      await assertRegularExportFile(operation.source, 'snapshot export source');
    }
  }
  await assertNonOverlappingExportPath(
    outputPath,
    operations.map(({ source }) => source)
  );
}

async function prevalidateSnapshotExportDestinations(
  operations: SnapshotExportOperation[],
  planningRoot: string
): Promise<void> {
  for (const operation of operations) {
    if (operation.kind === 'directory') {
      await prevalidateCopyDirectory(operation.source, operation.destination, {
        overwrite: true,
        exclude: operation.exclude,
        skipPaths: operation.skipPaths,
        trustedWriteRoot: planningRoot,
      });
    } else {
      await prevalidateSafeWritePath(operation.destination, planningRoot);
    }
  }
}

async function executeSnapshotExportOperations(
  operations: SnapshotExportOperation[],
  outputPath: string
): Promise<void> {
  for (const operation of operations) {
    if (operation.kind === 'directory') {
      await copyDirectory(operation.source, operation.destination, {
        overwrite: true,
        exclude: operation.exclude,
        skipPaths: operation.skipPaths,
        trustedWriteRoot: outputPath,
      });
    } else {
      await copyFile(operation.source, operation.destination, outputPath);
    }
  }
}

async function findExistingTrustedBoundary(path: string): Promise<string> {
  let current = resolve(path);
  while (true) {
    const stats = await lstatIfPresent(current);
    if (stats && !stats.isSymbolicLink() && stats.isDirectory()) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Unable to find a trusted directory boundary for: ${path}`);
    }
    current = parent;
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

async function assertNonOverlappingExportPath(
  outputPath: string,
  sourcePaths: string[]
): Promise<void> {
  const canonicalOutput = await canonicalizePathForOverlap(outputPath);
  for (const sourcePath of sourcePaths) {
    const canonicalSource = await canonicalizePathForOverlap(sourcePath);
    if (
      isSameOrDescendant(canonicalOutput, canonicalSource) ||
      isSameOrDescendant(canonicalSource, canonicalOutput)
    ) {
      throw new Error(`Unsafe snapshot export: output overlaps source tree: ${sourcePath}`);
    }
  }
}

/**
 * Count all regular files under a directory using async readdir.
 * Returns 0 on any error.
 */
async function countFiles(dir: string): Promise<number> {
  const { lstat, readdir } = await import('node:fs/promises');

  async function walk(current: string): Promise<number> {
    let total = 0;
    let entries: string[];

    try {
      entries = await readdir(current);
    } catch {
      return 0;
    }

    for (const entry of entries) {
      const full = join(current, entry);
      try {
        const s = await lstat(full);
        if (s.isDirectory()) {
          total += await walk(full);
        } else if (s.isFile()) {
          total += 1;
        }
      } catch {
        // Ignore files that disappear between readdir and stat
      }
    }

    return total;
  }

  return walk(dir);
}

/**
 * Export the current runtime state (and guides/) as a reusable snapshot.
 *
 * The snapshot includes a freshly generated lockfile so recipients can run
 * drift checks against it after installation.
 *
 * Excludes: agent-memory, outputs, and settings.local files.
 *
 * @param targetDir - Project root to export from
 * @param outputPath - Destination directory for the snapshot
 */
export async function exportSnapshot(
  targetDir: string,
  outputPath: string
): Promise<SyncExportResult> {
  const canonicalTargetDir = await canonicalizePathForOverlap(targetDir);
  const targetStats = await lstatIfPresent(canonicalTargetDir);
  if (!targetStats || !targetStats.isDirectory()) {
    throw new Error(`Unsafe snapshot export source root: ${targetDir}`);
  }

  const detection = await detectProvider({ targetDir });
  const destinationOperations = await buildSnapshotExportOperations(
    targetDir,
    outputPath,
    detection.provider
  );
  if (destinationOperations.length === 0) {
    return { success: false, exportPath: outputPath, fileCount: 0 };
  }
  await validateSnapshotExportSources(destinationOperations, outputPath);

  // Build all content before preflighting the destination. Lockfile generation
  // is read-only and must never occur after export mutation has begun.
  const lockfile = await generateCurrentLockfile(targetDir);

  // outputPath may not exist yet. Use the nearest existing real directory only
  // for the read-only full-plan preflight, then make outputPath the explicit
  // trusted root for every actual copy/write.
  const planningRoot = await findExistingTrustedBoundary(outputPath);
  await prevalidateSnapshotExportDestinations(destinationOperations, planningRoot);
  if (lockfile) {
    await prevalidateSafeWritePath(join(outputPath, LOCKFILE_NAME), planningRoot);
  }

  await mkdir(outputPath, { recursive: true });
  await executeSnapshotExportOperations(destinationOperations, outputPath);
  if (lockfile) {
    await writeLockfile(outputPath, lockfile, { trustedWriteRoot: outputPath });
  }

  const fileCount = await countFiles(outputPath);
  return { success: true, exportPath: outputPath, fileCount };
}
