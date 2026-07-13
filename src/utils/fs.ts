/**
 * File system utilities
 */

import { type Dirent, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAMES = new Set(['oh-my-customcodex', '@baekenough/oh-my-customcodex']);

/**
 * Result of path validation
 */
export interface PathValidationResult {
  /** Whether the path is valid */
  valid: boolean;
  /** Reason for rejection (if invalid) */
  reason?: string;
}

export interface SafeWriteOptions {
  /** Trusted ancestor that must contain the write target */
  trustedWriteRoot?: string;
}

/**
 * Validate a preserveFiles path for security (path traversal prevention)
 *
 * @param filePath - The file path to validate
 * @param projectRoot - The project root directory
 * @returns Validation result with reason if invalid
 */
export function validatePreserveFilePath(
  filePath: string,
  projectRoot: string
): PathValidationResult {
  // Reject empty strings
  if (!filePath || filePath.trim() === '') {
    return {
      valid: false,
      reason: 'Path cannot be empty',
    };
  }

  // Reject absolute paths
  if (isAbsolute(filePath) || win32.isAbsolute(filePath)) {
    return {
      valid: false,
      reason: 'Absolute paths are not allowed',
    };
  }

  // Resolve the path against the project root and verify it stays within bounds.
  // This handles all traversal patterns (../../etc/passwd) on both POSIX and Windows.
  const resolvedPath = resolve(projectRoot, filePath);
  const relativePath = relative(projectRoot, resolvedPath);

  // If relative path starts with .. or is absolute, it escaped the project root
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return {
      valid: false,
      reason: 'Path cannot traverse outside project root',
    };
  }

  return { valid: true };
}

/**
 * Options for copying directories
 */
export interface CopyOptions {
  /** Whether to overwrite existing files */
  overwrite?: boolean;
  /** File patterns to exclude (glob patterns) */
  exclude?: string[];
  /** File patterns to include (glob patterns) */
  include?: string[];
  /** Preserve file timestamps */
  preserveTimestamps?: boolean;
  /** Preserve symlinks instead of following them */
  preserveSymlinks?: boolean;
  /** Paths to skip during copy (relative to dest root) */
  skipPaths?: string[];
  /** Trusted ancestor that must contain every destination write */
  trustedWriteRoot?: string;
}

