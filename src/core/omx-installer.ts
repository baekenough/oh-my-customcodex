/**
 * OMX / oh-my-codex auto-installer
 */

// execSync is used here with fully hardcoded command strings (no user input),
// so there is no shell injection risk. Global npm install requires a shell.
import { type ExecSyncOptions, execSync } from 'node:child_process';
import { platform } from 'node:os';
import { info, warn } from '../utils/logger.js';

export interface InstallerDeps {
  exec: (cmd: string, opts?: ExecSyncOptions) => string | Buffer;
  getPlatform: () => NodeJS.Platform;
}

const defaultDeps: InstallerDeps = {
  exec: execSync as InstallerDeps['exec'],
  getPlatform: platform,
};

export function isOmxInstalled(deps: InstallerDeps = defaultDeps): boolean {
  try {
    deps.exec('which omx', { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export function getOmxVersion(deps: InstallerDeps = defaultDeps): string | null {
  try {
    return (
      deps.exec('omx --version', {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 3000,
      }) as string
    ).trim();
  } catch {
    return null;
  }
}

export function installOmx(deps: InstallerDeps = defaultDeps): boolean {
  if (process.env.CI || process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test') {
    return false;
  }

  if (isOmxInstalled(deps)) {
    info('install.omx_already');
    return true;
  }

  const os = deps.getPlatform();
  if (!['darwin', 'linux', 'win32'].includes(os)) {
    warn('install.omx_install_failed', { error: `Unsupported OS: ${os}` });
    return false;
  }

  try {
    info('install.omx_installing');
    deps.exec('npm install -g oh-my-codex', {
      stdio: 'inherit',
      timeout: 120000,
    });
    return isOmxInstalled(deps);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn('install.omx_install_failed', { error: message });
    return false;
  }
}
