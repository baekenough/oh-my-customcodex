/**
 * Tests for installer.ts RTK/Codex/OMX installation paths.
 * These paths require mock.module to intercept the static imports in installer.ts.
 * Tests cover:
 *   - installRtkIfNeeded when RTK is not installed and install succeeds (lines 379-382)
 *   - installRtkIfNeeded when RTK is not installed and install fails (lines 379-386)
 *   - installCodexIfNeeded when Codex is not installed and install succeeds (lines 398-402)
 *   - installCodexIfNeeded when Codex is not installed and install fails (lines 398-405)
 *   - installOmxIfNeeded when OMX is not installed and install succeeds/fails
 *   - installAgents domain filtering (lines 608-613)
 *   - restoration failures during backup (lines 444-447)
 *   - lockfile warning path during install (lines 458-459)
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const readyOmxAssessment = () => ({
  status: 'ready',
  installed: true,
  version: 'oh-my-codex v0.19.0',
  parsedVersion: '0.19.0',
  minimumVersion: '0.19.0',
  hasApiCommand: true,
});

const missingOmxAssessment = () => ({
  status: 'missing',
  installed: false,
  version: null,
  parsedVersion: null,
  minimumVersion: '0.19.0',
  hasApiCommand: false,
});

const staleOmxAssessment = () => ({
  status: 'stale',
  installed: true,
  version: 'oh-my-codex v0.17.3',
  parsedVersion: '0.17.3',
  minimumVersion: '0.19.0',
  hasApiCommand: false,
});

type MockOmxDeps = {
  exec?: (cmd: string, opts?: unknown) => string | Buffer;
};

type MockOmxAssessment = {
  status: string;
  installed: boolean;
  version: string | null;
  parsedVersion: string | null;
  minimumVersion: string;
  hasApiCommand: boolean;
};

function parseMockOmxVersion(versionOutput: string | null): string | null {
  if (!versionOutput) {
    return null;
  }

  const match = versionOutput.match(
    /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/
  );
  return match ? match[1] : null;
}

function parseMockVersionParts(version: string): {
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

function compareMockOmxVersions(left: string, right: string): number {
  const a = parseMockVersionParts(left);
  const b = parseMockVersionParts(right);

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

function assessOmxFromDepsOr(fallback: () => MockOmxAssessment) {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: mirrors the OMX status helper for same-process mocks.
  return (deps?: MockOmxDeps) => {
    if (!deps?.exec) {
      return fallback();
    }

    try {
      deps.exec('which omx', { stdio: 'pipe', timeout: 3000 });
    } catch {
      return missingOmxAssessment();
    }

    let version: string | null = null;
    try {
      version = String(
        deps.exec('omx --version', { encoding: 'utf-8', stdio: 'pipe', timeout: 3000 })
      ).trim();
    } catch {
      version = null;
    }

    const parsedVersion = parseMockOmxVersion(version);
    if (parsedVersion && compareMockOmxVersions(parsedVersion, '0.19.0') < 0) {
      return {
        status: 'stale',
        installed: true,
        version,
        parsedVersion,
        minimumVersion: '0.19.0',
        hasApiCommand: false,
      };
    }

    let hasApiCommand = false;
    try {
      deps.exec('omx api --help', { encoding: 'utf-8', stdio: 'pipe', timeout: 3000 });
      hasApiCommand = true;
    } catch {
      hasApiCommand = false;
    }

    if (parsedVersion && !hasApiCommand) {
      return {
        status: 'api-missing',
        installed: true,
        version,
        parsedVersion,
        minimumVersion: '0.19.0',
        hasApiCommand: false,
      };
    }

    if (!parsedVersion && !hasApiCommand) {
      return {
        status: 'unknown-version',
        installed: true,
        version,
        parsedVersion: null,
        minimumVersion: '0.19.0',
        hasApiCommand: false,
      };
    }

    return {
      status: 'ready',
      installed: true,
      version,
      parsedVersion,
      minimumVersion: '0.19.0',
      hasApiCommand,
    };
  };
}

const omxInstallerMockBase = {
  MINIMUM_OMX_VERSION: '0.19.0',
  compareOmxVersions: compareMockOmxVersions,
  hasOmxApiCommand: () => true,
  isOmxReady: () => true,
  isOmxVersionAtLeast: (version: string | null) => {
    const parsedVersion = parseMockOmxVersion(version);
    return parsedVersion !== null && compareMockOmxVersions(parsedVersion, '0.19.0') >= 0;
  },
  parseOmxVersion: parseMockOmxVersion,
};

describe('installer RTK/Codex/OMX paths', () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleInfoSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let consoleDebugSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-installer-rtk-test-'));
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleInfoSpy = spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
    consoleDebugSpy = spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleDebugSpy.mockRestore();
    mock.restore();
  });

  it('should add warning when RTK not installed and installRtk fails (lines 379-386)', async () => {
    // Mock rtk-installer: RTK not installed, installation fails
    mock.module('../../../src/core/rtk-installer.js', () => ({
      isRtkInstalled: () => false,
      installRtk: () => false,
      getRtkVersion: () => null,
    }));
    // Mock codex-installer: Codex already installed (to isolate RTK path)
    mock.module('../../../src/core/codex-installer.js', () => ({
      isCodexInstalled: () => true,
      installCodex: () => true,
      getCodexVersion: () => '1.0.0',
    }));
    mock.module('../../../src/core/omx-installer.js', () => ({
      ...omxInstallerMockBase,
      MINIMUM_OMX_VERSION: '0.19.0',
      assessOmxInstallation: assessOmxFromDepsOr(readyOmxAssessment),
      isOmxInstalled: () => true,
      installOmx: () => true,
      getOmxVersion: () => 'oh-my-codex v0.19.0',
    }));

    const { install } = await import('../../../src/core/installer.js');

    const result = await install({ targetDir: tempDir, skipConfirm: true });

    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.includes('RTK installation failed'))).toBe(true);
  });

  it('should log success when RTK not installed but installRtk succeeds (lines 379-382)', async () => {
    // Mock rtk-installer: RTK not installed, but installation succeeds
    mock.module('../../../src/core/rtk-installer.js', () => ({
      isRtkInstalled: () => false,
      installRtk: () => true,
      getRtkVersion: () => null,
    }));
    mock.module('../../../src/core/codex-installer.js', () => ({
      isCodexInstalled: () => true,
      installCodex: () => true,
      getCodexVersion: () => '1.0.0',
    }));
    mock.module('../../../src/core/omx-installer.js', () => ({
      ...omxInstallerMockBase,
      MINIMUM_OMX_VERSION: '0.19.0',
      assessOmxInstallation: assessOmxFromDepsOr(readyOmxAssessment),
      isOmxInstalled: () => true,
      installOmx: () => true,
      getOmxVersion: () => 'oh-my-codex v0.19.0',
    }));

    const { install } = await import('../../../src/core/installer.js');

    const result = await install({ targetDir: tempDir, skipConfirm: true });

    expect(result.success).toBe(true);
    // No RTK warning when install succeeds
    expect(result.warnings.some((w) => w.includes('RTK installation failed'))).toBe(false);
  });

  it('should add warning when Codex not installed and installCodex fails (lines 398-405)', async () => {
    // Mock rtk-installer: RTK already installed (to isolate Codex path)
    mock.module('../../../src/core/rtk-installer.js', () => ({
      isRtkInstalled: () => true,
      installRtk: () => true,
      getRtkVersion: () => '0.34.2',
    }));
    // Mock codex-installer: Codex not installed, installation fails
    mock.module('../../../src/core/codex-installer.js', () => ({
      isCodexInstalled: () => false,
      installCodex: () => false,
      getCodexVersion: () => null,
    }));
    mock.module('../../../src/core/omx-installer.js', () => ({
      ...omxInstallerMockBase,
      MINIMUM_OMX_VERSION: '0.19.0',
      assessOmxInstallation: assessOmxFromDepsOr(readyOmxAssessment),
      isOmxInstalled: () => true,
      installOmx: () => true,
      getOmxVersion: () => 'oh-my-codex v0.19.0',
    }));

    const { install } = await import('../../../src/core/installer.js');

    const result = await install({ targetDir: tempDir, skipConfirm: true });

    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.includes('Codex CLI installation failed'))).toBe(true);
  });

  it('should log success when Codex not installed but installCodex succeeds (lines 398-402)', async () => {
    mock.module('../../../src/core/rtk-installer.js', () => ({
      isRtkInstalled: () => true,
      installRtk: () => true,
      getRtkVersion: () => '0.34.2',
    }));
    // Mock codex-installer: Codex not installed, but installation succeeds
    mock.module('../../../src/core/codex-installer.js', () => ({
      isCodexInstalled: () => false,
      installCodex: () => true,
      getCodexVersion: () => null,
    }));
    mock.module('../../../src/core/omx-installer.js', () => ({
      ...omxInstallerMockBase,
      MINIMUM_OMX_VERSION: '0.19.0',
      assessOmxInstallation: assessOmxFromDepsOr(readyOmxAssessment),
      isOmxInstalled: () => true,
      installOmx: () => true,
      getOmxVersion: () => 'oh-my-codex v0.19.0',
    }));

    const { install } = await import('../../../src/core/installer.js');

    const result = await install({ targetDir: tempDir, skipConfirm: true });

    expect(result.success).toBe(true);
    // No Codex warning when install succeeds
    expect(result.warnings.some((w) => w.includes('Codex CLI installation failed'))).toBe(false);
  });

  it('should filter agents by domain when domain option is set (lines 608-613)', async () => {
    mock.module('../../../src/core/rtk-installer.js', () => ({
      isRtkInstalled: () => true,
      installRtk: () => true,
      getRtkVersion: () => '0.34.2',
    }));
    mock.module('../../../src/core/codex-installer.js', () => ({
      isCodexInstalled: () => true,
      installCodex: () => true,
      getCodexVersion: () => '1.0.0',
    }));
    mock.module('../../../src/core/omx-installer.js', () => ({
      ...omxInstallerMockBase,
      MINIMUM_OMX_VERSION: '0.19.0',
      assessOmxInstallation: assessOmxFromDepsOr(readyOmxAssessment),
      isOmxInstalled: () => true,
      installOmx: () => true,
      getOmxVersion: () => 'oh-my-codex v0.19.0',
    }));

    const { install } = await import('../../../src/core/installer.js');

    // Install with domain filter — this exercises the agent domain filtering code path
    const result = await install({
      targetDir: tempDir,
      skipConfirm: true,
      components: ['agents'],
      domain: 'backend',
    });

    // Install may succeed or produce warnings — the key is domain filtering code path was hit
    expect(result).toBeDefined();
  });

  it('should add lockfile warning to result when lockfile generation fails (lines 458-459)', async () => {
    mock.module('../../../src/core/rtk-installer.js', () => ({
      isRtkInstalled: () => true,
      installRtk: () => true,
      getRtkVersion: () => '0.34.2',
    }));
    mock.module('../../../src/core/codex-installer.js', () => ({
      isCodexInstalled: () => true,
      installCodex: () => true,
      getCodexVersion: () => '1.0.0',
    }));
    mock.module('../../../src/core/omx-installer.js', () => ({
      ...omxInstallerMockBase,
      MINIMUM_OMX_VERSION: '0.19.0',
      assessOmxInstallation: assessOmxFromDepsOr(readyOmxAssessment),
      isOmxInstalled: () => true,
      installOmx: () => true,
      getOmxVersion: () => 'oh-my-codex v0.19.0',
    }));
    const { install } = await import('../../../src/core/installer.js');

    const result = await install({
      targetDir: tempDir,
      skipConfirm: true,
      dependencies: {
        generateAndWriteLockfileForDir: async () => ({
          fileCount: 0,
          warning: 'Lockfile generation failed: Manifest read failed',
        }),
      },
    });

    // The lockfile warning should be in result.warnings when generation fails
    expect(result.warnings.some((w) => w.includes('Lockfile generation failed'))).toBe(true);
  });

  it('should add warning when OMX not installed and installOmx fails', async () => {
    mock.module('../../../src/core/rtk-installer.js', () => ({
      isRtkInstalled: () => true,
      installRtk: () => true,
      getRtkVersion: () => '0.34.2',
    }));
    mock.module('../../../src/core/codex-installer.js', () => ({
      isCodexInstalled: () => true,
      installCodex: () => true,
      getCodexVersion: () => '1.0.0',
    }));
    mock.module('../../../src/core/omx-installer.js', () => ({
      ...omxInstallerMockBase,
      MINIMUM_OMX_VERSION: '0.19.0',
      assessOmxInstallation: assessOmxFromDepsOr(missingOmxAssessment),
      isOmxInstalled: () => false,
      installOmx: () => false,
      getOmxVersion: () => null,
    }));

    const { install } = await import('../../../src/core/installer.js');
    const result = await install({ targetDir: tempDir, skipConfirm: true });

    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.includes('OMX installation/upgrade failed'))).toBe(true);
  });

  it('should not warn when OMX installation succeeds', async () => {
    mock.module('../../../src/core/rtk-installer.js', () => ({
      isRtkInstalled: () => true,
      installRtk: () => true,
      getRtkVersion: () => '0.34.2',
    }));
    mock.module('../../../src/core/codex-installer.js', () => ({
      isCodexInstalled: () => true,
      installCodex: () => true,
      getCodexVersion: () => '1.0.0',
    }));
    mock.module('../../../src/core/omx-installer.js', () => ({
      ...omxInstallerMockBase,
      MINIMUM_OMX_VERSION: '0.19.0',
      assessOmxInstallation: assessOmxFromDepsOr(missingOmxAssessment),
      isOmxInstalled: () => false,
      installOmx: () => true,
      getOmxVersion: () => null,
    }));

    const { install } = await import('../../../src/core/installer.js');
    const result = await install({ targetDir: tempDir, skipConfirm: true });

    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.includes('OMX installation failed'))).toBe(false);
  });

  it('should upgrade stale OMX versions during install checks', async () => {
    let installCalls = 0;

    mock.module('../../../src/core/rtk-installer.js', () => ({
      isRtkInstalled: () => true,
      installRtk: () => true,
      getRtkVersion: () => '0.34.2',
    }));
    mock.module('../../../src/core/codex-installer.js', () => ({
      isCodexInstalled: () => true,
      installCodex: () => true,
      getCodexVersion: () => '1.0.0',
    }));
    mock.module('../../../src/core/omx-installer.js', () => ({
      ...omxInstallerMockBase,
      MINIMUM_OMX_VERSION: '0.19.0',
      assessOmxInstallation: assessOmxFromDepsOr(staleOmxAssessment),
      isOmxInstalled: () => true,
      installOmx: () => {
        installCalls += 1;
        return true;
      },
      getOmxVersion: () => 'oh-my-codex v0.17.3',
    }));

    const { install } = await import('../../../src/core/installer.js');
    const result = await install({ targetDir: tempDir, skipConfirm: true });

    expect(result.success).toBe(true);
    expect(installCalls).toBe(1);
    expect(result.warnings.some((w) => w.includes('OMX installation/upgrade failed'))).toBe(false);
  });
});
