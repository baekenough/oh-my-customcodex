/**
 * Installer module - Install/copy templates
 */

import { readFile as fsReadFile, lstat, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import {
  copyDirectory,
  copyFile,
  ensureDirectory,
  fileExists,
  getPackageRoot,
  prevalidateCopyDirectory,
  prevalidateSafeWritePath,
  readJsonFile,
  resolveTemplatePath,
  validateSafeWritePath,
  writeJsonFile,
  writeTextFile,
} from '../utils/fs.js';
import { debug, error, info, success, warn } from '../utils/logger.js';
import { prevalidateNativeAgentSync, syncNativeAgents } from './agent-compiler.js';
import { installNativeCodexHooks, prevalidateNativeCodexHooks } from './codex-hooks.js';
import { installCodex, isCodexInstalled } from './codex-installer.js';
import { loadConfig, saveConfig } from './config.js';
import {
  cleanupPreservation,
  DEFAULT_CRITICAL_DIRECTORIES,
  DEFAULT_CRITICAL_FILES,
  extractCriticalFiles,
  type PreservationResult,
  restoreCriticalFiles,
} from './file-preservation.js';
import {
  detectGitWorkflow,
  getDefaultWorkflow,
  renderGitWorkflowEN,
  renderGitWorkflowKO,
} from './git-workflow.js';
import {
  getComponentPath,
  getEntryTemplateName,
  getProviderLayout,
  getTemplateComponentPath,
  type InstallComponent,
} from './layout.js';
import { generateAndWriteLockfileForDir } from './lockfile.js';
import {
  assessOmxInstallation,
  ensureOmxProjectReady,
  installOmx,
  MINIMUM_OMX_VERSION,
} from './omx-installer.js';
import { installRtk, isRtkInstalled } from './rtk-installer.js';
import { getSkillScope, shouldInstallSkill } from './scope-filter.js';

/**
 * Options for installation
 */
export interface InstallDependencies {
  /** Injectable lockfile generation boundary for isolated installer tests. */
  generateAndWriteLockfileForDir?: typeof generateAndWriteLockfileForDir;
  /** Injectable project provisioning boundary for isolated installer/init tests. */
  ensureOmxProjectReady?: (projectRoot: string) => {
    success: boolean;
    command: string;
    error?: string;
  };
}

export interface InstallOptions {
  /** Target directory to install to */
  targetDir: string;
  /** Language for entry doc (en or ko) */
  language?: 'en' | 'ko';
  /** Whether to overwrite existing files */
  force?: boolean;
  /** Whether to backup existing files before overwriting */
  backup?: boolean;
  /** Specific components to install (default: all) */
  components?: InstallComponent[];
  /** Skip confirmation prompts */
  skipConfirm?: boolean;
  /**
   * Install only agents whose domain matches this value.
   * Universal agents are always installed regardless of this filter.
   * When undefined, all agents are installed (backward compatible).
   */
  domain?: string;
  /** Test-only dependency injection boundary. */
  dependencies?: InstallDependencies;
  /** Provision and verify the project-scoped OMX runtime before reporting success. */
  provisionOmxProject?: boolean;
}

/**
 * Components that can be installed
 * Updated for official format (commands absorbed into skills)
 */
export type { InstallComponent };

/**
 * Result of installation
 */
export interface InstallResult {
  /** Whether installation was successful */
  success: boolean;
  /** Path to installed directory */
  installedPath: string;
  /** List of installed components */
  installedComponents: InstallComponent[];
  /** List of skipped components (already exist) */
  skippedComponents: InstallComponent[];
  /** List of backed up paths */
  backedUpPaths: string[];
  /** Any warnings during installation */
  warnings: string[];
  /** Error message if failed */
  error?: string;
}

/**
 * Template manifest describing available templates
 */
export interface TemplateManifest {
  /** Version of the templates */
  version: string;
  /** Last updated timestamp */
  lastUpdated: string;
  /** Available components */
  components: {
    name: InstallComponent;
    path: string;
    description: string;
    files: number;
  }[];
  /** Source repository */
  source: string;
}

/**
 * Directory structure to create
 * Updated for official format:
 * - agents/ is flat (no subdirectories)
 * - skills/ contains skill directories
 * - commands/ removed (absorbed into skills)
 */
const DEFAULT_LANGUAGE: 'en' | 'ko' = 'en';

/**
 * Get the template directory path from the installed package
 */
export function getTemplateDir(): string {
  const packageRoot = getPackageRoot();
  return join(packageRoot, 'templates');
}

/**
 * Initialize result object for installation
 */
function createInstallResult(targetDir: string): InstallResult {
  return {
    success: false,
    installedPath: targetDir,
    installedComponents: [],
    skippedComponents: [],
    backedUpPaths: [],
    warnings: [],
  };
}

/**
 * Ensure target directory exists
 */
function assertSafeTargetDirectorySegment(
  stats: Awaited<ReturnType<typeof lstat>>,
  path: string
): void {
  if (stats.isSymbolicLink()) {
    throw new Error(`Unsafe target directory: symbolic link segment "${path}"`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Unsafe target directory: parent segment is not a directory "${path}"`);
  }
}

async function collectMissingTargetSegments(resolvedTarget: string): Promise<string[]> {
  const missingSegments: string[] = [];
  let current = resolvedTarget;

  while (true) {
    try {
      assertSafeTargetDirectorySegment(await lstat(current), current);
      return missingSegments;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
      missingSegments.push(current);
      const parent = dirname(current);
      if (parent === current) {
        throw new Error(
          `Unsafe target directory: no existing directory boundary for "${resolvedTarget}"`
        );
      }
      current = parent;
    }
  }
}

async function createMissingTargetSegments(missingSegments: string[]): Promise<void> {
  for (const segmentPath of missingSegments.reverse()) {
    try {
      assertSafeTargetDirectorySegment(await lstat(segmentPath), segmentPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
      await mkdir(segmentPath);
    }
  }
}

async function ensureTargetDirectory(targetDir: string): Promise<void> {
  await createMissingTargetSegments(await collectMissingTargetSegments(resolve(targetDir)));
}

/**
 * Handle backup of existing installation
 */
async function validateExistingBackupSource(path: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) {
    throw new Error(`Unsafe backup source: symbolic link "${path}"`);
  }
  if (!stats.isDirectory() && !stats.isFile()) {
    throw new Error(`Unsafe backup source: not a regular file or directory "${path}"`);
  }
}

async function validateCriticalPreservationRoot(rootDir: string): Promise<boolean> {
  if (!(await fileExists(rootDir))) return false;
  const rootStats = await lstat(rootDir);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`Unsafe preservation source: invalid root directory "${rootDir}"`);
  }
  return true;
}

async function validateCriticalPreservationFile(filePath: string): Promise<void> {
  if (!(await fileExists(filePath))) return;
  const stats = await lstat(filePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Unsafe preservation source: invalid critical file "${filePath}"`);
  }
}

async function validateCriticalPreservationDirectory(dirPath: string): Promise<void> {
  if (!(await fileExists(dirPath))) return;
  const stats = await lstat(dirPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Unsafe preservation source: invalid critical directory "${dirPath}"`);
  }
}

async function validateCriticalPreservationSources(rootDir: string): Promise<void> {
  if (!(await validateCriticalPreservationRoot(rootDir))) return;
  for (const fileName of DEFAULT_CRITICAL_FILES) {
    await validateCriticalPreservationFile(join(rootDir, fileName));
  }

  for (const dirName of DEFAULT_CRITICAL_DIRECTORIES) {
    await validateCriticalPreservationDirectory(join(rootDir, dirName));
  }
}

async function validateInstallBackupSources(targetDir: string): Promise<void> {
  const layout = getProviderLayout();
  await validateCriticalPreservationSources(join(targetDir, layout.rootDir));
  for (const relativePath of await checkExistingPaths(targetDir)) {
    await validateExistingBackupSource(join(targetDir, relativePath));
  }
}

async function handleBackup(
  targetDir: string,
  shouldBackup: boolean,
  result: InstallResult
): Promise<PreservationResult | null> {
  if (!shouldBackup) return null;

  await validateInstallBackupSources(targetDir);

  const layout = getProviderLayout();
  const rootDir = join(targetDir, layout.rootDir);

  let preservation: PreservationResult | null = null;
  try {
    // Extract critical user files BEFORE backup moves .claude/ away
    if (await fileExists(rootDir)) {
      const { createTempDir } = await import('../utils/fs.js');
      const tempDir = await createTempDir('omcodex-preserve-');
      preservation = await extractCriticalFiles(rootDir, tempDir);

      if (preservation.extractedFiles.length > 0 || preservation.extractedDirs.length > 0) {
        info('install.preserved', {
          files: String(preservation.extractedFiles.length),
          dirs: String(preservation.extractedDirs.length),
        });
      }
    }

    const backupPaths = await backupExistingInstallation(targetDir);
    result.backedUpPaths.push(...backupPaths);
    if (backupPaths.length > 0) {
      info('install.backup', { path: backupPaths[0] });
    }

    return preservation;
  } catch (err) {
    if (preservation) {
      await cleanupPreservation(preservation.tempDir);
    }
    throw err;
  }
}

/**
 * Check for existing files and add warnings if needed
 */
async function checkAndWarnExisting(
  targetDir: string,
  force: boolean,
  backup: boolean,
  result: InstallResult
): Promise<void> {
  if (force || backup) return;

  const existingPaths = await checkExistingPaths(targetDir);
  if (existingPaths.length > 0) {
    const layout = getProviderLayout();
    warn('install.exists', { rootDir: layout.rootDir });
    result.warnings.push(
      `Existing files found: ${existingPaths.join(', ')}. Use --force to overwrite or --backup to backup first.`
    );
  }
}

/**
 * Verify template directory exists
 */
async function verifyTemplateDirectory(): Promise<void> {
  const templateDir = getTemplateDir();
  if (!(await fileExists(templateDir))) {
    throw new Error(`Template directory not found: ${templateDir}`);
  }
}

/**
 * Install all components and track results
 */
async function installAllComponents(
  targetDir: string,
  options: InstallOptions,
  result: InstallResult
): Promise<void> {
  const components = options.components || getAllComponents();

  for (const component of components) {
    await installSingleComponent(targetDir, component, options, result);
  }
}

/**
 * Install a single component with error handling
 */
async function installSingleComponent(
  targetDir: string,
  component: InstallComponent,
  options: InstallOptions,
  result: InstallResult
): Promise<void> {
  try {
    const installed = await installComponent(targetDir, component, options);
    if (installed) {
      result.installedComponents.push(component);
    } else {
      result.skippedComponents.push(component);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.warnings.push(`Failed to install ${component}: ${message}`);
  }
}

/**
 * Install statusline.sh to the target directory and make it executable
 */
async function installStatusline(
  targetDir: string,
  options: InstallOptions,
  _result: InstallResult
): Promise<void> {
  const layout = getProviderLayout();
  const srcPath = resolveTemplatePath(join(layout.templateRootDir, 'statusline.sh'));
  const destPath = join(targetDir, layout.rootDir, 'statusline.sh');

  if (!(await fileExists(srcPath))) {
    debug('install.statusline_not_found', { path: srcPath });
    return;
  }

  if (await fileExists(destPath)) {
    if (!options.force && !options.backup) {
      debug('install.statusline_skipped', { reason: 'exists' });
      return;
    }
  }

  await copyFile(srcPath, destPath, targetDir);

  const fs = await import('node:fs/promises');
  await fs.chmod(destPath, 0o755);

  debug('install.statusline_installed', {});
}

/**
 * Install tests/tsconfig.json to the target directory
 */
async function installTestsConfig(
  targetDir: string,
  options: InstallOptions,
  _result: InstallResult
): Promise<void> {
  const srcPath = resolveTemplatePath(join('tests', 'tsconfig.json'));
  const destPath = join(targetDir, 'tests', 'tsconfig.json');

  if (!(await fileExists(srcPath))) {
    debug('install.tests_config_not_found', { path: srcPath });
    return;
  }

  if (await fileExists(destPath)) {
    if (!options.force && !options.backup) {
      debug('install.tests_config_skipped', { reason: 'exists' });
      return;
    }
  }

  await copyFile(srcPath, destPath, targetDir);
  debug('install.tests_config_installed', {});
}

/**
 * Create or merge settings.local.json with statusLine configuration
 */
async function installSettingsLocal(targetDir: string, result: InstallResult): Promise<void> {
  const layout = getProviderLayout();
  const settingsPath = join(targetDir, layout.rootDir, 'settings.local.json');

  const statusLineConfig = {
    statusLine: {
      type: 'command' as const,
      command: `${layout.rootDir}/statusline.sh`,
      padding: 0,
      refreshInterval: 10,
    },
  };

  if (await fileExists(settingsPath)) {
    try {
      const existing = await readJsonFile<Record<string, unknown>>(settingsPath);
      if (!existing.statusLine) {
        existing.statusLine = statusLineConfig.statusLine;
        await writeJsonFile(settingsPath, existing, { trustedWriteRoot: targetDir });
        debug('install.settings_local_merged', {});
      } else {
        debug('install.settings_local_skipped', { reason: 'statusLine exists' });
      }
    } catch {
      result.warnings.push(
        'Failed to parse existing settings.local.json, skipping statusLine config'
      );
    }
    return;
  }

  await writeJsonFile(settingsPath, statusLineConfig, { trustedWriteRoot: targetDir });
  debug('install.settings_local_created', {});
}

/**
 * Install entry doc and track result
 */
async function installEntryDocWithTracking(
  targetDir: string,
  options: InstallOptions,
  result: InstallResult
): Promise<void> {
  const language = options.language ?? DEFAULT_LANGUAGE;
  const overwrite = !!(options.force || options.backup);
  const installed = await installEntryDoc(targetDir, language, overwrite);

  if (installed) {
    result.installedComponents.push('entry-md');
  } else {
    result.skippedComponents.push('entry-md');
  }
}

/**
 * Update configuration after installation
 */
async function updateInstallConfig(
  targetDir: string,
  options: InstallOptions,
  installedComponents: InstallComponent[]
): Promise<void> {
  const config = await loadConfig(targetDir);
  const manifest = await getTemplateManifest();
  config.version = manifest.version;
  config.language = options.language ?? DEFAULT_LANGUAGE;
  config.domain = options.domain;
  config.installedAt = new Date().toISOString();
  config.installedComponents = installedComponents;
  await saveConfig(targetDir, config, { trustedWriteRoot: targetDir });
}

/**
 * Install RTK if not already installed, adding warnings to result on failure
 */
function installRtkIfNeeded(result: InstallResult): void {
  if (!isRtkInstalled()) {
    info('install.rtk_installing');
    const rtkInstalled = installRtk();
    if (rtkInstalled) {
      info('install.rtk_success');
    } else {
      result.warnings.push(
        'RTK installation failed — install manually: brew install rtk-ai/tap/rtk'
      );
    }
  } else {
    info('install.rtk_already');
  }
}

/**
 * Install Codex CLI if not already installed, adding warnings to result on failure
 */
function installCodexIfNeeded(result: InstallResult): void {
  if (!isCodexInstalled()) {
    info('install.codex_installing');
    const codexInstalled = installCodex();
    if (codexInstalled) {
      info('install.codex_success');
    } else {
      result.warnings.push(
        'Codex CLI installation failed — install manually: npm install -g @openai/codex'
      );
    }
  } else {
    info('install.codex_already');
  }
}

/**
 * Install OMX CLI if not already installed, adding warnings to result on failure
 */
function installOmxIfNeeded(result: InstallResult): void {
  const omx = assessOmxInstallation();

  if (omx.status !== 'ready') {
    info('install.omx_installing');
    const omxInstalled = installOmx();
    if (omxInstalled) {
      info('install.omx_success');
    } else {
      const versionDetail = omx.version ? ` (found ${omx.version})` : '';
      result.warnings.push(
        `OMX installation/upgrade failed${versionDetail} — install oh-my-codex >= v${MINIMUM_OMX_VERSION} manually: npm install -g oh-my-codex@latest`
      );
    }
  } else {
    info('install.omx_already');
  }
}

async function prevalidateInstallComponent(
  targetDir: string,
  component: InstallComponent,
  options: InstallOptions,
  overwrite: boolean
): Promise<void> {
  const destPath = join(targetDir, getComponentPath(component));
  const srcPath = resolveTemplatePath(getTemplateComponentPath(component));
  if (!(await fileExists(srcPath))) {
    await prevalidateSafeWritePath(join(destPath, '.omcodex-install-probe'), targetDir);
    return;
  }
  if (component === 'agents') {
    await prevalidateNativeAgentSync({
      sourceDir: srcPath,
      destinationDir: destPath,
      targetRoot: targetDir,
      domain: options.domain,
    });
    return;
  }
  await prevalidateCopyDirectory(srcPath, destPath, {
    overwrite,
    preserveSymlinks: true,
    preserveTimestamps: true,
    trustedWriteRoot: targetDir,
  });
}

async function validateInstallWritePlan(targetDir: string, options: InstallOptions): Promise<void> {
  const layout = getProviderLayout();
  const components = options.components || getAllComponents();
  const overwrite = !!(options.force || options.backup);

  for (const component of components) {
    if (component === 'entry-md') continue;
    if (component === 'hooks') {
      await prevalidateNativeCodexHooks(targetDir, { overwrite });
      continue;
    }
    const destPath = join(targetDir, getComponentPath(component));
    if (component !== 'agents' && !overwrite && (await fileExists(destPath))) continue;
    await prevalidateInstallComponent(targetDir, component, options, overwrite);
  }

  for (const filePath of [
    join(targetDir, layout.rootDir, 'statusline.sh'),
    join(targetDir, 'tests', 'tsconfig.json'),
    join(targetDir, layout.rootDir, 'settings.local.json'),
    join(targetDir, layout.entryFile),
    join(targetDir, '.omcodexrc.json'),
    join(targetDir, '.omcodex.lock.json'),
  ]) {
    await prevalidateSafeWritePath(filePath, targetDir);
  }
}

async function restorePreservationAfterInstall(
  targetDir: string,
  preservation: PreservationResult | null,
  result: InstallResult
): Promise<boolean> {
  if (!preservation) return false;
  const layout = getProviderLayout();
  const rootDir = join(targetDir, layout.rootDir);
  const restoration = await restoreCriticalFiles(rootDir, preservation);

  if (restoration.restoredFiles.length > 0 || restoration.restoredDirs.length > 0) {
    info('install.restored', {
      files: String(restoration.restoredFiles.length),
      dirs: String(restoration.restoredDirs.length),
    });
  }

  for (const failure of restoration.failures) {
    result.warnings.push(`Failed to restore ${failure.path}: ${failure.reason}`);
  }

  await cleanupPreservation(preservation.tempDir);
  return true;
}

async function runInstallFinalization(
  options: InstallOptions,
  result: InstallResult
): Promise<void> {
  await updateInstallConfig(options.targetDir, options, result.installedComponents);

  installRtkIfNeeded(result);
  installCodexIfNeeded(result);

  if (options.provisionOmxProject) {
    const provisionOmxProject =
      options.dependencies?.ensureOmxProjectReady ?? ensureOmxProjectReady;
    const provision = provisionOmxProject(options.targetDir);
    if (!provision.success) {
      throw new Error(
        provision.error ?? `OMX project setup is incomplete. Run manually: ${provision.command}`
      );
    }

    // OMX owns shared project surfaces and may reorder its hook groups during setup.
    // Re-merge only the harness-managed native hook subset so existing custom/OMX
    // handlers retain their relative order and the final lockfile hashes this state.
    const requestedComponents = options.components ?? getAllComponents();
    if (requestedComponents.includes('hooks')) {
      await installNativeCodexHooks(options.targetDir, { overwrite: false });
    }
  } else {
    installOmxIfNeeded(result);
  }

  const writeLockfileForDir =
    options.dependencies?.generateAndWriteLockfileForDir ?? generateAndWriteLockfileForDir;
  const lockfileResult = await writeLockfileForDir(options.targetDir, {
    trustedWriteRoot: options.targetDir,
  });
  if (lockfileResult.warning) {
    result.warnings.push(lockfileResult.warning);
    warn('install.lockfile_failed', { error: lockfileResult.warning });
  } else {
    info('install.lockfile_generated', { files: String(lockfileResult.fileCount) });
  }
}

/**
 * Install oh-my-customcodex templates to target directory
 */
export async function install(options: InstallOptions): Promise<InstallResult> {
  const result = createInstallResult(options.targetDir);
  let preservation: PreservationResult | null = null;

  try {
    info('install.start', { targetDir: options.targetDir });

    await ensureTargetDirectory(options.targetDir);
    await verifyTemplateDirectory();
    await validateInstallWritePlan(options.targetDir, options);
    preservation = await handleBackup(options.targetDir, !!options.backup, result);
    await checkAndWarnExisting(options.targetDir, !!options.force, !!options.backup, result);

    await installAllComponents(options.targetDir, options, result);
    await installStatusline(options.targetDir, options, result);
    await installTestsConfig(options.targetDir, options, result);
    await installSettingsLocal(options.targetDir, result);
    await installEntryDocWithTracking(options.targetDir, options, result);

    if (await restorePreservationAfterInstall(options.targetDir, preservation, result)) {
      preservation = null;
    }

    await runInstallFinalization(options, result);

    result.success = true;
    success('install.success');
  } catch (err) {
    if (preservation) {
      await cleanupPreservation(preservation.tempDir);
    }
    const message = err instanceof Error ? err.message : String(err);
    result.error = message;
    error('install.failed', { error: message });
  }

  return result;
}

/**
 * Copy templates from package to target directory
 */
function assertRelativeTemplatePath(templatePath: string): void {
  if (isAbsolute(templatePath) || win32.isAbsolute(templatePath)) {
    throw new Error(`Template path must be relative: ${templatePath}`);
  }
  const templateRoot = resolve(getTemplateDir());
  const resolved = resolve(templateRoot, templatePath);
  const fromRoot = relative(templateRoot, resolved);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`Template path cannot traverse outside templates: ${templatePath}`);
  }
}

export async function copyTemplates(
  targetDir: string,
  templatePath: string,
  options?: { overwrite?: boolean; preserveSymlinks?: boolean }
): Promise<void> {
  assertRelativeTemplatePath(templatePath);
  const srcPath = resolveTemplatePath(templatePath);
  if (!(await fileExists(srcPath)) || !(await stat(srcPath)).isDirectory()) {
    throw new Error(`Template directory not found: ${templatePath}`);
  }
  await ensureTargetDirectory(targetDir);
  const destPath = join(targetDir, templatePath);

  await copyDirectory(srcPath, destPath, {
    overwrite: options?.overwrite ?? false,
    preserveSymlinks: options?.preserveSymlinks ?? true,
    preserveTimestamps: true,
    trustedWriteRoot: targetDir,
  });
}

/**
 * Create the directory structure for oh-my-customcodex
 */
export async function createDirectoryStructure(targetDir: string): Promise<void> {
  await ensureTargetDirectory(targetDir);
  const layout = getProviderLayout();
  const directories = layout.directoryStructure.map((dir) => join(targetDir, dir));

  for (const fullPath of directories) {
    await prevalidateSafeWritePath(join(fullPath, '.omcodex-directory-probe'), targetDir);
  }

  for (const fullPath of directories) {
    await validateSafeWritePath(join(fullPath, '.omcodex-directory-probe'), targetDir);
    await ensureDirectory(fullPath);
  }
}

/**
 * Get the template manifest
 */
export async function getTemplateManifest(): Promise<TemplateManifest> {
  const packageRoot = getPackageRoot();
  const layout = getProviderLayout();
  const manifestPath = join(packageRoot, 'templates', layout.manifestFile);

  if (await fileExists(manifestPath)) {
    return readJsonFile<TemplateManifest>(manifestPath);
  }

  // Return default manifest if not found
  return {
    version: '0.0.0',
    lastUpdated: new Date().toISOString(),
    components: getAllComponents().map((name) => ({
      name,
      path: getComponentPath(name),
      description: `${name} component`,
      files: 0,
    })),
    source: 'https://github.com/baekenough/oh-my-customcodex',
  };
}

/**
 * Get all available components
 * Updated: commands removed (absorbed into skills)
 */
function getAllComponents(): InstallComponent[] {
  return ['rules', 'agents', 'skills', 'guides', 'hooks', 'contexts', 'ontology'];
}

/**
 * Install skills directory with scope-based filtering.
 * Skills with scope: package are excluded from installation.
 */
async function installSkillsWithScopeFilter(
  srcPath: string,
  destPath: string,
  options: InstallOptions
): Promise<void> {
  await validateSafeWritePath(join(destPath, '.omcodex-directory-probe'), options.targetDir);
  await ensureDirectory(destPath);
  const entries = await readdir(srcPath);

  for (const entry of entries) {
    const entrySrcPath = join(srcPath, entry);
    if (!(await stat(entrySrcPath)).isDirectory()) continue;

    const skillMdPath = join(entrySrcPath, 'SKILL.md');
    if (await fileExists(skillMdPath)) {
      const content = await fsReadFile(skillMdPath, 'utf-8');
      const scope = getSkillScope(content);
      if (!shouldInstallSkill(scope)) {
        debug('install.skill_scope_excluded', { skill: entry, scope });
        continue;
      }
    }

    await copyDirectory(entrySrcPath, join(destPath, entry), {
      overwrite: !!(options.force || options.backup),
      preserveSymlinks: true,
      preserveTimestamps: true,
      trustedWriteRoot: options.targetDir,
    });
  }
}

/**
 * Install a single component
 */
async function installComponent(
  targetDir: string,
  component: InstallComponent,
  options: InstallOptions
): Promise<boolean> {
  if (component === 'entry-md') {
    return false;
  }

  if (component === 'hooks') {
    const overwrite = !!(options.force || options.backup);
    const installed = await installNativeCodexHooks(targetDir, {
      overwrite,
    });
    if (installed.installed) info('install.hooks_trust_review');
    return installed.installed;
  }

  const templatePath = getTemplateComponentPath(component);
  const destPath = join(targetDir, getComponentPath(component));
  const destExists = await fileExists(destPath);

  // Skip if exists and not forcing/backing up
  if (component !== 'agents' && destExists && !options.force && !options.backup) {
    debug('install.component_skipped', { component });
    return false;
  }

  const srcPath = resolveTemplatePath(templatePath);
  if (!(await fileExists(srcPath))) {
    warn('install.template_not_found', { component, path: srcPath });
    return false;
  }

  if (component === 'skills') {
    await installSkillsWithScopeFilter(srcPath, destPath, options);
  } else if (component === 'agents') {
    await syncNativeAgents({
      sourceDir: srcPath,
      destinationDir: destPath,
      targetRoot: targetDir,
      domain: options.domain,
    });
  } else {
    // Copy with symlink preservation for refs/ directories
    await copyDirectory(srcPath, destPath, {
      overwrite: !!(options.force || options.backup),
      preserveSymlinks: true,
      preserveTimestamps: true,
      trustedWriteRoot: targetDir,
    });
  }
  debug('install.component_installed', { component });
  return true;
}

/** Placeholder in entry doc templates replaced with detected git workflow */
const GIT_WORKFLOW_PLACEHOLDER = '<!-- omcodex:git-workflow -->';

/**
 * Render the git workflow section for the detected workflow and language
 */
function renderGitWorkflowSection(targetDir: string, language: 'en' | 'ko'): string {
  const result = detectGitWorkflow(targetDir) ?? getDefaultWorkflow();
  return language === 'ko' ? renderGitWorkflowKO(result) : renderGitWorkflowEN(result);
}

/**
 * Install entry doc with the selected language
 *
 * Reads the template, injects dynamic git workflow section, and writes to target.
 */
async function installEntryDoc(
  targetDir: string,
  language: 'en' | 'ko',
  overwrite = false
): Promise<boolean> {
  const layout = getProviderLayout();
  const templateFile = getEntryTemplateName(language);
  const srcPath = resolveTemplatePath(templateFile);
  const destPath = join(targetDir, layout.entryFile);

  // Check if source template exists
  if (!(await fileExists(srcPath))) {
    warn('install.entry_md_not_found', { language, path: srcPath, entry: layout.entryFile });
    return false;
  }

  // Check if destination exists and we're not overwriting
  const destExists = await fileExists(destPath);
  if (destExists && !overwrite) {
    debug('install.entry_md_skipped', { reason: 'exists', language, entry: layout.entryFile });
    return false;
  }

  // Read template, inject git workflow, write to destination
  let content = await fsReadFile(srcPath, 'utf-8');

  if (content.includes(GIT_WORKFLOW_PLACEHOLDER)) {
    const workflowSection = renderGitWorkflowSection(targetDir, language);
    content = content.replace(GIT_WORKFLOW_PLACEHOLDER, workflowSection);
  }

  await writeTextFile(destPath, content, { trustedWriteRoot: targetDir });
  debug('install.entry_md_installed', { language, entry: layout.entryFile });
  return true;
}

/**
 * Backup existing directory or file
 */
async function backupExisting(
  sourcePath: string,
  backupDir: string,
  trustedWriteRoot: string
): Promise<string> {
  const sourceStats = await lstat(sourcePath);
  if (sourceStats.isSymbolicLink()) {
    throw new Error(`Unsafe backup source: symbolic link "${sourcePath}"`);
  }

  const name = basename(sourcePath);
  const backupPath = join(backupDir, name);
  await prevalidateSafeWritePath(backupPath, trustedWriteRoot);

  await rename(sourcePath, backupPath);
  return backupPath;
}

/**
 * Check which installation paths already exist
 * Updated: paths now under provider root for official format
 */
async function checkExistingPaths(targetDir: string): Promise<string[]> {
  const layout = getProviderLayout();
  const pathsToCheck = [layout.entryFile, layout.rootDir, 'guides'];
  if (layout.provider === 'codex') {
    pathsToCheck.push('.agents');
  }

  const existingPaths: string[] = [];

  for (const relativePath of pathsToCheck) {
    const fullPath = join(targetDir, relativePath);
    if (await fileExists(fullPath)) {
      existingPaths.push(relativePath);
    }
  }

  return existingPaths;
}

/**
 * Backup existing installation files to a timestamped directory
 */
async function backupExistingInstallation(targetDir: string): Promise<string[]> {
  const layout = getProviderLayout();
  const existingPaths = await checkExistingPaths(targetDir);

  if (existingPaths.length === 0) {
    return [];
  }

  // Create backup directory with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(targetDir, `${layout.backupDirPrefix}${timestamp}`);
  await prevalidateSafeWritePath(join(backupDir, '.omcodex-backup-probe'), targetDir);

  for (const relativePath of existingPaths) {
    const fullPath = join(targetDir, relativePath);
    const sourceStats = await lstat(fullPath);
    if (sourceStats.isSymbolicLink()) {
      throw new Error(`Unsafe backup source: symbolic link "${fullPath}"`);
    }
    await prevalidateSafeWritePath(join(backupDir, basename(fullPath)), targetDir);
  }

  await ensureDirectory(backupDir);

  const backedUpPaths: string[] = [];

  for (const relativePath of existingPaths) {
    const fullPath = join(targetDir, relativePath);
    const backupPath = await backupExisting(fullPath, backupDir, targetDir);
    backedUpPaths.push(backupPath);
    debug('install.backed_up', { from: relativePath, to: backupPath });
  }

  return backedUpPaths.length > 0 ? [backupDir] : [];
}
