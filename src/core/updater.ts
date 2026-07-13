/**
 * Updater module - Update agents from source
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import packageJson from '../../package.json';
import { i18n } from '../i18n/index.js';
import {
  copyDirectory,
  copyFile,
  deleteFile,
  ensureDirectory,
  fileExists,
  prevalidateCopyDirectory,
  prevalidateSafeWritePath,
  readJsonFile,
  readTextFile,
  resolveTemplatePath,
  validatePreserveFilePath,
  validateSafeDeleteFilePath,
  validateSafeWritePath,
  writeJsonFile,
  writeTextFile,
} from '../utils/fs.js';
import { debug, error, info, success, warn } from '../utils/logger.js';
import { prevalidateNativeAgentSync, syncNativeAgents } from './agent-compiler.js';
import { installNativeCodexHooks, prevalidateNativeCodexHooks } from './codex-hooks.js';
import { installCodex, isCodexInstalled } from './codex-installer.js';
import { getConfigCandidatePaths, loadConfig, type OmccConfig, saveConfig } from './config.js';
import { mergeEntryDoc, wrapInManagedMarkers } from './entry-merger.js';
import { isProtectedFile } from './file-preservation.js';
import { getProviderLayout, getTemplateComponentPath } from './layout.js';
import {
  generateLockfile,
  type Lockfile,
  type LockfileEntry,
  readLockfile,
  writeLockfile,
} from './lockfile.js';
import { assessOmxInstallation, installOmx, MINIMUM_OMX_VERSION } from './omx-installer.js';
import { installRtk, isRtkInstalled } from './rtk-installer.js';

/**
 * Options for update operation
 */
export interface UpdateOptions {
  /** Target directory to update */
  targetDir: string;
  /** Specific components to update (default: all) */
  components?: UpdateComponent[];
  /** Whether to force update even if no changes */
  force?: boolean;
  /** Whether to preserve user customizations */
  preserveCustomizations?: boolean;
  /** Force overwrite all files, bypassing all preservation mechanisms */
  forceOverwriteAll?: boolean;
  /** Dry run - show what would be updated without making changes */
  dryRun?: boolean;
  /** Whether to backup before updating */
  backup?: boolean;
  /** Sync frontmatter name: field from upstream in unmodified files */
  hard?: boolean;
}

/**
 * Components that can be updated
 */
export type UpdateComponent =
  | 'rules'
  | 'agents'
  | 'skills'
  | 'guides'
  | 'hooks'
  | 'contexts'
  | 'ontology';

/**
 * Result of update operation
 */