async function findTrustedWriteBoundary(path: string): Promise<string> {
  const fs = await import('node:fs/promises');
  let current = resolve(path);

  while (true) {
    try {
      const stats = await fs.lstat(current);
      if (!stats.isSymbolicLink() && stats.isDirectory()) {
        return current;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }
}

async function resolveTrustedWriteRoot(
  resolvedPath: string,
  trustedWriteRoot: string
): Promise<string> {
  const fs = await import('node:fs/promises');
  const boundary = resolve(trustedWriteRoot);
  const pathFromBoundary = relative(boundary, resolvedPath);

  if (pathFromBoundary.startsWith('..') || isAbsolute(pathFromBoundary)) {
    throw new Error(`Unsafe write path: destination escapes trusted root "${boundary}"`);
  }

  const stats = await fs.lstat(boundary);
  if (stats.isSymbolicLink()) {
    throw new Error(`Unsafe write path: trusted root is a symbolic link "${boundary}"`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Unsafe write path: trusted root is not a directory "${boundary}"`);
  }

  return boundary;
}

async function ensureSafeDirectoryForWrite(path: string, trustedWriteRoot?: string): Promise<void> {
  const fs = await import('node:fs/promises');
  const resolved = resolve(path);
  const boundary = trustedWriteRoot
    ? await resolveTrustedWriteRoot(resolved, trustedWriteRoot)
    : await findTrustedWriteBoundary(resolved);
  let current = boundary;

  for (const segment of relative(boundary, resolved).split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Unsafe write path: symbolic link directory segment "${current}"`);
      }
      if (!stats.isDirectory()) {
        throw new Error(`Unsafe write path: parent segment is not a directory "${current}"`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      await fs.mkdir(current);
    }
  }
}

async function assertSafeFileDestination(path: string): Promise<void> {
  const fs = await import('node:fs/promises');
  try {
    const stats = await fs.lstat(path);
    if (stats.isSymbolicLink()) {
      throw new Error(`Unsafe write path: destination is a symbolic link "${path}"`);
    }
    if (!stats.isFile()) {
      throw new Error(`Unsafe write path: destination is not a regular file "${path}"`);
    }
    // This guard is repeated immediately before writes to narrow, not eliminate,
    // the filesystem TOCTOU window left by full-plan prevalidation.
    if (stats.nlink > 1) {
      throw new Error(`Unsafe write path: destination has multiple hard links "${path}"`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Check if a file or directory exists
 */
export async function fileExists(path: string): Promise<boolean> {
  const fs = await import('node:fs/promises');
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDirectory(path: string): Promise<void> {
  const fs = await import('node:fs/promises');
  await fs.mkdir(path, { recursive: true });
}

/**
 * Check if entry should be skipped based on include/exclude patterns
 */
function shouldSkipEntry(entryName: string, options: CopyOptions): boolean {
  if (options.exclude?.some((pattern) => matchesPattern(entryName, pattern))) {
    return true;
  }
  if (options.include && !options.include.some((pattern) => matchesPattern(entryName, pattern))) {
    return true;
  }
  return false;
}

/**
 * Handle copying a symlink entry
 */
async function handleSymlink(
  srcPath: string,
  destPath: string,
  options: CopyOptions,
  fs: typeof import('node:fs/promises'),
  destRoot: string
): Promise<void> {
  const destExists = await fileExists(destPath);
  if (destExists && !options.overwrite) {
    return;
  }

  if (options.preserveSymlinks !== false) {
    await assertSafeFileDestination(destPath);
    await copyPreservedSymlink(srcPath, destPath, destExists, fs);
  } else {
    await copyFollowedSymlink(srcPath, destPath, destExists, options, fs, destRoot);
  }
}

/**
 * Copy symlink while preserving the link
 */
async function copyPreservedSymlink(
  srcPath: string,
  destPath: string,
  destExists: boolean,
  fs: typeof import('node:fs/promises')
): Promise<void> {
  const linkTarget = await fs.readlink(srcPath);
  if (destExists) {
    await fs.unlink(destPath);
  }
  await fs.symlink(linkTarget, destPath);
}

/**
 * Copy symlink by following it and copying the actual content
 */
async function copyFollowedSymlink(
  srcPath: string,
  destPath: string,
  destExists: boolean,
  options: CopyOptions,
  fs: typeof import('node:fs/promises'),
  destRoot: string
): Promise<void> {
  const realPath = await fs.realpath(srcPath);
  const stat = await fs.stat(realPath);

  if (stat.isDirectory()) {
    await copyDirectoryInternal(realPath, destPath, options, destRoot);
    return;
  }

  if (destExists) {
    await fs.unlink(destPath);
  }
  await assertSafeFileDestination(destPath);
  await fs.copyFile(realPath, destPath);
}

/**
 * Handle copying a regular file entry
 */
async function handleFile(
  srcPath: string,
  destPath: string,
  options: CopyOptions,
  fs: typeof import('node:fs/promises')
): Promise<void> {
  const destExists = await fileExists(destPath);
  if (destExists && !options.overwrite) {
    return;
  }

  await assertSafeFileDestination(destPath);
  await fs.copyFile(srcPath, destPath);

  if (options.preserveTimestamps) {
    const stats = await fs.stat(srcPath);
    await fs.utimes(destPath, stats.atime, stats.mtime);
  }
}

/**
 * Check if path should be skipped based on skipPaths option
 */
function shouldSkipPath(destPath: string, destRoot: string, skipPaths?: string[]): boolean {
  if (!skipPaths || skipPaths.length === 0) {
    return false;
  }

  const relativePath = relative(destRoot, destPath).replace(/\\/g, '/');

  for (const rawSkipPath of skipPaths) {
    const skipPath = rawSkipPath.replace(/\\/g, '/');
    // If skipPath ends with '/', it means skip entire directory
    if (skipPath.endsWith('/')) {
      const dirPath = skipPath.slice(0, -1);
      if (dirPath === '' || relativePath === dirPath || relativePath.startsWith(`${dirPath}/`)) {
        return true;
      }
    } else {
      // Exact file match
      if (relativePath === skipPath) {
        return true;
      }
    }
  }

  return false;
}

async function prevalidateCopyDirectoryPlan(
  src: string,
  dest: string,
  options: CopyOptions,
  destRoot: string
): Promise<void> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  await prevalidateSafeDirectoryPathMaybeRoot(dest, options.trustedWriteRoot);

  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    await prevalidateCopyDirectoryEntry(entry, srcPath, destPath, options, destRoot);
  }
}

async function shouldSkipCopyDirectoryEntry(
  entry: Dirent,
  destPath: string,
  destRoot: string,
  options: CopyOptions
): Promise<boolean> {
  if (shouldSkipEntry(entry.name, options)) return true;
  if (shouldSkipPath(destPath, destRoot, options.skipPaths)) return true;
  const canKeepExistingLeaf = !options.overwrite && (entry.isFile() || entry.isSymbolicLink());
  return canKeepExistingLeaf && (await fileExists(destPath));
}

async function prevalidateFollowedSymlinkDirectory(
  srcPath: string,
  destPath: string,
  options: CopyOptions,
  destRoot: string
): Promise<boolean> {
  if (options.preserveSymlinks !== false) return false;
  const fs = await import('node:fs/promises');
  const realPath = await fs.realpath(srcPath);
  const stats = await fs.stat(realPath);
  if (!stats.isDirectory()) return false;
  await prevalidateCopyDirectoryPlan(realPath, destPath, options, destRoot);
  return true;
}

async function prevalidateCopyDirectoryEntry(
  entry: Dirent,
  srcPath: string,
  destPath: string,
  options: CopyOptions,
  destRoot: string
): Promise<void> {
  if (await shouldSkipCopyDirectoryEntry(entry, destPath, destRoot, options)) return;
  if (entry.isDirectory()) {
    await prevalidateCopyDirectoryPlan(srcPath, destPath, options, destRoot);
    return;
  }
  if (
    entry.isSymbolicLink() &&
    (await prevalidateFollowedSymlinkDirectory(srcPath, destPath, options, destRoot))
  ) {
    return;
  }
  if (entry.isFile() || entry.isSymbolicLink()) {
    await prevalidateSafeWritePathMaybeRoot(destPath, options.trustedWriteRoot);
  }
}

export async function prevalidateCopyDirectory(
  src: string,
  dest: string,
  options: CopyOptions = {}
): Promise<void> {
  await prevalidateCopyDirectoryPlan(src, dest, options, dest);
}

/**
 * Copy a directory recursively
 */
export async function copyDirectory(
  src: string,
  dest: string,
  options: CopyOptions = {}
): Promise<void> {
  await prevalidateCopyDirectory(src, dest, options);
  return copyDirectoryInternal(src, dest, options, dest);
}

async function copyDirectoryInternal(
  src: string,
  dest: string,
  options: CopyOptions,
  destRoot: string
): Promise<void> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  await ensureSafeDirectoryForWrite(dest, options.trustedWriteRoot);

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldSkipEntry(entry.name, options)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Check if this path should be skipped
    if (shouldSkipPath(destPath, destRoot, options.skipPaths)) {
      continue;
    }

    if (entry.isSymbolicLink()) {
      await handleSymlink(srcPath, destPath, options, fs, destRoot);
    } else if (entry.isDirectory()) {
      await copyDirectoryInternal(srcPath, destPath, options, destRoot);
    } else if (entry.isFile()) {
      await handleFile(srcPath, destPath, options, fs);
    }
  }
}

/**
 * Read a JSON file and parse it
 */
export async function readJsonFile<T>(path: string): Promise<T> {
  const fs = await import('node:fs/promises');
  const content = await fs.readFile(path, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * Write data to a JSON file
 */
export async function writeJsonFile(
  path: string,
  data: unknown,
  options: SafeWriteOptions = {}
): Promise<void> {
  const fs = await import('node:fs/promises');
  const content = JSON.stringify(data, null, 2);
  await ensureSafeDirectoryForWrite(dirname(path), options.trustedWriteRoot);
  await assertSafeFileDestination(path);
  await fs.writeFile(path, content, 'utf-8');
}

/**
 * Read a text file
 */
export async function readTextFile(path: string): Promise<string> {
  const fs = await import('node:fs/promises');
  return fs.readFile(path, 'utf-8');
}

/**
 * Write a text file
 */
export async function writeTextFile(
  path: string,
  content: string,
  options: SafeWriteOptions = {}
): Promise<void> {
  const fs = await import('node:fs/promises');
  await ensureSafeDirectoryForWrite(dirname(path), options.trustedWriteRoot);
  await assertSafeFileDestination(path);
  await fs.writeFile(path, content, 'utf-8');
}

/**
 * Delete a file or directory
 */
export async function remove(path: string): Promise<void> {
  const fs = await import('node:fs/promises');
  const stat = await fs.stat(path);

  if (stat.isDirectory()) {
    await fs.rm(path, { recursive: true, force: true });
  } else {
    await fs.unlink(path);
  }
}

/**
 * Find the package root from a source or bundled module directory.
 *
 * Library and CLI bundles are emitted at different depths (`dist/` and
 * `dist/cli/`), so a fixed number of parent traversals cannot serve both.
 */
export function findPackageRoot(startDirectory: string): string {
  let candidate = resolve(startDirectory);

  while (true) {
    try {
      const packageJson = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (packageJson.name && PACKAGE_NAMES.has(packageJson.name)) {
        return candidate;
      }
    } catch {
      // Keep walking until the package metadata is found or the filesystem root is reached.
    }

    const parent = dirname(candidate);
    if (parent === candidate) {
      break;
    }
    candidate = parent;
  }

  throw new Error(`Could not locate the oh-my-customcodex package root from ${startDirectory}`);
}

/**
 * Get the package root directory.
 */
export function getPackageRoot(): string {
  return findPackageRoot(dirname(fileURLToPath(import.meta.url)));
}

/**
 * Resolve a path relative to the templates directory
 */
export function resolveTemplatePath(relativePath: string): string {
  const packageRoot = getPackageRoot();
  return join(packageRoot, 'templates', relativePath);
}

/**
 * List files in a directory
 */
export async function listFiles(
  dir: string,
  options: { recursive?: boolean; pattern?: string } = {}
): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const files: string[] = [];

  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory() && options.recursive) {
      const subFiles = await listFiles(fullPath, options);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      if (!options.pattern || matchesPattern(entry.name, options.pattern)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Get file stats
 */
export async function getFileStats(path: string): Promise<{
  size: number;
  created: Date;
  modified: Date;
  isDirectory: boolean;
  isFile: boolean;
}> {
  const fs = await import('node:fs/promises');
  const stats = await fs.stat(path);

  return {
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
  };
}

/**
 * Copy a single file
 */
export async function validateSafeWritePath(
  dest: string,
  trustedWriteRoot?: string
): Promise<void> {
  await ensureSafeDirectoryForWrite(dirname(dest), trustedWriteRoot);
  await assertSafeFileDestination(dest);
}

export async function prevalidateSafeWritePath(
  dest: string,
  trustedWriteRoot: string
): Promise<void> {
  const fs = await import('node:fs/promises');
  const resolved = resolve(dest);
  const boundary = await resolveTrustedWriteRoot(resolved, trustedWriteRoot);
  let current = boundary;

  for (const segment of relative(boundary, dirname(resolved)).split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Unsafe write path: symbolic link directory segment "${current}"`);
      }
      if (!stats.isDirectory()) {
        throw new Error(`Unsafe write path: parent segment is not a directory "${current}"`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }

  await assertSafeFileDestination(resolved);
}

async function prevalidateSafeWritePathMaybeRoot(
  dest: string,
  trustedWriteRoot?: string
): Promise<void> {
  if (trustedWriteRoot) {
    await prevalidateSafeWritePath(dest, trustedWriteRoot);
    return;
  }

  const fs = await import('node:fs/promises');
  const resolved = resolve(dest);
  const boundary = await findTrustedWriteBoundary(dirname(resolved));
  let current = boundary;

  for (const segment of relative(boundary, dirname(resolved)).split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Unsafe write path: symbolic link directory segment "${current}"`);
      }
      if (!stats.isDirectory()) {
        throw new Error(`Unsafe write path: parent segment is not a directory "${current}"`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }

  await assertSafeFileDestination(resolved);
}

async function prevalidateSafeDirectoryPathMaybeRoot(
  dir: string,
  trustedWriteRoot?: string
): Promise<void> {
  const fs = await import('node:fs/promises');
  const resolved = resolve(dir);
  const boundary = trustedWriteRoot
    ? await resolveTrustedWriteRoot(resolved, trustedWriteRoot)
    : await findTrustedWriteBoundary(resolved);
  let current = boundary;

  for (const segment of relative(boundary, resolved).split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Unsafe write path: symbolic link directory segment "${current}"`);
      }
      if (!stats.isDirectory()) {
        throw new Error(`Unsafe write path: parent segment is not a directory "${current}"`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }
}

export async function validateSafeDeleteFilePath(
  dest: string,
  trustedWriteRoot: string
): Promise<boolean> {
  const fs = await import('node:fs/promises');
  const resolved = resolve(dest);
  const boundary = await resolveTrustedWriteRoot(resolved, trustedWriteRoot);
  let current = boundary;

  for (const segment of relative(boundary, dirname(resolved)).split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Unsafe delete path: symbolic link directory segment "${current}"`);
      }
      if (!stats.isDirectory()) {
        throw new Error(`Unsafe delete path: parent segment is not a directory "${current}"`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  try {
    const stats = await fs.lstat(resolved);
    if (stats.isSymbolicLink()) {
      throw new Error(`Unsafe delete path: destination is a symbolic link "${resolved}"`);
    }
    if (!stats.isFile()) {
      throw new Error(`Unsafe delete path: destination is not a regular file "${resolved}"`);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function deleteFile(dest: string, trustedWriteRoot: string): Promise<boolean> {
  const fs = await import('node:fs/promises');
  const exists = await validateSafeDeleteFilePath(dest, trustedWriteRoot);
  if (!exists) return false;
  await fs.unlink(dest);
  return true;
}

export async function copyFile(
  src: string,
  dest: string,
  trustedWriteRoot?: string
): Promise<void> {
  const fs = await import('node:fs/promises');
  await validateSafeWritePath(dest, trustedWriteRoot);
  await fs.copyFile(src, dest);
}

/**
 * Move a file or directory
 */
export async function move(src: string, dest: string): Promise<void> {
  const fs = await import('node:fs/promises');
  await ensureDirectory(dirname(dest));
  await fs.rename(src, dest);
}

/**
 * Create a temporary directory
 */
export async function createTempDir(prefix = 'omcodex-'): Promise<string> {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');

  const tempBase = os.tmpdir();
  const tempDir = path.join(tempBase, `${prefix}${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  return tempDir;
}

/**
 * Calculate file checksum (MD5)
 */
export async function calculateChecksum(path: string): Promise<string> {
  const fs = await import('node:fs/promises');
  const crypto = await import('node:crypto');

  const content = await fs.readFile(path);
  const hash = crypto.createHash('md5');
  hash.update(content);

  return hash.digest('hex');
}

/**
 * Check if two files are identical
 */
export async function filesAreIdentical(path1: string, path2: string): Promise<boolean> {
  const [checksum1, checksum2] = await Promise.all([
    calculateChecksum(path1),
    calculateChecksum(path2),
  ]);

  return checksum1 === checksum2;
}

/**
 * Simple pattern matching (supports * wildcard)
 */
function matchesPattern(filename: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filename);
}

/**
 * Get relative path from base
 */
export function getRelativePath(basePath: string, fullPath: string): string {
  return relative(basePath, fullPath);
}

/**
 * Normalize path separators for cross-platform compatibility
 */
export function normalizePath(inputPath: string): string {
  return inputPath.replace(/\\/g, '/');
}

/**
 * Check if path is absolute
 */
export function isAbsolutePath(inputPath: string): boolean {
  return isAbsolute(inputPath);
}

/**
 * Resolve path relative to current working directory
 */
export function resolvePath(...paths: string[]): string {
  return resolve(...paths);
}
