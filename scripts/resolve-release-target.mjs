#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const RESOLVE_RELEASE_TARGET_USAGE = [
  'Usage:',
  '  node scripts/resolve-release-target.mjs [options]',
  '',
  'Options:',
  '  --package <name>          Public npm package (default: oh-my-customcodex)',
  '  --scoped-package <name>   GitHub Packages package (default: @baekenough/oh-my-customcodex)',
  '  --memory-version <x.y.z>  Advisory session-memory version',
  '  --expected-target <x.y.z> Assert the measured max-plus-patch target',
  '  --json                    Emit JSON (default)',
  '  --help                    Show this help',
  '',
].join('\n');

const STABLE_VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SOURCE_NAMES = ['git', 'npm', 'ghp'];
const REGISTRY_SOURCES = new Set(['npm', 'ghp']);
const ABSENCE_PROOF_FIELDS = {
  npm: 'npmPackageListVerified',
  ghp: 'githubPackagesListVerified',
};

export function parseStableVersion(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(STABLE_VERSION_PATTERN);
  if (!match) {
    return null;
  }

  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) {
    return null;
  }

  return { major, minor, patch };
}

function formatStableVersion(version) {
  return [version.major, version.minor, version.patch].join('.');
}

function normalizeStableVersion(value) {
  const parsed = parseStableVersion(value);
  return parsed ? formatStableVersion(parsed) : null;
}

export function compareStableVersions(left, right) {
  const parsedLeft = parseStableVersion(left);
  const parsedRight = parseStableVersion(right);
  if (!parsedLeft || !parsedRight) {
    throw new Error('Stable version comparison requires strict x.y.z releases.');
  }

  for (const key of ['major', 'minor', 'patch']) {
    if (parsedLeft[key] !== parsedRight[key]) {
      return parsedLeft[key] < parsedRight[key] ? -1 : 1;
    }
  }
  return 0;
}

function stableVersions(probe) {
  return [...new Set((probe.versions || []).map(normalizeStableVersion).filter(Boolean))].sort(
    compareStableVersions
  );
}

function validateProbe(source, probe) {
  if (!probe || typeof probe !== 'object') {
    throw new Error(`${source} probe is missing.`);
  }

  if (probe.status === 'verified-absent') {
    const proofField = ABSENCE_PROOF_FIELDS[source];
    if (
      !REGISTRY_SOURCES.has(source) ||
      probe.registryReachable !== true ||
      probe[proofField] !== true ||
      !Array.isArray(probe.versions) ||
      probe.versions.length !== 0
    ) {
      throw new Error(`${source} registry absence was not verified.`);
    }
    return;
  }

  if (probe.status !== 'ok') {
    throw new Error(
      `${source} probe failed closed with status ${String(probe.status || 'missing')}`
    );
  }

  if (!Array.isArray(probe.versions)) {
    throw new Error(`${source} probe parse-error: versions are not an array.`);
  }

  if (REGISTRY_SOURCES.has(source) && probe.versions.length === 0) {
    throw new Error(`${source} probe failed closed with status empty.`);
  }
}

function latestVersion(probe) {
  const versions = stableVersions(probe);
  return versions.length ? versions.at(-1) : null;
}

function publicProbeSummary(source, probe) {
  const result = {
    id: String(probe.id || 'unspecified'),
    status: probe.status,
    stableVersionCount: stableVersions(probe).length,
  };
  if (probe.status === 'verified-absent') {
    result.registryReachable = true;
    result[ABSENCE_PROOF_FIELDS[source]] = true;
  }
  return result;
}

function getValidatedProbes(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Release target input is required.');
  }
  const probes = input.probes || {};
  for (const source of SOURCE_NAMES) {
    validateProbe(source, probes[source]);
  }
  return probes;
}

function measuredVersionState(probes) {
  const latest = {
    git: latestVersion(probes.git),
    npm: latestVersion(probes.npm),
    ghp: latestVersion(probes.ghp),
  };
  const observed = Object.values(latest).filter(Boolean).sort(compareStableVersions);
  const baseVersion = observed.length ? observed.at(-1) : '0.0.0';
  return { latest, baseVersion };
}

