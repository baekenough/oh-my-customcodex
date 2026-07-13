/**
 * Lockfile module for three-way merge support
 *
 * Records SHA-256 checksums of all template files at install time.
 * Enables three-way merge during `omcodex update` by providing
 * the original template state (base) to detect user modifications
 * vs. upstream template changes.
 */

import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve } from 'node:path';
import {
  fileExists,
  getPackageRoot,
  readJsonFile,
  type SafeWriteOptions,
  writeJsonFile,
} from '../utils/fs.js';
import { debug, warn } from '../utils/logger.js';
import { resolveCodexProjectRoot, resolveCodexTargetRoot } from './codex-project-root.js';
import { getComponentPath, type InstallComponent } from './layout.js';

export const LOCKFILE_NAME = '.omcodex.lock.json';
export const LEGACY_LOCKFILE_NAME = '.omcustom.lock.json';
export const LOCKFILE_VERSION = 1 as const;

export function getLockfileCandidatePaths(targetDir: string): string[] {
  return [join(targetDir, LOCKFILE_NAME), join(targetDir, LEGACY_LOCKFILE_NAME)];
}

/**
 * Per-file entry in the lockfile
 */
export interface LockfileEntry {
  /** SHA-256 hash of the template file at install time */
  templateHash: string;
  /** File size in bytes at install time */
  size: number;
  /** Component this file belongs to (rules, agents, skills, guides, hooks, contexts, ontology) */
  component: string;
  /** Use Codex's authoritative checkout root instead of the requested target checkout. */
  root?: 'codex-project';
}

/**
 * Root lockfile structure
 */
export interface Lockfile {
  /** Lockfile format version */
  lockfileVersion: typeof LOCKFILE_VERSION;
  /** oh-my-customcodex version that generated this lockfile */
  generatorVersion: string;
  /** ISO timestamp of lockfile generation */
  generatedAt: string;
  /** Template manifest version at install time */
  templateVersion: string;
  /** Per-file entries, keyed by relative path from project root */
  files: Record<string, LockfileEntry>;
}

/**
 * Diff result between two lockfiles
 */
export interface LockfileDiff {
  /** Files in current but not in base */
  added: string[];
  /** Files in base but not in current */
  removed: string[];
  /** Files in both but with different hashes */
  modified: string[];
  /** Files in both with same hash */
  unchanged: string[];
}

/**
 * Components tracked by the lockfile.
 * Derived from layout.ts to maintain a single source of truth.
 * Excludes 'entry-md' which is handled separately (project root docs).
 */
const LOCKFILE_COMPONENTS: readonly InstallComponent[] = [
  'rules',
  'agents',
  'skills',
  'hooks',
  'contexts',
  'ontology',
  'guides',
] as const;

/**
 * Component path mapping: directory path prefix -> component name.
 * Computed from layout.ts getComponentPath().
 */
const COMPONENT_PATHS: ReadonlyArray<readonly [string, string]> = LOCKFILE_COMPONENTS.map(
  (component) => [getComponentPath(component), component] as const
);

const STANDALONE_COMPONENT_FILES: ReadonlyArray<readonly [string, string]> = [
  ['.codex/hooks.json', 'hooks'],
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeLockfileKey(relativePath: string): boolean {
  if (
    relativePath.length === 0 ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    posix.isAbsolute(relativePath) ||
    /^[a-zA-Z]:\//.test(relativePath) ||
    posix.normalize(relativePath) !== relativePath
  ) {
    return false;
  }
  return relativePath
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function isCodexHookKey(relativePath: string): boolean {
  return relativePath === '.codex/hooks.json' || relativePath.startsWith('.codex/hooks/');
}

function isValidLockfileEntry(relativePath: string, value: unknown): value is LockfileEntry {
  if (!isSafeLockfileKey(relativePath) || !isRecord(value)) return false;
  if (
    typeof value.templateHash !== 'string' ||
    typeof value.size !== 'number' ||
    !Number.isFinite(value.size) ||
    value.size < 0 ||
    typeof value.component !== 'string' ||
    value.component.length === 0
  ) {
    return false;
  }
  if (value.root !== undefined && value.root !== 'codex-project') return false;
  return (
    value.root !== 'codex-project' || (value.component === 'hooks' && isCodexHookKey(relativePath))
  );
}

function hasValidLockfileFiles(value: unknown): value is Record<string, LockfileEntry> {
  return (
    isRecord(value) &&
    Object.entries(value).every(([relativePath, entry]) =>
      isValidLockfileEntry(relativePath, entry)
    )
  );
}

/**
 * Compute SHA-256 hash of a file using a read stream.
 * Returns lowercase hex digest.
 */
export function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('error', (err) => {
      reject(err);
    });

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });
  });
}