export interface UpdateResult {
  /** Whether update was successful */
  success: boolean;
  /** Components that were updated */
  updatedComponents: UpdateComponent[];
  /** Components that were skipped */
  skippedComponents: UpdateComponent[];
  /** Files that were preserved (user customizations) */
  preservedFiles: string[];
  /** Protected framework files preserved because they differ from their template baseline */
  protectedFiles?: string[];
  /** Backed up paths */
  backedUpPaths: string[];
  /** Previous version */
  previousVersion: string;
  /** New version */
  newVersion: string;
  /** Any warnings during update */
  warnings: string[];
  /** Root-level files that were synced */
  syncedRootFiles: string[];
  /** Deprecated files that were removed */
  removedDeprecatedFiles: string[];
  /** Files whose frontmatter name: was synced from upstream */
  namespaceSynced: string[];
  /** True when the target was skipped because it is the source project itself */
  skippedSource?: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Result of checking for updates
 */
export interface UpdateCheckResult {
  /** Whether updates are available */
  hasUpdates: boolean;
  /** Current installed version */
  currentVersion: string;
  /** Latest available version */
  latestVersion: string;
  /** Components with available updates */
  updatableComponents: {
    name: UpdateComponent;
    currentVersion: string;
    latestVersion: string;
    changesSummary?: string;
  }[];
  /** Last check timestamp */
  checkedAt: string;
}

interface UpdateTransactionFileStats {
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
}

interface UpdateTransactionFs {
  lstat(path: string): Promise<UpdateTransactionFileStats>;
  mkdir(path: string): Promise<unknown>;
  mkdtemp(prefix: string): Promise<string>;
  realpath(path: string): Promise<string>;
  rename(oldPath: string, newPath: string): Promise<unknown>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<unknown>;
  rmdir(path: string): Promise<unknown>;
  writeFile(path: string, content: string, encoding: 'utf-8'): Promise<unknown>;
}

export interface ApplyUpdatesDependencies {
  /** Injectable filesystem boundary for deterministic transaction-failure tests. */
  fs?: UpdateTransactionFs;
}

/**
 * Agent version information
 */
export interface AgentVersion {
  /** Agent name */
  name: string;
  /** Current version */
  version: string;
  /** Source (local or external URL) */
  source: string;
  /** Last updated timestamp */
  lastUpdated: string;
  /** Whether it has local modifications */
  hasLocalModifications: boolean;
}

/**
 * Component version tracking (reserved for future use)
 */
interface _ComponentVersions {
  [component: string]: {
    version: string;
    lastUpdated: string;
    checksum?: string;
  };
}

/**
 * User customization manifest
 */
interface CustomizationManifest {
  /** Files that have been modified by user */
  modifiedFiles: string[];
  /** Files that should be preserved during update */
  preserveFiles: string[];
  /** Custom agents/skills created by user */
  customComponents: string[];
  /** Last updated */
  lastUpdated: string;
}

const CUSTOMIZATION_MANIFEST_FILE = '.omcodex-customizations.json';
const LEGACY_CUSTOMIZATION_MANIFEST_FILE = '.omcustom-customizations.json';

/** Create initial update result */
function createUpdateResult(): UpdateResult {
  return {
    success: false,
    updatedComponents: [],
    skippedComponents: [],
    preservedFiles: [],
    protectedFiles: [],
    backedUpPaths: [],
    previousVersion: '',
    newVersion: '',
    warnings: [],
    syncedRootFiles: [],
    removedDeprecatedFiles: [],
    namespaceSynced: [],
  };
}

/** Handle backup if requested */
async function handleBackupIfRequested(
  targetDir: string,
  backup: boolean,
  result: UpdateResult
): Promise<void> {
  if (!backup) return;
  const backupPath = await backupInstallation(targetDir);
  result.backedUpPaths.push(backupPath);
  info('update.backup_created', { path: backupPath });
}

/** Process a single component update */
async function processComponentUpdate(
  targetDir: string,
  component: UpdateComponent,
  updateCheck: UpdateCheckResult,
  customizations: CustomizationManifest | null,
  options: UpdateOptions,
  result: UpdateResult,
  config: OmccConfig,
  lockfile: Lockfile | null
): Promise<void> {
  const componentUpdate = updateCheck.updatableComponents.find((c) => c.name === component);

  if (!componentUpdate && !options.force) {
    result.skippedComponents.push(component);
    return;
  }

  if (options.dryRun) {
    debug('update.dry_run', { component });
    result.updatedComponents.push(component);
    return;
  }

  try {
    const preserved = await updateComponent(
      targetDir,
      component,
      customizations,
      options,
      config,
      lockfile
    );
    result.updatedComponents.push(component);
    result.preservedFiles.push(...preserved.customizations);
    result.protectedFiles?.push(...preserved.protected);

    if (options.hard) {
      const synced = await applyNamespaceSync(targetDir, component, lockfile);
      result.namespaceSynced.push(...synced);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failure = `Failed to update ${component}: ${message}`;
    result.warnings.push(failure);
    result.error ??= failure;
    result.skippedComponents.push(component);
  }
}

/** Update all components */
async function updateAllComponents(
  targetDir: string,
  components: UpdateComponent[],
  updateCheck: UpdateCheckResult,
  customizations: CustomizationManifest | null,
  options: UpdateOptions,
  result: UpdateResult,
  config: OmccConfig,
  lockfile: Lockfile | null
): Promise<void> {
  for (const component of components) {
    await processComponentUpdate(
      targetDir,
      component,
      updateCheck,
      customizations,
      options,
      result,
      config,
      lockfile
    );
  }
}

/**
 * Get entry template name based on language
 */
function getEntryTemplateName(language: 'en' | 'ko'): string {
  const layout = getProviderLayout();
  const baseName = layout.entryTemplatePrefix.replace('.md', '');
  return language === 'ko' ? `${baseName}.md.ko` : `${baseName}.md.en`;
}

/**
 * Backup a file before overwriting it
 */
async function backupFile(filePath: string, trustedWriteRoot: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup-${timestamp}`;

  if (await fileExists(filePath)) {
    await copyFile(filePath, backupPath, trustedWriteRoot);
    debug('update.file_backed_up', { path: filePath, backup: backupPath });
  }
}

/**
 * Resolve manifest customizations based on options
 */
async function resolveManifestCustomizations(
  options: UpdateOptions,
  targetDir: string
): Promise<CustomizationManifest | null> {
  // When forceOverwriteAll is true, skip ALL preservation mechanisms
  if (options.forceOverwriteAll) {
    return null;
  }

  // When preserveCustomizations is false, skip manifest-based preservation
  if (options.preserveCustomizations === false) {
    return null;
  }

  // Load customization manifest
  return loadCustomizationManifest(targetDir);
}

/**
 * Resolve config preserve files based on options
 */
function resolveConfigPreserveFiles(options: UpdateOptions, config: OmccConfig): string[] {
  // When forceOverwriteAll is true, skip config-based preservation
  if (options.forceOverwriteAll) {
    return [];
  }

  const preserveFiles = config.preserveFiles || [];

  // Paths are already validated by mergeConfig (called with targetDir during loadConfig)
  const validatedPaths: string[] = [];
  for (const filePath of preserveFiles) {
    validatedPaths.push(filePath);
  }

  return validatedPaths;
}

/**
 * Resolve customizations from manifest and config
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Security validation adds necessary complexity
function resolveCustomizations(
  customizations: CustomizationManifest | null,
  configPreserveFiles: string[],
  targetDir: string
): CustomizationManifest | null {
  // Validate manifest preserveFiles
  const validatedManifestFiles: string[] = [];
  if (customizations && customizations.preserveFiles.length > 0) {
    for (const filePath of customizations.preserveFiles) {
      const validation = validatePreserveFilePath(filePath, targetDir);
      if (validation.valid) {
        validatedManifestFiles.push(filePath);
      } else {
        warn('preserve_files.invalid_path', {
          path: filePath,
          reason: validation.reason ?? 'Invalid path',
          source: 'manifest',
        });
      }
    }
  }

  // No preserve files from either source after validation
  if (validatedManifestFiles.length === 0 && configPreserveFiles.length === 0) {
    return customizations && customizations.modifiedFiles.length > 0 ? customizations : null;
  }

  // Merge both sources
  if (validatedManifestFiles.length > 0 && configPreserveFiles.length > 0) {
    const merged = customizations || {
      modifiedFiles: [],
      preserveFiles: [],
      customComponents: [],
      lastUpdated: new Date().toISOString(),
    };
    merged.preserveFiles = [...new Set([...validatedManifestFiles, ...configPreserveFiles])];
    return merged;
  }

  // Only config has preserve files
  if (configPreserveFiles.length > 0) {
    return {
      modifiedFiles: customizations?.modifiedFiles || [],
      preserveFiles: configPreserveFiles,
      customComponents: customizations?.customComponents || [],
      lastUpdated: new Date().toISOString(),
    };
  }

  // Only manifest has preserve files.
  // customizations is guaranteed non-null here: validatedManifestFiles.length > 0
  // only when customizations was truthy in the population loop above.
  // biome-ignore lint/style/noNonNullAssertion: logically guaranteed non-null (see comment)
  customizations!.preserveFiles = validatedManifestFiles;
  return customizations;
}

/**
 * Update entry document with merge support
 */
async function updateEntryDoc(
  targetDir: string,
  config: OmccConfig,
  options: UpdateOptions
): Promise<void> {
  const layout = getProviderLayout();
  const entryPath = join(targetDir, layout.entryFile);
  const templateName = getEntryTemplateName(config.language);
  const templatePath = resolveTemplatePath(templateName);

  await validateSafeWritePath(entryPath, targetDir);

  if (!(await fileExists(templatePath))) {
    warn('update.entry_template_not_found', { template: templateName });
    return;
  }

  const templateContent = await readTextFile(templatePath);

  if (await fileExists(entryPath)) {
    if (options.force) {
      // Force: overwrite with backup
      await backupFile(entryPath, targetDir);
      await writeTextFile(entryPath, templateContent, { trustedWriteRoot: targetDir });
      info('update.entry_doc_force_updated', { path: layout.entryFile });
    } else {
      // Merge: preserve custom sections
      const existingContent = await readTextFile(entryPath);
      const mergeResult = mergeEntryDoc(existingContent, templateContent);

      await writeTextFile(entryPath, mergeResult.content, { trustedWriteRoot: targetDir });

      debug('update.entry_doc_merged', {
        path: layout.entryFile,
        managed: String(mergeResult.managedSections),
        custom: String(mergeResult.customSections),
      });

      if (mergeResult.warnings.length > 0) {
        for (const warning of mergeResult.warnings) {
          warn('update.entry_merge_warning', { warning });
        }
      }
    }
  } else {
    // New file: wrap in markers
    await writeTextFile(entryPath, wrapInManagedMarkers(templateContent), {
      trustedWriteRoot: targetDir,
    });
    info('update.entry_doc_created', { path: layout.entryFile });
  }
}

/**
 * Handle full-update-only post-processing steps and log success
 */
async function runFullUpdatePostProcessing(
  options: UpdateOptions,
  result: UpdateResult,
  config: OmccConfig
): Promise<void> {
  const isFullUpdate = !options.components || options.components.length === 0;

  if (isFullUpdate) {
    const synced = await syncRootLevelFiles(options.targetDir, options);
    result.syncedRootFiles = synced;

    const removed = await removeDeprecatedFiles(options.targetDir, options);
    result.removedDeprecatedFiles = removed;

    if (!options.dryRun) {
      await ensureStatusLineConfig(options.targetDir);
      await updateEntryDoc(options.targetDir, config, options);
    }
  }

  if (!options.dryRun) {
    config.version = result.newVersion;
    config.lastUpdated = new Date().toISOString();
    await saveConfig(options.targetDir, config, { trustedWriteRoot: options.targetDir });
  }

  result.success = true;

  if (result.previousVersion !== result.newVersion) {
    success('update.success', { from: result.previousVersion, to: result.newVersion });
  } else if (result.updatedComponents.length > 0) {
    success('update.components_synced', {
      version: result.newVersion,
      components: result.updatedComponents.join(', '),
    });
  }
}

/**
 * Backfill statusLine settings for installations created before
 * refreshInterval was added. Preserve custom commands and padding.
 */
async function ensureStatusLineConfig(targetDir: string): Promise<void> {
  const layout = getProviderLayout();
  const settingsPath = join(targetDir, layout.rootDir, 'settings.local.json');
  const statusLineConfig = {
    type: 'command' as const,
    command: `${layout.rootDir}/statusline.sh`,
    padding: 0,
    refreshInterval: 10,
  };

  await validateSafeWritePath(settingsPath, targetDir);

  if (!(await fileExists(settingsPath))) {
    await writeJsonFile(
      settingsPath,
      { statusLine: statusLineConfig },
      { trustedWriteRoot: targetDir }
    );
    return;
  }

  const settings = await readJsonFile<Record<string, unknown>>(settingsPath);
  const statusLine = settings.statusLine;

  if (!statusLine || typeof statusLine !== 'object' || Array.isArray(statusLine)) {
    settings.statusLine = statusLineConfig;
    await writeJsonFile(settingsPath, settings, { trustedWriteRoot: targetDir });
    return;
  }

  const mergedStatusLine = statusLine as Record<string, unknown>;
  if (mergedStatusLine.refreshInterval === undefined) {
    mergedStatusLine.refreshInterval = statusLineConfig.refreshInterval;
    settings.statusLine = mergedStatusLine;
    await writeJsonFile(settingsPath, settings, { trustedWriteRoot: targetDir });
  }
}

/**
 * Compare two semver strings numerically.
 * Returns a positive number if a > b, negative if a < b, 0 if equal.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Check if RTK is installed after an update and install it if missing
 */
function checkAndInstallRtkAfterUpdate(): void {
  if (!isRtkInstalled()) {
    warn('update.rtk_missing');
    console.log(i18n.t('cli.update.rtkMissing'));
    const rtkInstalled = installRtk();
    if (rtkInstalled) {
      console.log(i18n.t('cli.update.rtkInstalled'));
    }
  }
}

/**
 * Update the project registry with the new version after a successful update.
 * Non-blocking — registry update is informational only.
 */
async function updateProjectRegistry(targetDir: string, newVersion: string): Promise<void> {
  try {
    const { registerProject } = await import('./registry.js');
    await registerProject(targetDir, newVersion);
  } catch {
    // Registry update is informational only — never block the update result
  }
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizePreservedPath(filePath: string): { path: string; isDirectory: boolean } {
  const normalized = normalizeProjectPath(filePath);
  return {
    path: normalized.replace(/\/+$/, ''),
    isDirectory: normalized.endsWith('/'),
  };
}

function isSameOrDescendantPath(relativePath: string, candidateParent: string): boolean {
  const normalizedPath = normalizeProjectPath(relativePath).replace(/\/+$/, '');
  const normalizedParent = normalizeProjectPath(candidateParent).replace(/\/+$/, '');
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
}

function isPathPreserved(relativePath: string, preservedPaths: string[]): boolean {
  const normalizedRelative = normalizeProjectPath(relativePath).replace(/\/+$/, '');
  return preservedPaths.some((preservedPath) => {
    const preserved = normalizePreservedPath(preservedPath);
    if (preserved.isDirectory) {
      return isSameOrDescendantPath(normalizedRelative, preserved.path);
    }
    return normalizedRelative === preserved.path;
  });
}

function resolveTemplateBaselineSource(
  relativePath: string
): { component: UpdateComponent; sourcePath: string } | null {
  const normalized = relativePath.replace(/\\/g, '/');
  for (const component of getAllUpdateComponents()) {
    const componentPath = getComponentPath(component).replace(/\\/g, '/');
    if (!normalized.startsWith(`${componentPath}/`)) continue;
    const suffix = normalized.slice(componentPath.length + 1);
    return {
      component,
      sourcePath: join(
        resolveTemplatePath(getTemplateComponentPath(component)),
        ...suffix.split('/')
      ),
    };
  }
  return null;
}

async function computeSafetyHash(filePath: string): Promise<string> {
  const fs = await import('node:fs/promises');
  return createHash('sha256')
    .update(await fs.readFile(filePath))
    .digest('hex');
}

async function createTemplateBaseline(relativePath: string): Promise<LockfileEntry | null> {
  const source = resolveTemplateBaselineSource(relativePath);
  if (!source || !(await fileExists(source.sourcePath))) return null;

  const fs = await import('node:fs/promises');
  const stats = await fs.stat(source.sourcePath);
  if (!stats.isFile()) return null;
  return {
    templateHash: await computeSafetyHash(source.sourcePath),
    size: stats.size,
    component: source.component,
  };
}

async function mergeGeneratedLockfileEntry(
  generated: Lockfile,
  relativePath: string,
  entry: LockfileEntry,
  previousFiles: Lockfile['files'],
  updatedComponents: Set<string>,
  preservedPaths: string[]
): Promise<void> {
  const previousEntry = previousFiles[relativePath];
  if (!updatedComponents.has(entry.component)) {
    if (previousEntry) generated.files[relativePath] = previousEntry;
    else delete generated.files[relativePath];
    return;
  }

  if (!isPathPreserved(relativePath, preservedPaths)) return;
  const baseline = previousEntry ?? (await createTemplateBaseline(relativePath));
  if (baseline) generated.files[relativePath] = baseline;
  else delete generated.files[relativePath];
}

function restoreRequiredPreviousEntries(
  generated: Lockfile,
  previousFiles: Lockfile['files'],
  updatedComponents: Set<string>,
  preservedPaths: string[]
): void {
  for (const [relativePath, previousEntry] of Object.entries(previousFiles)) {
    if (
      !updatedComponents.has(previousEntry.component) ||
      isPathPreserved(relativePath, preservedPaths)
    ) {
      generated.files[relativePath] = previousEntry;
    }
  }
}

async function mergeGeneratedLockfileBaselines(
  generated: Lockfile,
  result: UpdateResult,
  previousLockfile: Lockfile | null
): Promise<Lockfile> {
  const updatedComponents = new Set<string>(result.updatedComponents);
  const preservedPaths = [...result.preservedFiles, ...(result.protectedFiles ?? [])].map((path) =>
    path.replace(/\\/g, '/')
  );
  const previousFiles = previousLockfile?.files ?? {};

  for (const [relativePath, entry] of Object.entries(generated.files)) {
    await mergeGeneratedLockfileEntry(
      generated,
      relativePath,
      entry,
      previousFiles,
      updatedComponents,
      preservedPaths
    );
  }

  restoreRequiredPreviousEntries(generated, previousFiles, updatedComponents, preservedPaths);
  return generated;
}

/**
 * Regenerate and log the lockfile result after a successful update.
 * Extracted to reduce cognitive complexity of update().
 */
async function regenerateLockfile(
  targetDir: string,
  result: UpdateResult,
  previousLockfile: Lockfile | null
): Promise<void> {
  try {
    const generated = await generateLockfile(
      targetDir,
      packageJson.version as string,
      result.newVersion
    );
    const merged = await mergeGeneratedLockfileBaselines(generated, result, previousLockfile);
    await writeLockfile(targetDir, merged, { trustedWriteRoot: targetDir });
    debug('update.lockfile_regenerated', {
      files: String(Object.keys(merged.files).length),
    });
  } catch (error) {
    const warning = `Lockfile generation failed: ${error instanceof Error ? error.message : String(error)}`;
    result.warnings.push(warning);
    warn('update.lockfile_failed', { error: warning });
  }
}

/**
 * Guard against updating the current source project itself.
 * Returns true if the update should be skipped.
 */
async function shouldSkipSelfUpdate(targetDir: string, result: UpdateResult): Promise<boolean> {
  const targetPkgPath = join(targetDir, 'package.json');
  if (await fileExists(targetPkgPath)) {
    const targetPkg = await readJsonFile<{ name?: string }>(targetPkgPath);
    if (targetPkg.name === packageJson.name) {
      warn('update.self_update_skipped');
      result.success = true;
      result.skippedSource = true;
      result.warnings.push('Skipped: source project cannot update itself');
      return true;
    }
  }
  return false;
}

/**
 * Check if Codex CLI is installed after an update and install it if missing
 */
function checkAndInstallCodexAfterUpdate(): void {
  if (!isCodexInstalled()) {
    warn('update.codex_missing');
    console.log(i18n.t('cli.update.codexMissing'));
    const codexInstalled = installCodex();
    if (codexInstalled) {
      console.log(i18n.t('cli.update.codexInstalled'));
    }
  }
}

/**
 * Check if OMX CLI is installed after an update and install it if missing
 */
function checkAndInstallOmxAfterUpdate(): void {
  const omx = assessOmxInstallation();

  if (omx.status !== 'ready') {
    warn('update.omx_missing');
    if (omx.status === 'missing') {
      console.log(i18n.t('cli.update.omxMissing'));
    } else {
      const versionDetail = omx.version ? ` (${omx.version})` : '';
      console.log(
        `OMX${versionDetail} does not meet the oh-my-codex v${MINIMUM_OMX_VERSION} baseline. Attempting upgrade...`
      );
    }
    const omxInstalled = installOmx();
    if (omxInstalled) {
      console.log(i18n.t('cli.update.omxInstalled'));
    }
  }
}

async function handleNoUpdateResult(options: UpdateOptions, result: UpdateResult): Promise<void> {
  const isFullUpdate = !options.components || options.components.length === 0;
  if (isFullUpdate && !options.dryRun) {
    await ensureStatusLineConfig(options.targetDir);
  }
  info('update.no_updates');
  result.success = true;
  result.skippedComponents = options.components || getAllUpdateComponents();
}

function preventDowngradeIfNeeded(result: UpdateResult): boolean {
  const cliVersion = packageJson.version as string;
  if (
    result.previousVersion === '0.0.0' ||
    compareSemver(result.previousVersion, cliVersion) <= 0
  ) {
    return false;
  }

  result.success = false;
  result.error = `Downgrade prevented: project has v${result.previousVersion} but CLI is v${cliVersion}. Update the CLI first: npm install -g ${packageJson.name}@latest`;
  return true;
}

async function handleComponentUpdateFailure(
  options: UpdateOptions,
  result: UpdateResult,
  lockfile: Lockfile | null
): Promise<boolean> {
  if (!result.error) {
    return false;
  }
  if (!options.dryRun && result.updatedComponents.length > 0) {
    await regenerateLockfile(options.targetDir, result, lockfile);
  }
  return true;
}

async function prevalidateUpdateWritePlan(
  options: UpdateOptions,
  components: UpdateComponent[],
  isFullUpdate: boolean
): Promise<void> {
  if (options.dryRun) return;

  await validateUpdateFinalizationTargets(options.targetDir);
  await validateUpdateComponentTargets(options.targetDir, components);
  if (isFullUpdate) {
    await validateFullUpdateTargets(options.targetDir);
    await prevalidateDeprecatedFileTargets(options.targetDir);
  }
  if (options.backup) {
    await validateBackupSourceRoots(options.targetDir);
  }
}

async function handleNoUpdateAfterCheck(
  options: UpdateOptions,
  result: UpdateResult,
  config: OmccConfig,
  isFullUpdate: boolean
): Promise<void> {
  if (!options.dryRun) {
    await prevalidateSafeWritePath(join(options.targetDir, '.omcodexrc.json'), options.targetDir);
    if (isFullUpdate) {
      const layout = getProviderLayout();
      await prevalidateSafeWritePath(
        join(options.targetDir, layout.rootDir, 'settings.local.json'),
        options.targetDir
      );
    }
  }
  await persistConfigMigrationIfNeeded(options.targetDir, config, !!options.dryRun);
  await handleNoUpdateResult(options, result);
}

function getPlannedUpdateComponents(
  components: UpdateComponent[],
  updateCheck: UpdateCheckResult,
  force?: boolean
): UpdateComponent[] {
  return components.filter(
    (component) =>
      force || updateCheck.updatableComponents.some((update) => update.name === component)
  );
}

/**
 * Update the current installation
 */
export async function update(options: UpdateOptions): Promise<UpdateResult> {
  const result = createUpdateResult();

  try {
    info('update.start', { targetDir: options.targetDir });

    const config = await loadConfig(options.targetDir, {
      persistMigrations: false,
    });
    result.previousVersion = config.version;

    // Guard against version downgrade (#579).
    // If the project's installed version is newer than this CLI's own version,
    // an outdated CLI binary is running. Abort to prevent a downgrade.
    if (preventDowngradeIfNeeded(result)) {
      return result;
    }

    if (await shouldSkipSelfUpdate(options.targetDir, result)) {
      return result;
    }

    const updateCheck = await checkForUpdates(options.targetDir, {
      persistMigrations: false,
    });
    result.newVersion = updateCheck.latestVersion;

    const isFullUpdate = !options.components || options.components.length === 0;
    const components = options.components || getAllUpdateComponents();

    if (!updateCheck.hasUpdates && !options.force) {
      await handleNoUpdateAfterCheck(options, result, config, isFullUpdate);
      return result;
    }

    const plannedComponents = getPlannedUpdateComponents(components, updateCheck, options.force);
    await prevalidateUpdateWritePlan(options, plannedComponents, isFullUpdate);

    // Load preservation config from BOTH sources
    const manifestCustomizations = await resolveManifestCustomizations(options, options.targetDir);
    const configPreserveFiles = resolveConfigPreserveFiles(options, config);
    const customizations = resolveCustomizations(
      manifestCustomizations,
      configPreserveFiles,
      options.targetDir
    );

    // Read lockfile for smart protected file handling
    const lockfile = await readLockfile(options.targetDir);

    if (!options.dryRun) {
      await handleBackupIfRequested(options.targetDir, !!options.backup, result);
    }

    // Update all components
    await updateAllComponents(
      options.targetDir,
      components,
      updateCheck,
      customizations,
      options,
      result,
      config,
      lockfile
    );

    if (await handleComponentUpdateFailure(options, result, lockfile)) {
      return result;
    }

    await runFullUpdatePostProcessing(options, result, config);

    if (!options.dryRun) {
      // Regenerate lockfile after successful update (#316)
      await regenerateLockfile(options.targetDir, result, lockfile);

      // Runtime installation checks may install or upgrade dependencies.
      checkAndInstallRtkAfterUpdate();
      checkAndInstallCodexAfterUpdate();
      checkAndInstallOmxAfterUpdate();
    }

    // Update project registry with new version (non-blocking)
    if (result.success && !options.dryRun) {
      await updateProjectRegistry(options.targetDir, result.newVersion);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = message;
    error('update.failed', { error: message });
  }

  return result;
}

/**
 * Check for available updates
 */
export async function checkForUpdates(
  targetDir: string,
  options: { persistMigrations?: boolean } = {}
): Promise<UpdateCheckResult> {
  const config = await loadConfig(targetDir, options);
  const currentVersion = config.version;

  // Get latest version from templates
  const latestVersion = await getLatestVersion();

  // Check each component for updates
  const updatableComponents: UpdateCheckResult['updatableComponents'] = [];

  for (const component of getAllUpdateComponents()) {
    const hasUpdate = await componentHasUpdate(targetDir, component, config);
    if (hasUpdate) {
      updatableComponents.push({
        name: component,
        currentVersion: config.componentVersions?.[component] || '0.0.0',
        latestVersion,
      });
    }
  }

  return {
    hasUpdates: updatableComponents.length > 0 || currentVersion !== latestVersion,
    currentVersion,
    latestVersion,
    updatableComponents,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Apply updates to specific files
 */
export async function applyUpdates(
  targetDir: string,
  updates: { path: string; content: string }[],
  dependencies: ApplyUpdatesDependencies = {}
): Promise<void> {
  const fs = dependencies.fs ?? (await import('node:fs/promises'));
  const canonicalRoot = await fs.realpath(targetDir);

  const validated = await Promise.all(
    updates.map(async (update) => ({
      ...update,
      fullPath: await resolveSafeProjectPath(canonicalRoot, update.path, fs),
    }))
  );
  validateUpdatePlanPaths(validated.map((update) => update.fullPath));
  if (validated.length === 0) return;

  const stageDir = await fs.mkdtemp(join(canonicalRoot, '.omcodex-update-stage-'));
  const prepared = validated.map((update, index) => ({
    ...update,
    stagedPath: join(stageDir, `${index}.staged`),
    backupPath: join(stageDir, `${index}.backup`),
    backupCreated: false,
    committed: false,
  }));
  const createdDirectories = new Set<string>();

  try {
    for (const update of prepared) {
      await fs.writeFile(update.stagedPath, update.content, 'utf-8');
    }
    await commitPreparedUpdates(canonicalRoot, prepared, createdDirectories, fs);
    for (const update of prepared) {
      debug('update.file_applied', { path: update.path });
    }
  } catch (commitError) {
    const rollbackErrors = await rollbackPreparedUpdates(prepared, createdDirectories, fs);
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [commitError, ...rollbackErrors],
        'Update transaction failed and rollback was incomplete'
      );
    }
    throw commitError;
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
  }
}

interface PreparedFileUpdate {
  path: string;
  content: string;
  fullPath: string;
  stagedPath: string;
  backupPath: string;
  backupCreated: boolean;
  committed: boolean;
}

function assertSafeDirectory(stats: UpdateTransactionFileStats, directory: string): void {
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Unsafe update target parent: "${directory}"`);
  }
}