function nextTargetVersion(baseVersion) {
  const parsedBase = parseStableVersion(baseVersion);
  return formatStableVersion({
    major: parsedBase.major,
    minor: parsedBase.minor,
    patch: parsedBase.patch + 1,
  });
}

function validateComputedTarget(targetVersion, probes) {
  for (const source of SOURCE_NAMES) {
    if (stableVersions(probes[source]).includes(targetVersion)) {
      throw new Error(`Computed target already exists in ${source}: ${targetVersion}`);
    }
  }
}

function validateExpectedTarget(expectedTarget, targetVersion) {
  if (expectedTarget === undefined) {
    return;
  }
  const normalized = normalizeStableVersion(expectedTarget);
  if (!normalized) {
    throw new Error('Expected target must be a strict stable x.y.z version.');
  }
  if (normalized !== targetVersion) {
    throw new Error(`Expected target mismatch: expected ${normalized}, measured ${targetVersion}.`);
  }
}

function memoryWarnings(memoryVersion, baseVersion) {
  const warnings = [];
  if (memoryVersion) {
    const normalized = normalizeStableVersion(memoryVersion);
    if (!normalized || normalized !== baseVersion) {
      warnings.push(
        'Session memory version is advisory and disagrees with measured registry evidence.'
      );
    }
  }
  return warnings;
}

