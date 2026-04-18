/**
 * Framework version drift detection for omcodex doctor
 */

import { readFile } from 'node:fs/promises';
import { getConfigCandidatePaths } from './config.js';

export interface FrameworkVersionResult {
  installed: string;
  latest: string;
  isOutdated: boolean;
  versionsBehind: number;
}

/**
 * Read installed framework version from the current harness rc file.
 */
export async function getInstalledVersion(targetDir: string): Promise<string | null> {
  for (const rcPath of getConfigCandidatePaths(targetDir)) {
    try {
      const content = JSON.parse(await readFile(rcPath, 'utf-8'));
      return content.version ?? null;
    } catch {
      // Try the next candidate path.
    }
  }
  return null;
}

/**
 * Calculate versions behind (semver minor diff within same major, or flag major drift).
 * For 0.x.y versioning, compares minor versions. Cross-major returns accumulated minor diff.
 */
export function calculateVersionsBehind(installed: string, latest: string): number {
  const [installedMajor, installedMinor] = installed.split('.').map(Number);
  const [latestMajor, latestMinor] = latest.split('.').map(Number);
  if (installedMajor > latestMajor) return 0;
  if (latestMajor > installedMajor) {
    // Cross-major: report major gap as significant drift
    return (latestMajor - installedMajor) * 100 + latestMinor;
  }
  return Math.max(0, latestMinor - installedMinor);
}

/**
 * Check framework version drift
 */
export async function checkFrameworkVersion(
  targetDir: string,
  latestVersion: string
): Promise<FrameworkVersionResult | null> {
  const installed = await getInstalledVersion(targetDir);
  if (!installed) return null;

  const versionsBehind = calculateVersionsBehind(installed, latestVersion);

  return {
    installed,
    latest: latestVersion,
    isOutdated: installed !== latestVersion,
    versionsBehind,
  };
}