async function createDirectoryOrValidateRace(
  directory: string,
  createdDirectories: Set<string>,
  fs: UpdateTransactionFs
): Promise<void> {
  try {
    await fs.mkdir(directory);
    createdDirectories.add(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    assertSafeDirectory(await fs.lstat(directory), directory);
  }
}

async function ensureSafeDirectorySegment(
  directory: string,
  createdDirectories: Set<string>,
  fs: UpdateTransactionFs
): Promise<void> {
  try {
    assertSafeDirectory(await fs.lstat(directory), directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await createDirectoryOrValidateRace(directory, createdDirectories, fs);
  }
}

async function ensureSafeParentDirectories(
  canonicalRoot: string,
  fullPath: string,
  createdDirectories: Set<string>,
  fs: UpdateTransactionFs
): Promise<void> {
  const path = await import('node:path');
  const parentPath = path.dirname(fullPath);
  const relativeParent = path.relative(canonicalRoot, parentPath);
  if (relativeParent.startsWith('..') || path.isAbsolute(relativeParent)) {
    throw new Error(`Invalid update target parent outside project root: "${parentPath}"`);
  }

  let current = canonicalRoot;
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    await ensureSafeDirectorySegment(current, createdDirectories, fs);
  }
}

async function commitPreparedUpdates(
  canonicalRoot: string,
  updates: PreparedFileUpdate[],
  createdDirectories: Set<string>,
  fs: UpdateTransactionFs
): Promise<void> {
  for (const update of updates) {
    await ensureSafeParentDirectories(canonicalRoot, update.fullPath, createdDirectories, fs);
    const revalidated = await resolveSafeProjectPath(canonicalRoot, update.path, fs);
    if (revalidated !== update.fullPath) {
      throw new Error(`Update target changed during commit: "${update.path}"`);
    }

    try {
      const existing = await fs.lstat(update.fullPath);
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new Error(`Unsafe update target: "${update.path}"`);
      }
      await fs.rename(update.fullPath, update.backupPath);
      update.backupCreated = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    // Node has no portable openat()/renameat() API. Revalidate immediately before
    // rename to minimize the remaining parent-swap race, then rely on rollback for
    // ordinary I/O failures. A hostile nanosecond-scale swap cannot be eliminated.
    const commitTarget = await resolveSafeProjectPath(canonicalRoot, update.path, fs);
    if (commitTarget !== update.fullPath) {
      throw new Error(`Update target changed during commit: "${update.path}"`);
    }
    await fs.rename(update.stagedPath, update.fullPath);
    update.committed = true;
  }
}

async function rollbackPreparedUpdates(
  updates: PreparedFileUpdate[],
  createdDirectories: Set<string>,
  fs: UpdateTransactionFs
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const update of [...updates].reverse()) {
    try {
      if (update.committed) {
        await fs.rm(update.fullPath, { force: true });
      }
      if (update.backupCreated) {
        await fs.rename(update.backupPath, update.fullPath);
      }
    } catch (error) {
      errors.push(error);
    }
  }

  for (const directory of [...createdDirectories].sort((a, b) => b.length - a.length)) {
    try {
      await fs.rmdir(directory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOTEMPTY' && code !== 'ENOENT') errors.push(error);
    }
  }
  return errors;
}

/**
 * Preserve user customizations during update
 */
export async function preserveCustomizations(
  targetDir: string,
  customizations: string[]
): Promise<Map<string, string>> {
  const preserved = new Map<string, string>();
  const fs = await import('node:fs/promises');

  const validated = await Promise.all(
    customizations.map(async (filePath) => ({
      filePath,
      fullPath: await resolveSafeProjectPath(targetDir, filePath),
    }))
  );

  for (const { filePath, fullPath } of validated) {
    if (await fileExists(fullPath)) {
      const content = await fs.readFile(fullPath, 'utf-8');
      preserved.set(filePath, content);
    }
  }

  return preserved;
}

function assertSafePathSegmentStats(
  stats: UpdateTransactionFileStats,
  isLast: boolean,
  filePath: string
): void {
  if (stats.isSymbolicLink()) {
    throw new Error(`Invalid project path "${filePath}": symbolic links are not allowed`);
  }
  if (isLast && stats.isDirectory()) {
    throw new Error(`Invalid project path "${filePath}": path identifies a directory`);
  }
  if (isLast && !stats.isFile()) {
    throw new Error(`Invalid project path "${filePath}": path is not a regular file`);
  }
  if (!isLast && !stats.isDirectory()) {
    throw new Error(`Invalid project path "${filePath}": parent path is not a directory`);
  }
}

async function assertSafeExistingPathSegments(
  targetDir: string,
  relativePath: string,
  filePath: string,
  fs: Pick<UpdateTransactionFs, 'lstat'>
): Promise<void> {
  const path = await import('node:path');
  const segments = relativePath.split(path.sep);
  let current = targetDir;

  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    try {
      const stats = await fs.lstat(current);
      const isLast = index === segments.length - 1;
      assertSafePathSegmentStats(stats, isLast, filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

/** Resolve a caller-provided project-relative path without crossing symlinks. */
async function resolveSafeProjectPath(
  targetDir: string,
  filePath: string,
  fileSystem?: Pick<UpdateTransactionFs, 'lstat' | 'realpath'>
): Promise<string> {
  const fs = fileSystem ?? (await import('node:fs/promises'));
  const canonicalRoot = await fs.realpath(targetDir);
  const validation = validatePreserveFilePath(filePath, targetDir);
  if (!validation.valid) {
    throw new Error(`Invalid project path "${filePath}": ${validation.reason}`);
  }

  const path = await import('node:path');
  const resolvedPath = path.resolve(canonicalRoot, filePath);
  const relativePath = path.relative(canonicalRoot, resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid project path "${filePath}": path escapes canonical project root`);
  }
  if (!relativePath || relativePath === '.') {
    throw new Error(`Invalid project path "${filePath}": path must identify a file`);
  }
  await assertSafeExistingPathSegments(canonicalRoot, relativePath, filePath, fs);
  return resolvedPath;
}

function validateUpdatePlanPaths(paths: string[]): void {
  const pathSeparator = process.platform === 'win32' ? '\\' : '/';
  for (const [index, current] of paths.entries()) {
    for (const candidate of paths.slice(index + 1)) {
      if (candidate === current) {
        throw new Error(`Invalid update plan: duplicate target "${current}"`);
      }
      if (
        candidate.startsWith(`${current}${pathSeparator}`) ||
        current.startsWith(`${candidate}${pathSeparator}`)
      ) {
        throw new Error(
          `Invalid update plan: parent-child target conflict between "${current}" and "${candidate}"`
        );
      }
    }
  }
}

/**
 * Get all update components
 */
function getAllUpdateComponents(): UpdateComponent[] {
  return ['rules', 'agents', 'skills', 'guides', 'hooks', 'contexts', 'ontology'];
}

/**
 * Get the latest version from package templates
 */
async function getLatestVersion(): Promise<string> {
  const layout = getProviderLayout();
  const manifestPath = resolveTemplatePath(layout.manifestFile);
  if (await fileExists(manifestPath)) {
    const manifest = await readJsonFile<{ version: string }>(manifestPath);
    return manifest.version;
  }
  return '0.0.0';
}

/**
 * Check if a component has updates available
 */
async function componentHasUpdate(
  _targetDir: string,
  component: UpdateComponent,
  config: OmccConfig
): Promise<boolean> {
  const installedVersion = config.componentVersions?.[component];
  if (!installedVersion) {
    return true; // Not installed, so update available
  }

  // Simple version comparison (could be enhanced with semver)
  const latestVersion = await getLatestVersion();
  return installedVersion !== latestVersion;
}

/**
 * Determine if a protected file should be skipped during update.
 * Uses lockfile hash comparison to detect user modifications.
 * Unmodified protected files are safe to update from templates.
 *
 * Decision table:
 *   - Target file missing    → allow update
 *   - Hash matches lockfile  → file unmodified by user → allow update
 *   - No baseline entry      → compare with current source template
 *   - Hash differs           → user modified the file → preserve
 */
async function shouldSkipProtectedFile(
  sourceFilePath: string,
  targetFilePath: string,
  lockfileKey: string,
  lockfile: Lockfile | null
): Promise<boolean> {
  // Target file doesn't exist → allow update
  if (!(await fileExists(targetFilePath))) {
    return false;
  }

  // Compare target file hash with lockfile hash
  try {
    const currentHash = await computeSafetyHash(targetFilePath);
    const baselineHash = lockfile?.files[lockfileKey]?.templateHash;
    if (!baselineHash) {
      if (!(await fileExists(sourceFilePath))) return true;
      return currentHash !== (await computeSafetyHash(sourceFilePath));
    }
    // Hash matches → file is unmodified by user → safe to update
    // Hash differs → user modified the file → preserve
    return currentHash !== baselineHash;
  } catch {
    // If hash computation fails, preserve (safe default)
    return true;
  }
}

/**
 * Collect the protected file paths within a component's source directory.
 * Uses lockfile to distinguish user-modified files (skip) from unmodified ones (update).
 * Returns paths normalized relative to destPath for use with skipPaths.
 */
async function collectProtectedSkipPaths(
  srcPath: string,
  destPath: string,
  componentPath: string,
  forceOverwriteAll: boolean,
  lockfile: Lockfile | null,
  targetDir: string
): Promise<{ skipPaths: string[]; warnedPaths: string[]; updatedPaths: string[] }> {
  if (forceOverwriteAll) {
    // forceOverwriteAll: still warn but do NOT skip
    const warnedPaths = await findProtectedFilesInDir(srcPath, componentPath);
    return { skipPaths: [], warnedPaths, updatedPaths: [] };
  }

  const protectedRelative = await findProtectedFilesInDir(srcPath, componentPath);
  const path = await import('node:path');

  const skipPaths: string[] = [];
  const warnedPaths: string[] = [];
  const updatedPaths: string[] = [];

  for (const p of protectedRelative) {
    const sourceFilePath = join(srcPath, p);
    const targetFilePath = join(targetDir, componentPath, p);
    // Lockfile keys use forward-slash paths like ".claude/rules/MUST-safety.md"
    const lockfileKey = `${componentPath}/${p}`.replace(/\\/g, '/');

    const shouldSkip = await shouldSkipProtectedFile(
      sourceFilePath,
      targetFilePath,
      lockfileKey,
      lockfile
    );

    if (shouldSkip) {
      skipPaths.push(path.relative(destPath, join(destPath, p)));
      warnedPaths.push(p);
    } else {
      updatedPaths.push(p);
    }
  }

  return { skipPaths, warnedPaths, updatedPaths };
}

/**
 * Check if a directory entry's relative path matches a protected-file rule,
 * considering both the bare relative path and the component-prefixed path.
 */
function isEntryProtected(relPath: string, componentRelativePrefix: string): boolean {
  if (isProtectedFile(relPath)) {
    return true;
  }
  const componentPrefixed = componentRelativePrefix
    ? `${componentRelativePrefix}/${relPath}`
    : relPath;
  return isProtectedFile(componentPrefixed);
}

/**
 * Read directory entries, returning an empty array on error (e.g. directory not found).
 */
async function safeReaddir(
  dir: string,
  fs: typeof import('node:fs/promises')
): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Walk a component source directory and return paths (relative to the component root)
 * of any files that match the protected-file rules.
 */
async function findProtectedFilesInDir(
  dirPath: string,
  componentRelativePrefix: string
): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  // Iterative BFS walk to avoid recursive async function complexity
  const protected_: string[] = [];
  const queue: Array<{ dir: string; relDir: string }> = [{ dir: dirPath, relDir: '' }];

  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: queue.length > 0 guarantees shift() returns a value
    const { dir, relDir } = queue.shift()!;
    const entries = await safeReaddir(dir, fs);

    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        queue.push({ dir: fullPath, relDir: relPath });
      } else if (entry.isFile() && isEntryProtected(relPath, componentRelativePrefix)) {
        protected_.push(relPath);
      }
    }
  }

  return protected_;
}

/**
 * Update a single component
 */
async function updateNativeAgentComponent(
  targetDir: string,
  customizations: CustomizationManifest | null,
  options: UpdateOptions
): Promise<{ customizations: string[]; protected: string[] }> {
  const componentPath = getComponentPath('agents');
  const configuredPreservations =
    customizations && !options.forceOverwriteAll
      ? customizations.preserveFiles.filter((filePath) =>
          isSameOrDescendantPath(filePath, componentPath)
        )
      : [];
  const syncResult = await syncNativeAgents({
    sourceDir: resolveTemplatePath(getTemplateComponentPath('agents')),
    destinationDir: join(targetDir, componentPath),
    targetRoot: targetDir,
  });
  return {
    customizations: [
      ...new Set([
        ...configuredPreservations,
        ...syncResult.preserved.map((filename) => `${componentPath}/${filename}`),
      ]),
    ],
    protected: [],
  };
}

async function updateComponent(
  targetDir: string,
  component: UpdateComponent,
  customizations: CustomizationManifest | null,
  options: UpdateOptions,
  config: OmccConfig,
  lockfile: Lockfile | null
): Promise<{ customizations: string[]; protected: string[] }> {
  if (component === 'agents') {
    return updateNativeAgentComponent(targetDir, customizations, options);
  }
  if (component === 'hooks') {
    return updateHooksComponent(targetDir);
  }

  return updateDirectoryComponent(targetDir, component, customizations, options, config, lockfile);
}

async function updateHooksComponent(
  targetDir: string
): Promise<{ customizations: string[]; protected: string[] }> {
  const result = await installNativeCodexHooks(targetDir, {
    overwrite: true,
  });
  return {
    customizations: result.registryPreserved ? ['.codex/hooks.json'] : [],
    protected: [],
  };
}

async function updateDirectoryComponent(
  targetDir: string,
  component: Exclude<UpdateComponent, 'hooks'>,
  customizations: CustomizationManifest | null,
  options: UpdateOptions,
  config: OmccConfig,
  lockfile: Lockfile | null
): Promise<{ customizations: string[]; protected: string[] }> {
  const preservedFiles: string[] = [];
  const componentPath = getComponentPath(component);
  const srcPath = resolveTemplatePath(getTemplateComponentPath(component));
  const destPath = join(targetDir, componentPath);

  // Use provided config to check for managed:false components
  const customComponents = config.customComponents || [];

  // Build skipPaths list from preserved files and custom components
  const skipPaths: string[] = [];

  // Add preserved files to skipPaths
  // Skip preservation only if forceOverwriteAll is true
  // Note: preserveCustomizations flag is already handled in update() function
  // when building the customizations object
  if (customizations && !options.forceOverwriteAll) {
    const toPreserve = customizations.preserveFiles.filter((filePath) =>
      isSameOrDescendantPath(filePath, componentPath)
    );
    preservedFiles.push(...toPreserve);
    skipPaths.push(...toPreserve);
  }

  // Add custom components in this component path to skipPaths
  for (const cc of customComponents) {
    if (isSameOrDescendantPath(cc.path, componentPath)) {
      skipPaths.push(cc.path);
    }
  }

  // Collect protected framework/rule files that must not be silently overwritten.
  // Uses lockfile to distinguish user-modified files (skip) from unmodified ones (update).
  const {
    skipPaths: protectedSkipPaths,
    warnedPaths: protectedWarnedPaths,
    updatedPaths: protectedUpdatedPaths,
  } = await collectProtectedSkipPaths(
    srcPath,
    destPath,
    componentPath,
    !!options.forceOverwriteAll,
    lockfile,
    targetDir
  );

  for (const protectedPath of protectedWarnedPaths) {
    if (options.forceOverwriteAll) {
      warn('update.protected_file_force_overwrite', {
        file: protectedPath,
        component,
        hint: 'File contains AI behavioral constraints. Overwriting because --force-overwrite-all was set.',
      });
    } else {
      warn('update.protected_file_skipped', {
        file: protectedPath,
        component,
        hint: 'File was modified by user and preserved. Use --force-overwrite-all to override.',
      });
    }
  }

  const protectedFiles = options.forceOverwriteAll
    ? []
    : protectedWarnedPaths.map((p) => `${componentPath}/${p}`);

  // Log protected files that WILL be updated (unmodified by user, matches lockfile hash)
  for (const updatedPath of protectedUpdatedPaths) {
    info('update.protected_file_updated', {
      file: updatedPath,
      component,
      hint: 'Protected file updated (unmodified by user, matches lockfile hash).',
    });
  }

  // Project-level preservation paths need normalization; protected paths are
  // already relative to the component destination.
  const normalizedSkipPaths = skipPaths.map((p) => {
    const preserved = normalizePreservedPath(p);
    const relativeToComponent = preserved.path.slice(
      normalizeProjectPath(componentPath).length + 1
    );
    return preserved.isDirectory ? `${relativeToComponent}/` : relativeToComponent;
  });
  normalizedSkipPaths.push(...protectedSkipPaths);

  // Deduplicate after normalization
  const uniqueSkipPaths = [...new Set(normalizedSkipPaths)];

  // Update component with skipPaths
  await copyDirectory(srcPath, destPath, {
    overwrite: true,
    skipPaths: uniqueSkipPaths.length > 0 ? uniqueSkipPaths : undefined,
    trustedWriteRoot: targetDir,
  });

  debug('update.component_updated', {
    component,
    skippedPaths: String(uniqueSkipPaths.length),
    protectedSkipped: String(protectedSkipPaths.length),
  });
  return { customizations: preservedFiles, protected: protectedFiles };
}

/**
 * Root-level files in .claude/ that should be synced during update
 * These are files that exist directly under templates/.claude/ (not in subdirectories)
 */
const ROOT_LEVEL_FILES = ['statusline.sh', 'install-hooks.sh', 'uninstall-hooks.sh'];

async function validateUpdateFinalizationTargets(targetDir: string): Promise<void> {
  await prevalidateSafeWritePath(join(targetDir, '.omcodexrc.json'), targetDir);
  await prevalidateSafeWritePath(join(targetDir, '.omcodex.lock.json'), targetDir);
}

async function validateUpdateComponentTargets(
  targetDir: string,
  components: UpdateComponent[]
): Promise<void> {
  for (const component of components) {
    if (component === 'hooks') {
      await prevalidateNativeCodexHooks(targetDir, { overwrite: true });
      continue;
    }
    const srcPath = resolveTemplatePath(getTemplateComponentPath(component));
    if (!(await fileExists(srcPath))) continue;
    if (component === 'agents') {
      await prevalidateNativeAgentSync({
        sourceDir: srcPath,
        destinationDir: join(targetDir, getComponentPath(component)),
        targetRoot: targetDir,
      });
      continue;
    }
    await prevalidateCopyDirectory(srcPath, join(targetDir, getComponentPath(component)), {
      overwrite: true,
      trustedWriteRoot: targetDir,
    });
  }
}

async function validateBackupSourceRoots(targetDir: string): Promise<void> {
  const layout = getProviderLayout();
  const dirsToBackup = [layout.rootDir, 'guides'];
  if (layout.provider === 'codex') {
    dirsToBackup.push('.agents');
  }

  for (const relativePath of dirsToBackup) {
    await validateBackupSource(join(targetDir, relativePath), 'directory');
  }
  await validateBackupSource(join(targetDir, layout.entryFile), 'file');
}

async function validateBackupSource(
  srcPath: string,
  expectedType: 'directory' | 'file'
): Promise<void> {
  const fs = await import('node:fs/promises');
  if (!(await fileExists(srcPath))) return;
  const stats = await fs.lstat(srcPath);
  if (stats.isSymbolicLink()) {
    throw new Error(`Unsafe backup source: symbolic link "${srcPath}"`);
  }
  if (expectedType === 'directory' && !stats.isDirectory()) {
    throw new Error(`Unsafe backup source: not a directory "${srcPath}"`);
  }
  if (expectedType === 'file' && !stats.isFile()) {
    throw new Error(`Unsafe backup source: not a regular file "${srcPath}"`);
  }
}

async function persistConfigMigrationIfNeeded(
  targetDir: string,
  config: OmccConfig,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return;

  for (const configPath of getConfigCandidatePaths(targetDir)) {
    if (!(await fileExists(configPath))) continue;
    try {
      const raw = await readJsonFile<Partial<OmccConfig>>(configPath);
      if ((raw.configVersion ?? 0) < config.configVersion) {
        await saveConfig(targetDir, config, { trustedWriteRoot: targetDir });
      }
    } catch {
      // Preserve loadConfig's graceful invalid-JSON fallback semantics.
    }
    return;
  }
}

async function validateFullUpdateTargets(targetDir: string): Promise<void> {
  const layout = getProviderLayout();
  for (const fileName of ROOT_LEVEL_FILES) {
    const srcPath = resolveTemplatePath(join(layout.templateRootDir, fileName));
    if (await fileExists(srcPath)) {
      await prevalidateSafeWritePath(join(targetDir, layout.rootDir, fileName), targetDir);
    }
  }

  await prevalidateSafeWritePath(join(targetDir, layout.rootDir, 'settings.local.json'), targetDir);
  await prevalidateSafeWritePath(join(targetDir, layout.entryFile), targetDir);
  await validateUpdateFinalizationTargets(targetDir);
}

/**
 * Sync root-level files from templates/.claude/ to target .claude/ directory
 * These files don't belong to any component subdirectory.
 */
async function syncRootLevelFiles(targetDir: string, options: UpdateOptions): Promise<string[]> {
  if (options.dryRun) {
    return ROOT_LEVEL_FILES;
  }

  const fs = await import('node:fs/promises');
  const layout = getProviderLayout();
  const synced: string[] = [];

  for (const fileName of ROOT_LEVEL_FILES) {
    const srcPath = resolveTemplatePath(join(layout.templateRootDir, fileName));

    if (!(await fileExists(srcPath))) {
      continue;
    }

    const destPath = join(targetDir, layout.rootDir, fileName);
    await copyFile(srcPath, destPath, targetDir);

    // Preserve execute permissions for shell scripts
    if (fileName.endsWith('.sh')) {
      await fs.chmod(destPath, 0o755);
    }

    synced.push(fileName);
  }

  if (synced.length > 0) {
    debug('update.root_files_synced', { files: synced.join(', ') });
  }

  return synced;
}

/**
 * Deprecated file entry in the manifest
 */
interface DeprecatedFileEntry {
  /** Relative path to the deprecated file */
  path: string;
  /** Reason for deprecation */
  reason: string;
  /** Version since which the file was deprecated */
  since: string;
}

/**
 * Deprecated files manifest
 */
interface DeprecatedFilesManifest {
  description: string;
  files: DeprecatedFileEntry[];
}

function normalizeDeprecatedFilePath(
  entryPath: string,
  layout: ReturnType<typeof getProviderLayout>
): string {
  if (
    layout.rootDir !== layout.templateRootDir &&
    entryPath.startsWith(`${layout.templateRootDir}/`)
  ) {
    return `${layout.rootDir}/${entryPath.slice(layout.templateRootDir.length + 1)}`;
  }
  return entryPath;
}

async function validateDeprecatedFileTarget(
  targetDir: string,
  normalizedPath: string
): Promise<string | null> {
  const validation = validatePreserveFilePath(normalizedPath, targetDir);
  if (!validation.valid) {
    warn('update.deprecated_file_invalid_path', {
      path: normalizedPath,
      reason: validation.reason ?? 'Invalid path',
    });
    return null;
  }

  const fullPath = join(targetDir, normalizedPath);
  const exists = await validateSafeDeleteFilePath(fullPath, targetDir);
  return exists ? normalizedPath : null;
}

async function planOrRemoveDeprecatedFile(
  targetDir: string,
  entry: DeprecatedFileEntry,
  normalizedPath: string,
  dryRun: boolean
): Promise<string | null> {
  const safePath = await validateDeprecatedFileTarget(targetDir, normalizedPath);
  if (!safePath) return null;

  if (!dryRun) {
    await deleteFile(join(targetDir, normalizedPath), targetDir);
    info('update.deprecated_file_removed', {
      path: normalizedPath,
      reason: entry.reason,
    });
  }
  return normalizedPath;
}

/**
 * Remove deprecated files from the target directory.
 * Reads templates/deprecated-files.json and removes listed files if they exist.
 */
async function getDeprecatedFileTargets(targetDir: string): Promise<string[]> {
  const manifestPath = resolveTemplatePath('deprecated-files.json');

  if (!(await fileExists(manifestPath))) {
    return [];
  }

  const layout = getProviderLayout();
  const manifest = await readJsonFile<DeprecatedFilesManifest>(manifestPath);

  if (!manifest.files || manifest.files.length === 0) {
    return [];
  }

  const targets: string[] = [];
  for (const entry of manifest.files) {
    const normalizedPath = normalizeDeprecatedFilePath(entry.path, layout);
    const safePath = await validateDeprecatedFileTarget(targetDir, normalizedPath);
    if (safePath) targets.push(safePath);
  }
  return targets;
}

async function prevalidateDeprecatedFileTargets(targetDir: string): Promise<void> {
  await getDeprecatedFileTargets(targetDir);
}

async function removeDeprecatedFiles(targetDir: string, options: UpdateOptions): Promise<string[]> {
  const manifestPath = resolveTemplatePath('deprecated-files.json');

  if (!(await fileExists(manifestPath))) {
    return [];
  }

  const layout = getProviderLayout();
  const manifest = await readJsonFile<DeprecatedFilesManifest>(manifestPath);

  if (!manifest.files || manifest.files.length === 0) {
    return [];
  }

  const removed: string[] = [];

  for (const entry of manifest.files) {
    const normalizedPath = normalizeDeprecatedFilePath(entry.path, layout);
    const removedPath = await planOrRemoveDeprecatedFile(
      targetDir,
      entry,
      normalizedPath,
      !!options.dryRun
    );
    if (removedPath) removed.push(removedPath);
  }

  if (removed.length > 0) {
    debug('update.deprecated_files_cleaned', { count: String(removed.length) });
  }

  return removed;
}

/**
 * Extract the `name:` field from YAML frontmatter.
 * Returns null if no frontmatter or no name field found.
 */
export function extractFrontmatterName(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const nameMatch = match[1].match(/^name:\s*(.+)$/m);
  if (!nameMatch) return null;
  return nameMatch[1].trim().replace(/^["']|["']$/g, '');
}

/**
 * Sync the frontmatter name: field from upstream to target file.
 * Only modifies the name: line, preserving all other content.
 * Returns true if the file was modified.
 */
async function syncNamespaceInFile(
  targetFilePath: string,
  upstreamFilePath: string,
  trustedWriteRoot: string
): Promise<boolean> {
  const targetContent = await readTextFile(targetFilePath);
  const upstreamContent = await readTextFile(upstreamFilePath);

  const upstreamName = extractFrontmatterName(upstreamContent);
  const targetName = extractFrontmatterName(targetContent);

  if (!upstreamName || !targetName || upstreamName === targetName) return false;

  // Replace only the name: line in frontmatter
  // Escape $ in upstream name to prevent replace() special patterns ($1, $&, etc.)
  const safeUpstreamName = upstreamName.replace(/\$/g, '$$$$');
  const updated = targetContent.replace(/^(name:\s*).+$/m, `$1${safeUpstreamName}`);

  if (updated === targetContent) return false;

  await writeTextFile(targetFilePath, updated, { trustedWriteRoot });
  return true;
}

/**
 * Process a single file entry during namespace sync walk.
 * Returns the synced path string if the name was updated, null otherwise.
 */
async function processNamespaceSyncEntry(
  entry: import('node:fs').Dirent,
  relPath: string,
  fullSrcPath: string,
  destPath: string,
  componentPath: string,
  lockfile: Lockfile,
  trustedWriteRoot: string
): Promise<string | null> {
  if (!entry.isFile() || !entry.name.endsWith('.md')) return null;

  const targetFilePath = join(destPath, relPath);
  const lockfileKey = `${componentPath}/${relPath}`.replace(/\\/g, '/');

  // Only sync unmodified files (hash matches lockfile → safe)
  const shouldSkip = await shouldSkipProtectedFile(
    fullSrcPath,
    targetFilePath,
    lockfileKey,
    lockfile
  );
  if (shouldSkip) return null;

  if (!(await fileExists(targetFilePath))) return null;

  const didSync = await syncNamespaceInFile(targetFilePath, fullSrcPath, trustedWriteRoot);
  return didSync ? `${componentPath}/${relPath}` : null;
}

/**
 * Apply namespace synchronization to all unmodified files in a component.
 * Uses lockfile hash comparison to identify unmodified files.
 */
async function applyNamespaceSync(
  targetDir: string,
  component: UpdateComponent,
  lockfile: Lockfile | null
): Promise<string[]> {
  // Without a lockfile we cannot verify which files are unmodified — skip entirely
  if (!lockfile) return [];

  const componentPath = getComponentPath(component);
  const srcPath = resolveTemplatePath(getTemplateComponentPath(component));
  const destPath = join(targetDir, componentPath);

  const fs = await import('node:fs/promises');
  const synced: string[] = [];

  // BFS walk of the source directory to find .md files with frontmatter
  const queue: Array<{ dir: string; relDir: string }> = [{ dir: srcPath, relDir: '' }];

  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: queue.length > 0 guarantees shift() returns a value
    const { dir, relDir } = queue.shift()!;

    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const fullSrcPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        queue.push({ dir: fullSrcPath, relDir: relPath });
        continue;
      }

      const syncedPath = await processNamespaceSyncEntry(
        entry,
        relPath,
        fullSrcPath,
        destPath,
        componentPath,
        lockfile,
        targetDir
      );

      if (syncedPath) {
        synced.push(syncedPath);
        info('update.namespace_synced', { file: relPath, component });
      }
    }
  }

  return synced;
}

/**
 * Get the path for a component
 */
function getComponentPath(component: UpdateComponent): string {
  const layout = getProviderLayout();
  if (component === 'guides') {
    return 'guides';
  }
  if (layout.provider === 'codex' && component === 'skills') {
    return '.agents/skills';
  }
  return `${layout.rootDir}/${component}`;
}

/**
 * Backup the current installation
 */
async function backupInstallation(targetDir: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(targetDir, `.omcodex-backup-${timestamp}`);
  await prevalidateSafeWritePath(join(backupDir, '.omcodex-backup-probe'), targetDir);
  await validateBackupSourceRoots(targetDir);
  await ensureDirectory(backupDir);

  // Backup key directories
  const layout = getProviderLayout();
  const dirsToBackup = [layout.rootDir, 'guides'];
  if (layout.provider === 'codex') {
    dirsToBackup.push('.agents');
  }
  for (const dir of dirsToBackup) {
    const srcPath = join(targetDir, dir);
    if (await fileExists(srcPath)) {
      const destPath = join(backupDir, dir);
      await copyDirectory(srcPath, destPath, { overwrite: true, trustedWriteRoot: targetDir });
    }
  }

  // Backup entry doc
  const entryPath = join(targetDir, layout.entryFile);
  if (await fileExists(entryPath)) {
    await copyFile(entryPath, join(backupDir, layout.entryFile), targetDir);
  }

  return backupDir;
}

/**
 * Load customization manifest
 */
async function loadCustomizationManifest(targetDir: string): Promise<CustomizationManifest | null> {
  for (const manifestFile of [CUSTOMIZATION_MANIFEST_FILE, LEGACY_CUSTOMIZATION_MANIFEST_FILE]) {
    const manifestPath = join(targetDir, manifestFile);
    if (await fileExists(manifestPath)) {
      return readJsonFile<CustomizationManifest>(manifestPath);
    }
  }
  return null;
}

/**
 * Save customization manifest
 */
export async function saveCustomizationManifest(
  targetDir: string,
  manifest: CustomizationManifest
): Promise<void> {
  const manifestPath = join(targetDir, CUSTOMIZATION_MANIFEST_FILE);
  await writeJsonFile(manifestPath, manifest, { trustedWriteRoot: targetDir });
}

/**
 * Get list of agent versions
 */
export async function getAgentVersions(targetDir: string): Promise<AgentVersion[]> {
  const config = await loadConfig(targetDir);
  const versions: AgentVersion[] = [];

  if (config.agents) {
    for (const [name, agentConfig] of Object.entries(config.agents)) {
      versions.push({
        name,
        version: agentConfig.version,
        source: agentConfig.source || 'local',
        lastUpdated: agentConfig.lastUpdated || '',
        hasLocalModifications: agentConfig.hasLocalModifications || false,
      });
    }
  }

  return versions;
}