export function resolveReleaseTarget(input) {
  const probes = getValidatedProbes(input);
  const { latest, baseVersion } = measuredVersionState(probes);
  const targetVersion = nextTargetVersion(baseVersion);
  validateComputedTarget(targetVersion, probes);
  validateExpectedTarget(input.expectedTarget, targetVersion);

  return {
    packageName: input.packageName || 'oh-my-customcodex',
    scopedPackageName: input.scopedPackageName || '@baekenough/oh-my-customcodex',
    measuredAt: input.measuredAt || new Date().toISOString(),
    sourceSha: String(input.sourceSha || ''),
    gitLatest: latest.git,
    npmLatest: latest.npm,
    ghpLatest: latest.ghp,
    baseVersion,
    targetVersion,
    probes: {
      git: publicProbeSummary('git', probes.git),
      npm: publicProbeSummary('npm', probes.npm),
      ghp: publicProbeSummary('ghp', probes.ghp),
    },
    warnings: memoryWarnings(input.memoryVersion, baseVersion),
  };
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

function parseJsonOutput(result, source) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${source} probe failed closed with status parse-error.`);
  }
}

function asVersionList(value) {
  if (typeof value === 'string') {
    return [value];
  }
  return Array.isArray(value) ? value : null;
}

function collectGitProbe(runner = run) {
  const tagsResult = runner('git', ['tag', '--list']);
  if (!tagsResult.ok) {
    throw new Error('git probe failed closed with status command-error.');
  }
  const shaResult = runner('git', ['rev-parse', 'HEAD']);
  if (!shaResult.ok || !shaResult.stdout.trim()) {
    throw new Error('git source SHA probe failed closed.');
  }
  return {
    sourceSha: shaResult.stdout.trim(),
    probe: {
      id: 'git-tags',
      status: 'ok',
      versions: tagsResult.stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    },
  };
}

export function collectNpmProbe(packageName, runner = run) {
  const publicRegistry = 'https://registry.npmjs.org';
  const versionsResult = runner('npm', [
    'view',
    packageName,
    'versions',
    '--json',
    '--registry',
    publicRegistry,
  ]);
  if (versionsResult.ok) {
    const versions = asVersionList(parseJsonOutput(versionsResult, 'npm'));
    if (!versions || versions.length === 0) {
      return { id: 'npm-public', status: 'empty', versions: [] };
    }
    return { id: 'npm-public', status: 'ok', versions };
  }

  if (/\bE404\b|\b404\b/i.test(versionsResult.stderr)) {
    const ping = runner('npm', ['ping', '--json', '--registry', publicRegistry]);
    if (!ping.ok) {
      return { id: 'npm-public', status: 'network-error', versions: [] };
    }
    return {
      id: 'npm-public',
      status: 'ambiguous-absence',
      versions: [],
      registryReachable: true,
      exactPackageNotFound: true,
    };
  }

  return {
    id: 'npm-public',
    status: versionsResult.error ? 'network-error' : 'registry-error',
    versions: [],
  };
}

function flattenPages(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => (Array.isArray(item) ? flattenPages(item) : [item]));
}

export function collectGitHubPackagesProbe(scopedPackageName, runner = run) {
  const match = String(scopedPackageName).match(/^@([^/]+)\/(.+)$/);
  if (!match) {
    return { id: 'github-packages-authenticated', status: 'parse-error', versions: [] };
  }
  const owner = match[1];
  const packageName = match[2];
  const versionsPath =
    '/users/' +
    encodeURIComponent(owner) +
    '/packages/npm/' +
    encodeURIComponent(packageName) +
    '/versions?per_page=100';
  const versionsResult = runner('gh', ['api', '--paginate', '--slurp', versionsPath]);

  if (versionsResult.ok) {
    const items = flattenPages(parseJsonOutput(versionsResult, 'ghp'));
    const versions = items.map((item) => item?.name).filter((name) => typeof name === 'string');
    if (versions.length === 0) {
      return { id: 'github-packages-authenticated', status: 'empty', versions: [] };
    }
    return { id: 'github-packages-authenticated', status: 'ok', versions };
  }

  if (!/\b404\b|not found/i.test(versionsResult.stderr)) {
    return {
      id: 'github-packages-authenticated',
      status: /auth|login|token|401|403/i.test(versionsResult.stderr)
        ? 'auth-error'
        : 'network-error',
      versions: [],
    };
  }

  const listPath = `/users/${encodeURIComponent(owner)}/packages?package_type=npm&per_page=100`;
  const listResult = runner('gh', ['api', '--paginate', '--slurp', listPath]);
  if (!listResult.ok) {
    return {
      id: 'github-packages-authenticated',
      status: /auth|login|token|401|403/i.test(listResult.stderr)
        ? 'auth-error'
        : /\b404\b|not found/i.test(listResult.stderr)
          ? 'package-list-error'
          : 'network-error',
      versions: [],
    };
  }
  const packages = flattenPages(parseJsonOutput(listResult, 'ghp'));
  const packageExists = packages.some((item) => item && item.name === packageName);
  if (packageExists) {
    return { id: 'github-packages-authenticated', status: 'empty', versions: [] };
  }
  return {
    id: 'github-packages-authenticated',
    status: 'verified-absent',
    versions: [],
    registryReachable: true,
    githubPackagesListVerified: true,
  };
}

export async function collectReleaseTarget(options = {}) {
  const packageName = options.packageName || 'oh-my-customcodex';
  const scopedPackageName = options.scopedPackageName || '@baekenough/oh-my-customcodex';
  const runner = options.runner || run;
  const git = collectGitProbe(runner);
  return resolveReleaseTarget({
    packageName,
    scopedPackageName,
    memoryVersion: options.memoryVersion,
    expectedTarget: options.expectedTarget,
    measuredAt: options.measuredAt || new Date().toISOString(),
    sourceSha: git.sourceSha,
    probes: {
      git: git.probe,
      npm: collectNpmProbe(packageName, runner),
      ghp: collectGitHubPackagesProbe(scopedPackageName, runner),
    },
  });
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      continue;
    }
    const fields = {
      '--package': 'packageName',
      '--scoped-package': 'scopedPackageName',
      '--memory-version': 'memoryVersion',
      '--expected-target': 'expectedTarget',
    };
    const field = fields[argument];
    if (!field || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
    options[field] = argv[index + 1];
    index += 1;
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    process.stdout.write(RESOLVE_RELEASE_TARGET_USAGE);
    return 0;
  }
  const result = await collectReleaseTarget(parseArguments(argv));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