/**
 * Read the lockfile from targetDir.
 * Returns null if the file does not exist or has an invalid lockfileVersion.
 */
export async function readLockfile(targetDir: string): Promise<Lockfile | null> {
  for (const lockfilePath of getLockfileCandidatePaths(targetDir)) {
    const exists = await fileExists(lockfilePath);
    if (!exists) {
      continue;
    }

    try {
      const data = await readJsonFile<unknown>(lockfilePath);

      if (
        typeof data !== 'object' ||
        data === null ||
        (data as Record<string, unknown>).lockfileVersion !== LOCKFILE_VERSION
      ) {
        warn('lockfile.invalid_version', { path: lockfilePath });
        return null;
      }

      const record = data as Record<string, unknown>;
      if (!hasValidLockfileFiles(record.files)) {
        warn('lockfile.invalid_structure', { path: lockfilePath });
        return null;
      }

      return data as Lockfile;
    } catch (err) {
      warn('lockfile.read_failed', { path: lockfilePath, error: String(err) });
      return null;
    }
  }

  debug('lockfile.not_found', { path: join(targetDir, LOCKFILE_NAME) });
  return null;
}

/**
 * Write a lockfile to targetDir with 2-space indented JSON.
 */
export async function writeLockfile(
  targetDir: string,
  lockfile: Lockfile,
  options: SafeWriteOptions = {}
): Promise<void> {
  const lockfilePath = join(targetDir, LOCKFILE_NAME);
  await writeJsonFile(lockfilePath, lockfile, options);
  debug('lockfile.written', { path: lockfilePath });
}

/**
 * Determine the component name for a given file path.
 * Uses the first matching prefix from COMPONENT_PATHS.
 * Falls back to 'unknown' if no prefix matches.
 */
function resolveComponent(relativePath: string): string {
  // Normalize to forward slashes for cross-platform matching
  const normalized = relativePath.replace(/\\/g, '/');

  for (const [prefix, component] of COMPONENT_PATHS) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return component;
    }
  }

  return 'unknown';
}

function assertPathInsideRoot(root: string, filePath: string): void {
  const pathFromRoot = relative(root, filePath);
  if (
    pathFromRoot === '..' ||
    pathFromRoot.startsWith('../') ||
    pathFromRoot.startsWith('..\\') ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(`Unsafe lockfile path: destination escapes trusted root "${root}"`);
  }
}

async function inspectSafePath(
  trustedRoot: string,
  filePath: string,
  expected: 'directory' | 'file',
  allowMissing: boolean
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  const root = resolve(trustedRoot);
  const destination = resolve(filePath);
  assertPathInsideRoot(root, destination);

  const rootStats = await inspectTrustedRoot(root);

  let current = root;
  const segments = relative(root, destination).split(/[\\/]/).filter(Boolean);
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]);
    const final = index === segments.length - 1;
    const stats = await inspectPathSegment(current, allowMissing);
    if (!stats) return null;
    assertSafePathSegment(stats, current, final ? expected : 'directory');
    if (final) return stats;
  }

  return rootStats;
}

