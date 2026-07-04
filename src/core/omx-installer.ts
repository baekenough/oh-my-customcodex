/**
 * OMX / oh-my-codex auto-installer
 */

// execSync is used here with fully hardcoded command strings (no user input),
// so there is no shell injection risk. Global npm install requires a shell.
import { type ExecSyncOptions, execSync } from 'node:child_process';
import { platform } from 'node:os';
import { info, warn } from '../utils/logger.js';

export const MINIMUM_OMX_VERSION = '0.18.17';

export interface InstallerDeps {
  exec: (cmd: string, opts?: ExecSyncOptions) => string | Buffer;
  getPlatform: () => NodeJS.Platform;
}

export type OmxInstallStatus = 'missing' | 'stale' | 'api-missing' | 'unknown-version' | 'ready';

export interface OmxInstallationAssessment {
  status: OmxInstallStatus;
  installed: boolean;
  version: string | null;
  parsedVersion: string | null;
  minimumVersion: string;
  hasApiCommand: boolean;
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

export function parseOmxVersion(versionOutput: string | null): string | null {
  if (!versionOutput) {
    return null;
  }

  const match = versionOutput.match(
    /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/
  );
  return match ? match[1] : null;
}

function parseVersionParts(version: string): {
  core: [number, number, number];
  prerelease: string | null;
} {
  const [withoutBuild] = version.split('+');
  const [coreText, prerelease = null] = withoutBuild.split('-', 2);
  const coreParts = coreText.split('.').map((part) => Number.parseInt(part, 10));

  return {
    core: [coreParts[0] ?? 0, coreParts[1] ?? 0, coreParts[2] ?? 0],
    prerelease,
  };
}

export function compareOmxVersions(left: string, right: string): number {
  const a = parseVersionParts(left);
  const b = parseVersionParts(right);

  for (let index = 0; index < 3; index += 1) {
    const diff = a.core[index] - b.core[index];
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  if (a.prerelease === b.prerelease) {
    return 0;
  }
  if (a.prerelease === null) {
    return 1;
  }
  if (b.prerelease === null) {
    return -1;
  }

  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

export function isOmxVersionAtLeast(
  version: string | null,
  minimumVersion: string = MINIMUM_OMX_VERSION
): boolean {
  const parsedVersion = parseOmxVersion(version);
  return parsedVersion !== null && compareOmxVersions(parsedVersion, minimumVersion) >= 0;
}

export function hasOmxApiCommand(deps: InstallerDeps = defaultDeps): boolean {
  try {
    deps.exec('omx api --help', {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

export function assessOmxInstallation(
  deps: InstallerDeps = defaultDeps
): OmxInstallationAssessment {
  if (!isOmxInstalled(deps)) {
    return {
      status: 'missing',
      installed: false,
      version: null,
      parsedVersion: null,
      minimumVersion: MINIMUM_OMX_VERSION,
      hasApiCommand: false,
    };
  }

  const version = getOmxVersion(deps);
  const parsedVersion = parseOmxVersion(version);

  if (parsedVersion && compareOmxVersions(parsedVersion, MINIMUM_OMX_VERSION) < 0) {
    return {
      status: 'stale',
      installed: true,
      version,
      parsedVersion,
      minimumVersion: MINIMUM_OMX_VERSION,
      hasApiCommand: false,
    };
  }

  const hasApi = hasOmxApiCommand(deps);

  if (parsedVersion && !hasApi) {
    return {
      status: 'api-missing',
      installed: true,
      version,
      parsedVersion,
      minimumVersion: MINIMUM_OMX_VERSION,
      hasApiCommand: false,
    };
  }

  if (!parsedVersion && !hasApi) {
    return {
      status: 'unknown-version',
      installed: true,
      version,
      parsedVersion: null,
      minimumVersion: MINIMUM_OMX_VERSION,
      hasApiCommand: false,
    };
  }

  return {
    status: 'ready',
    installed: true,
    version,
    parsedVersion,
    minimumVersion: MINIMUM_OMX_VERSION,
    hasApiCommand: hasApi,
  };
}

export function isOmxReady(deps: InstallerDeps = defaultDeps): boolean {
  return assessOmxInstallation(deps).status === 'ready';
}

export function installOmx(deps: InstallerDeps = defaultDeps): boolean {
  if (process.env.CI || process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test') {
    return false;
  }

  const current = assessOmxInstallation(deps);
  if (current.status === 'ready') {
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
    deps.exec('npm install -g oh-my-codex@latest', {
      stdio: 'inherit',
      timeout: 120000,
    });
    return isOmxReady(deps);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn('install.omx_install_failed', { error: message });
    return false;
  }
}
