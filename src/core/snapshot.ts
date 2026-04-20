/**
 * Snapshot installation for oh-my-customcodex
 * Handles installing from a pre-configured team snapshot directory
 */

import { existsSync } from 'node:fs';
import { copyFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import packageJson from '../../package.json';
import { readLockFile, writeLockFile } from '../cli/projects.js';
import { i18n } from '../i18n/index.js';
import { fileExists } from '../utils/fs.js';
import { getComponentPath, getProviderLayout } from './layout.js';
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

/**
 * Check if provider root directory already exists
 */
async function checkExistingInstallation(targetDir: string): Promise<boolean> {
  const layout = getProviderLayout();
  const markers = [layout.entryFile, layout.rootDir];
  if (layout.provider === 'codex') {
    markers.push('.agents');
  }

  for (const marker of markers) {
    if (await fileExists(join(targetDir, marker))) {
      return true;
    }
  }

  return false;
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

function validateSnapshot(snapshotPath: string): { valid: true } | { valid: false; error: string } {
  if (!existsSync(snapshotPath)) {
    return { valid: false, error: `Snapshot path not found: ${snapshotPath}` };
  }

  const { layout, snapshotRuntime, snapshotSkills } = getSnapshotPaths(snapshotPath);
  if (!existsSync(snapshotRuntime) && !existsSync(snapshotSkills)) {
    return {
      valid: false,
      error: `Invalid snapshot: missing ${layout.rootDir}/ or ${getComponentPath('skills')} in ${snapshotPath}`,
    };
  }

  return { valid: true };
}

async function backupExistingInstallationForSnapshot(
  targetDir: string,
  snapshotPath: string
): Promise<void> {
  const { layout } = getSnapshotPaths(snapshotPath);

  const exists = await checkExistingInstallation(targetDir);
  if (!exists) return;

  console.log(i18n.t('cli.init.exists', { rootDir: layout.rootDir }));
  console.log(i18n.t('cli.init.backing_up'));

  const backupDir = join(
    targetDir,
    `${layout.backupDirPrefix}${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1)}`
  );

  if (existsSync(join(targetDir, layout.rootDir))) {
    await cp(join(targetDir, layout.rootDir), join(backupDir, layout.rootDir), { recursive: true });
  }
  if (existsSync(join(targetDir, '.agents'))) {
    await cp(join(targetDir, '.agents'), join(backupDir, '.agents'), { recursive: true });
  }
  if (existsSync(join(targetDir, layout.entryFile))) {
    await copyFile(join(targetDir, layout.entryFile), join(backupDir, layout.entryFile));
  }
  if (existsSync(join(targetDir, 'guides'))) {
    await cp(join(targetDir, 'guides'), join(backupDir, 'guides'), { recursive: true });
  }

  console.log(`  Backed up to: ${backupDir}`);
}

async function copySnapshotIntoTarget(targetDir: string, snapshotPath: string): Promise<void> {
  const { layout, snapshotRuntime, snapshotSkills, snapshotGuides, snapshotEntry } =
    getSnapshotPaths(snapshotPath);

  if (existsSync(snapshotRuntime)) {
    await cp(snapshotRuntime, join(targetDir, layout.rootDir), {
      recursive: true,
      force: true,
    });
  }

  if (existsSync(snapshotSkills)) {
    await cp(snapshotSkills, join(targetDir, getComponentPath('skills')), {
      recursive: true,
      force: true,
    });
  }

  if (existsSync(snapshotGuides)) {
    await cp(snapshotGuides, join(targetDir, 'guides'), {
      recursive: true,
      force: true,
    });
  }

  if (existsSync(snapshotEntry)) {
    await copyFile(snapshotEntry, join(targetDir, layout.entryFile));
  }
}

/**
 * Install from a pre-configured team snapshot
 */
export async function installFromSnapshot(
  targetDir: string,
  snapshotPath: string,
  options: InitOptions
): Promise<InitResult> {
  const snapshotValidation = validateSnapshot(snapshotPath);
  if (!snapshotValidation.valid) {
    return {
      success: false,
      message: i18n.t('cli.init.failed'),
      errors: [snapshotValidation.error],
    };
  }

  console.log(`Installing from snapshot: ${snapshotPath}`);

  try {
    if (!options.force) {
      await backupExistingInstallationForSnapshot(targetDir, snapshotPath);
    }

    await copySnapshotIntoTarget(targetDir, snapshotPath);

    // Update lock file
    try {
      const existing = await readLockFile(targetDir);
      await writeLockFile(targetDir, packageJson.version, existing);
    } catch {
      // Non-blocking
    }

    // Register project in the local registry (non-blocking)
    try {
      await registerProject(targetDir, packageJson.version);
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