async function inspectTrustedRoot(root: string): Promise<Awaited<ReturnType<typeof lstat>>> {
  const stats = await lstat(root);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Unsafe lockfile path: trusted root is not a regular directory "${root}"`);
  }
  return stats;
}

async function inspectPathSegment(
  path: string,
  allowMissing: boolean
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function assertSafePathSegment(
  stats: Awaited<ReturnType<typeof lstat>>,
  path: string,
  expected: 'directory' | 'file'
): void {
  if (stats.isSymbolicLink()) {
    throw new Error(`Unsafe lockfile path: symbolic link segment "${path}"`);
  }
  if (expected === 'directory' && !stats.isDirectory()) {
    throw new Error(`Unsafe lockfile path: expected directory "${path}"`);
  }
  if (expected === 'file' && !stats.isFile()) {
    throw new Error(`Unsafe lockfile path: expected regular file "${path}"`);
  }
  if (expected === 'file' && stats.nlink !== 1) {
    throw new Error(`Unsafe lockfile path: file has multiple hard links "${path}"`);
  }
}

export interface LockfileRootContext {
  targetRoot: string;
  codexProjectRoot: string;
}

/** Resolve Git/worktree roots once for a complete lockfile operation. */
export function resolveLockfileRootContext(targetDir: string): LockfileRootContext {
  return {
    targetRoot: resolveCodexTargetRoot(targetDir),
    codexProjectRoot: resolveCodexProjectRoot(targetDir),
  };
}

function lockfileEntryRoot(context: LockfileRootContext, entry: LockfileEntry): string {
  return entry.root === 'codex-project' ? context.codexProjectRoot : context.targetRoot;
}

/** Resolve one validated lockfile entry without following links below its trusted root. */
export async function resolveLockfileEntryPath(
  targetDir: string,
  relativePath: string,
  entry: LockfileEntry,
  context: LockfileRootContext = resolveLockfileRootContext(targetDir)
): Promise<string> {
  if (!isValidLockfileEntry(relativePath, entry)) {
    throw new Error(`Unsafe lockfile entry: ${relativePath}`);
  }
  const root = lockfileEntryRoot(context, entry);
  const filePath = join(root, ...relativePath.split('/'));
  await inspectSafePath(root, filePath, 'file', true);
  return filePath;
}

async function computeSafeFileMetadata(
  filePath: string,
  trustedRoot: string,
  options: LockfileMetadataOptions = {}
): Promise<{ templateHash: string; size: number }> {
  const inspected = await inspectSafePath(trustedRoot, filePath, 'file', false);
  if (!inspected) throw new Error(`Unsafe lockfile path: file disappeared "${filePath}"`);
  await options.afterPathInspection?.(filePath);
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const handle = await open(filePath, constants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      inspected.dev !== before.dev ||
      inspected.ino !== before.ino
    ) {
      throw new Error(`Unsafe lockfile path: file identity changed before hashing "${filePath}"`);
    }
    const hash = createHash('sha256');
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) hash.update(chunk);
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      after.nlink !== 1
    ) {
      throw new Error(`Unsafe lockfile path: file identity changed while hashing "${filePath}"`);
    }
    const finalPathStats = await inspectSafePath(trustedRoot, filePath, 'file', false);
    if (
      !finalPathStats ||
      finalPathStats.dev !== after.dev ||
      finalPathStats.ino !== after.ino ||
      finalPathStats.nlink !== 1
    ) {
      throw new Error(`Unsafe lockfile path: file identity changed after hashing "${filePath}"`);
    }
    return { templateHash: hash.digest('hex'), size: after.size };
  } finally {
    await handle.close();
  }
}

export interface LockfileMetadataOptions {
  /** Test seam used to prove path replacement cannot redirect an already inspected read. */
  afterPathInspection?: (filePath: string) => Promise<void> | void;
}

/** Hash one lockfile entry through the same root and link policy used by generation. */
export async function computeLockfileEntryMetadata(
  targetDir: string,
  relativePath: string,
  entry: LockfileEntry,
  context: LockfileRootContext = resolveLockfileRootContext(targetDir),
  options: LockfileMetadataOptions = {}
): Promise<{ templateHash: string; size: number }> {
  const filePath = await resolveLockfileEntryPath(targetDir, relativePath, entry, context);
  return computeSafeFileMetadata(filePath, lockfileEntryRoot(context, entry), options);
}

/**
 * Walk a directory recursively and collect all file paths.
 * Skips entries that are not regular files (directories, symlinks, etc.).
 * Skips hidden entries (starting with '.') only at the top level of targetDir.
 */
async function collectFiles(dir: string, projectRoot: string): Promise<string[]> {
  const results: string[] = [];

  const directoryStats = await inspectSafePath(projectRoot, dir, 'directory', true);
  if (!directoryStats) return results;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // Directory does not exist or is not readable — skip silently
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);

    let fileStat: Awaited<ReturnType<typeof lstat>>;
    try {
      fileStat = await lstat(fullPath);
    } catch {
      // File disappeared between readdir and stat — skip
      continue;
    }

    if (fileStat.isSymbolicLink()) {
      throw new Error(`Unsafe lockfile path: symbolic link segment "${fullPath}"`);
    }
    if (fileStat.isDirectory()) {
      const subFiles = await collectFiles(fullPath, projectRoot);
      results.push(...subFiles);
    } else if (fileStat.isFile()) {
      if (fileStat.nlink !== 1) {
        throw new Error(`Unsafe lockfile path: file has multiple hard links "${fullPath}"`);
      }
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Generate a lockfile by walking all installed template files in targetDir.
 * Computes SHA-256 for each file and resolves the component from the path.
 */
export async function generateLockfile(
  targetDir: string,
  generatorVersion: string,
  templateVersion: string
): Promise<Lockfile> {
  const files: Record<string, LockfileEntry> = {};
  const context = resolveLockfileRootContext(targetDir);

  for (const [prefix, mappedComponent] of COMPONENT_PATHS) {
    await collectComponentEntries(files, prefix, mappedComponent, context);
  }

  for (const [relativePath, component] of STANDALONE_COMPONENT_FILES) {
    await collectStandaloneEntry(files, relativePath, component, context);
  }

  return {
    lockfileVersion: LOCKFILE_VERSION,
    generatorVersion,
    generatedAt: new Date().toISOString(),
    templateVersion,
    files,
  };
}

function authoritativeHookRoot(context: LockfileRootContext): {
  physicalRoot: string;
  usesCodexProjectRoot: boolean;
} {
  const usesCodexProjectRoot = context.codexProjectRoot !== context.targetRoot;
  return {
    physicalRoot: usesCodexProjectRoot ? context.codexProjectRoot : context.targetRoot,
    usesCodexProjectRoot,
  };
}

async function collectComponentEntries(
  files: Record<string, LockfileEntry>,
  prefix: string,
  mappedComponent: string,
  context: LockfileRootContext
): Promise<void> {
  const hookRoot = authoritativeHookRoot(context);
  const usesCodexProjectRoot = mappedComponent === 'hooks' && hookRoot.usesCodexProjectRoot;
  const physicalRoot = usesCodexProjectRoot ? hookRoot.physicalRoot : context.targetRoot;
  const componentRoot = join(physicalRoot, prefix);
  if (!(await inspectSafePath(physicalRoot, componentRoot, 'directory', true))) {
    debug('lockfile.component_dir_missing', { path: componentRoot });
    return;
  }

  for (const absolutePath of await collectFiles(componentRoot, physicalRoot)) {
    const relativePath = relative(physicalRoot, absolutePath).replace(/\\/g, '/');
    const metadata = await computeSafeFileMetadata(absolutePath, physicalRoot);
    const component = resolveComponent(relativePath);
    files[relativePath] = {
      ...metadata,
      component,
      ...(usesCodexProjectRoot ? { root: 'codex-project' as const } : {}),
    };
    debug('lockfile.entry_added', { path: relativePath, component });
  }
}

async function collectStandaloneEntry(
  files: Record<string, LockfileEntry>,
  relativePath: string,
  component: string,
  context: LockfileRootContext
): Promise<void> {
  const { physicalRoot, usesCodexProjectRoot } = authoritativeHookRoot(context);
  const absolutePath = join(physicalRoot, relativePath);
  if (!(await inspectSafePath(physicalRoot, absolutePath, 'file', true))) return;
  files[relativePath] = {
    ...(await computeSafeFileMetadata(absolutePath, physicalRoot)),
    component,
    ...(usesCodexProjectRoot ? { root: 'codex-project' as const } : {}),
  };
  debug('lockfile.entry_added', { path: relativePath, component });
}

/**
 * Generate and write a lockfile for a target directory.
 * Reads package.json and manifest.json from the package root to determine versions.
 * Non-throwing: returns warnings array on failure.
 */
export async function generateAndWriteLockfileForDir(
  targetDir: string,
  options: SafeWriteOptions = {}
): Promise<{ fileCount: number; warning?: string }> {
  try {
    const packageRoot = getPackageRoot();
    const manifest = await readJsonFile<{ version: string }>(
      join(packageRoot, 'templates', 'manifest.json')
    );
    const { version: generatorVersion } = await readJsonFile<{ version: string }>(
      join(packageRoot, 'package.json')
    );
    const lockfile = await generateLockfile(targetDir, generatorVersion, manifest.version);
    await writeLockfile(targetDir, lockfile, options);
    return { fileCount: Object.keys(lockfile.files).length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { fileCount: 0, warning: `Lockfile generation failed: ${msg}` };
  }
}

/**
 * Compare two lockfiles and return a categorized diff.
 */
export function diffLockfiles(base: Lockfile, current: Lockfile): LockfileDiff {
  const baseKeys = new Set(Object.keys(base.files));
  const currentKeys = new Set(Object.keys(current.files));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  const unchanged: string[] = [];

  for (const key of currentKeys) {
    if (!baseKeys.has(key)) {
      added.push(key);
    } else if (
      base.files[key].templateHash !== current.files[key].templateHash ||
      base.files[key].root !== current.files[key].root
    ) {
      modified.push(key);
    } else {
      unchanged.push(key);
    }
  }

  for (const key of baseKeys) {
    if (!currentKeys.has(key)) {
      removed.push(key);
    }
  }

  return { added, removed, modified, unchanged };
}
