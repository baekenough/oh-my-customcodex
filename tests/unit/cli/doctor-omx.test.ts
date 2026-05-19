import { afterEach, describe, expect, it, mock } from 'bun:test';

const readyAssessment = {
  status: 'ready',
  installed: true,
  version: 'oh-my-codex v0.18.0',
  parsedVersion: '0.18.0',
  minimumVersion: '0.18.0',
  hasApiCommand: true,
};

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
      return {
        status: 'missing',
        installed: false,
        version: null,
        parsedVersion: null,
        minimumVersion: '0.18.0',
        hasApiCommand: false,
      };
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
    if (parsedVersion && compareMockOmxVersions(parsedVersion, '0.18.0') < 0) {
      return {
        status: 'stale',
        installed: true,
        version,
        parsedVersion,
        minimumVersion: '0.18.0',
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
        minimumVersion: '0.18.0',
        hasApiCommand: false,
      };
    }

    if (!parsedVersion && !hasApiCommand) {
      return {
        status: 'unknown-version',
        installed: true,
        version,
        parsedVersion: null,
        minimumVersion: '0.18.0',
        hasApiCommand: false,
      };
    }

    return {
      status: 'ready',
      installed: true,
      version,
      parsedVersion,
      minimumVersion: '0.18.0',
      hasApiCommand,
    };
  };
}

const omxInstallerMockBase = {
  MINIMUM_OMX_VERSION: '0.18.0',
  compareOmxVersions: compareMockOmxVersions,
  hasOmxApiCommand: () => true,
  isOmxInstalled: () => true,
  isOmxReady: () => true,
  isOmxVersionAtLeast: (version: string | null) => {
    const parsedVersion = parseMockOmxVersion(version);
    return parsedVersion !== null && compareMockOmxVersions(parsedVersion, '0.18.0') >= 0;
  },
  parseOmxVersion: parseMockOmxVersion,
  getOmxVersion: () => 'oh-my-codex v0.18.0',
};

describe('doctor OMX baseline checks', () => {
  afterEach(() => {
    mock.restore();
  });

  it('warns when OMX is below the required v0.18.0 baseline', async () => {
    mock.module('../../../src/core/omx-installer.js', () => ({
      ...omxInstallerMockBase,
      MINIMUM_OMX_VERSION: '0.18.0',
      assessOmxInstallation: assessOmxFromDepsOr(() => ({
        status: 'stale',
        installed: true,
        version: 'oh-my-codex v0.17.3',
        parsedVersion: '0.17.3',
        minimumVersion: '0.18.0',
        hasApiCommand: false,
      })),
      installOmx: () => true,
    }));

    const { checkOmx } = await import('../../../src/cli/doctor.js');
    const result = await checkOmx();

    expect(result.status).toBe('warn');
    expect(result.fixable).toBe(true);
    expect(result.message).toContain('v0.18.0');
  });

  it('warns when OMX is new enough but lacks omx api', async () => {
    mock.module('../../../src/core/omx-installer.js', () => ({
      ...omxInstallerMockBase,
      MINIMUM_OMX_VERSION: '0.18.0',
      assessOmxInstallation: assessOmxFromDepsOr(() => ({
        status: 'api-missing',
        installed: true,
        version: 'oh-my-codex v0.18.0',
        parsedVersion: '0.18.0',
        minimumVersion: '0.18.0',
        hasApiCommand: false,
      })),
      installOmx: () => true,
    }));

    const { checkOmx } = await import('../../../src/cli/doctor.js');
    const result = await checkOmx();

    expect(result.status).toBe('warn');
    expect(result.fixable).toBe(true);
    expect(result.message).toContain('omx api');
  });

  it('passes when OMX meets the baseline and exposes omx api', async () => {
    mock.module('../../../src/core/omx-installer.js', () => ({
      ...omxInstallerMockBase,
      MINIMUM_OMX_VERSION: '0.18.0',
      assessOmxInstallation: assessOmxFromDepsOr(() => readyAssessment),
      installOmx: () => true,
    }));

    const { checkOmx } = await import('../../../src/cli/doctor.js');
    const result = await checkOmx();

    expect(result.status).toBe('pass');
    expect(result.fixable).toBe(false);
    expect(result.message).toContain('omx api available');
  });
});
