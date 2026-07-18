#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, constants, existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  assertPathContained,
  assertSafeEvidenceDestination,
  assertSafeExistingDirectory,
  createIsolatedExecutionRoots,
  finalizeEvidence,
  inspectCanonicalTrackedEntries,
  redactEvidenceText,
  replaceRegularFileAtomically,
  sha256,
} from './release-evidence-lib.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, '..');
const PUBLIC_PACKAGE = 'oh-my-customcodex';
const SCOPED_PACKAGE = '@baekenough/oh-my-customcodex';
const RELEASE_CREDENTIAL_NAMES = ['GH_TOKEN', 'GITHUB_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_TOKEN'];
const WORKFLOW_COMMAND_CHANNEL_NAMES = [
  'GITHUB_OUTPUT',
  'GITHUB_ENV',
  'GITHUB_PATH',
  'GITHUB_STATE',
  'GITHUB_STEP_SUMMARY',
];
const LIFECYCLE_CONTROL_NAMES = [
  'NODE_OPTIONS',
  'npm_config_node_options',
  'NPM_CONFIG_NODE_OPTIONS',
  'BUN_OPTIONS',
  'NODE_PATH',
  'npm_config_node_path',
  'NPM_CONFIG_NODE_PATH',
  'npm_config_userconfig',
  'NPM_CONFIG_USERCONFIG',
  'npm_config_globalconfig',
  'NPM_CONFIG_GLOBALCONFIG',
  'GH_CONFIG_DIR',
  'npm_config_script_shell',
  'NPM_CONFIG_SCRIPT_SHELL',
  'npm_config_registry',
  'NPM_CONFIG_REGISTRY',
  'GITHUB_WORKSPACE',
  'RUNNER_TEMP',
  'RUNNER_TOOL_CACHE',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CEILING_DIRECTORIES',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
];
const REQUIRED_TRACKED_SYMLINKS = [{ path: 'docs/plans/refs/latest', linkTarget: '../2025-01-25' }];
const REQUIRED_CANONICAL_LOCK_FILE_COUNT = 243;
// Canonicalization is index-only for this release. Any future generated input must be
// named here before it can cross into the standalone root.
const CANONICAL_GENERATED_ALLOWLIST = Object.freeze([]);
const STANDARD_IGNORED_BUILD_ROOTS = Object.freeze([
  'packages/serve/.svelte-kit',
  'packages/serve/build',
]);

export const VERIFY_RELEASE_HELP = `Usage: node scripts/verify-release-contract.mjs --mode <offline|live> \\
  [--version <x.y.z>] [--tag <vX.Y.Z>] [--expected-source-sha <sha>] \\
  [--repository <owner/repo>] --evidence-dir <path> \\
  [--canonical-lock-output <path>] [--live-input-dir <path>]\n\nOffline mode verifies the local built package without release-state queries.\nLive mode verifies an exact published tag from a trusted, script-disabled prefetch and requires --expected-source-sha.`;

export function parseVerifyReleaseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const value = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  return {
    help: false,
    mode: value('--mode'),
    version: value('--version'),
    tag: value('--tag'),
    expectedSourceSha: value('--expected-source-sha'),
    repository: value('--repository'),
    evidenceDir: value('--evidence-dir'),
    canonicalLockOutput: value('--canonical-lock-output'),
    liveInputDir: value('--live-input-dir'),
  };
}

function defaultRunCommand({ command, args = [], cwd, env }) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 128,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal ?? null,
  };
}

function strictVersion(value, label) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`${label} must be an exact stable x.y.z version`);
  }
  return value;
}

export function assertCanonicalLockContract({ generatedLock, priorLock, version }) {
  if (generatedLock.generatorVersion !== version || generatedLock.templateVersion !== version) {
    throw new Error('canonical lock version does not match the requested release version');
  }
  const generatedKeys = Object.keys(generatedLock.files ?? {}).sort();
  const expectedKeys = Object.keys(priorLock.files ?? {}).sort();
  if (generatedKeys.length !== REQUIRED_CANONICAL_LOCK_FILE_COUNT) {
    throw new Error(
      `canonical lock for v${version} must contain exactly ${REQUIRED_CANONICAL_LOCK_FILE_COUNT} files, received ${generatedKeys.length}`
    );
  }
  if (
    generatedKeys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(generatedLock.files, key))
  ) {
    throw new Error('canonical lock deleted or added an unreviewed managed entry');
  }
  if (Object.values(generatedLock.files).some((entry) => entry?.root !== undefined)) {
    throw new Error('canonical standalone lock contains an explicit root entry');
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function secretValues(env) {
  return [...new Set([...releaseCredentialNames(env), ...githubActionsCredentialNames(env)])]
    .map((name) => env[name])
    .filter((value) => typeof value === 'string' && value.length > 0);
}

function releaseCredentialNames(env) {
  return [...new Set([...RELEASE_CREDENTIAL_NAMES, ...Object.keys(env)])].filter(
    (name) =>
      RELEASE_CREDENTIAL_NAMES.includes(name) ||
      /^(?:GH|GITHUB)(?:_[A-Z0-9]+)*_(?:TOKEN|PAT)$/i.test(name) ||
      /^(?:NODE|NPM)(?:_[A-Z0-9]+)*_TOKEN$/i.test(name) ||
      /^NPM_CONFIG_.*(?:AUTH|TOKEN)/i.test(name)
  );
}

function githubActionsCredentialNames(env) {
  return Object.keys(env).filter(
    (name) =>
      /^(?:ACTIONS|GITHUB|GH)(?:_[A-Z0-9]+)*_(?:TOKEN|PAT|SECRET)$/i.test(name) ||
      /^ACTIONS_ID_TOKEN_REQUEST_TOKEN$/i.test(name)
  );
}

function lifecycleUnsafeEnvironmentNames(env) {
  return [
    ...new Set([
      ...releaseCredentialNames(env),
      ...githubActionsCredentialNames(env),
      ...WORKFLOW_COMMAND_CHANNEL_NAMES,
      ...LIFECYCLE_CONTROL_NAMES,
      ...Object.keys(env).filter((name) => /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/i.test(name)),
    ]),
  ];
}

function presentReleaseCredentialNames(env) {
  return releaseCredentialNames(env).filter(
    (name) => typeof env[name] === 'string' && env[name].length > 0
  );
}

function presentLiveParentUnsafeNames(env) {
  return [
    ...new Set([
      ...releaseCredentialNames(env),
      ...githubActionsCredentialNames(env),
      ...WORKFLOW_COMMAND_CHANNEL_NAMES,
      ...LIFECYCLE_CONTROL_NAMES,
      ...Object.keys(env).filter((name) => /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/i.test(name)),
    ]),
  ].filter((name) => typeof env[name] === 'string' && env[name].length > 0);
}

function withoutEnvironmentKeys(env, names) {
  const sanitized = { ...env };
  for (const name of names) delete sanitized[name];
  return sanitized;
}

function lifecycleSafeEnvironment(env) {
  return withoutEnvironmentKeys(env, lifecycleUnsafeEnvironmentNames(env));
}

function offlineEnvironment(env) {
  const present = presentReleaseCredentialNames(env);
  if (present.length > 0) {
    throw new Error(`offline mode rejects release credentials: ${present.join(', ')}`);
  }
  return withoutEnvironmentKeys(env, releaseCredentialNames(env));
}

function withoutCheckoutResolutionEnvironment(env) {
  return withoutEnvironmentKeys(env, ['NODE_PATH', 'npm_config_node_path', 'NPM_CONFIG_NODE_PATH']);
}

function safeCommandLabel(call) {
  return [
    basename(call.command),
    ...(call.args ?? []).map((value) => {
      const text = String(value);
      if (/token|auth|_authToken/i.test(text)) return '[REDACTED]';
      return text;
    }),
  ];
}

function parseGitIndex(stdout) {
  const entries = [];
  for (const record of stdout.split('\0')) {
    if (!record) continue;
    const match = record.match(/^(\d{6}) ([a-f0-9]+) (\d+)\t([\s\S]+)$/);
    if (!match) throw new Error('git ls-files --stage returned an unexpected record');
    if (match[3] !== '0') throw new Error('git index contains an unresolved staged entry');
    entries.push({ mode: match[1], oid: match[2], stage: 0, path: match[4] });
  }
  return entries;
}

function parseNulPaths(stdout) {
  return stdout.split('\0').filter(Boolean);
}

export function standardIgnoredRoot(path) {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  const knownRoot = STANDARD_IGNORED_BUILD_ROOTS.find(
    (root) => normalized === root || normalized.startsWith(`${root}/`)
  );
  if (knownRoot) return knownRoot;
  const segments = normalized.split('/').filter(Boolean);
  const rootIndex = segments.findIndex((segment) => ['node_modules', 'target'].includes(segment));
  return rootIndex === -1 ? null : segments.slice(0, rootIndex + 1).join('/');
}

async function invalidStandardIgnoredRoots(repoRoot, paths) {
  const roots = [...new Set(paths.map(standardIgnoredRoot).filter(Boolean))].sort();
  const invalid = [];
  for (const root of roots) {
    const candidate = join(repoRoot, ...root.split('/'));
    try {
      await assertPathContained(repoRoot, candidate, 'standard ignored root');
      const stats = await lstat(candidate);
      if (stats.isSymbolicLink() || !stats.isDirectory()) invalid.push(root);
    } catch {
      invalid.push(root);
    }
  }
  return invalid;
}

export function isSensitiveIgnoredPath(path) {
  const normalized = path.toLowerCase().replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  const basename = segments.at(-1) ?? '';
  if (
    segments[0] === '.omx' ||
    (segments[0] === '.codex' && segments[1] === 'outputs') ||
    segments.some((segment) => ['.ssh', '.aws', '.gnupg'].includes(segment))
  ) {
    return true;
  }
  if (standardIgnoredRoot(normalized)) return false;
  if (
    segments.some((segment) => ['state', '.state', 'logs', 'sessions'].includes(segment)) ||
    basename.endsWith('.log') ||
    /(?:^|[-_.])session(?:[-_.]|$)/.test(basename) ||
    /\.(?:sqlite|sqlite3|db)$/.test(basename)
  ) {
    return true;
  }
  const highSignalName =
    basename === '.env' ||
    basename.startsWith('.env.') ||
    ['.npmrc', '.yarnrc', '.pypirc', '.netrc', 'credentials.json', 'auth.json'].includes(
      basename
    ) ||
    /\.(?:pem|key|p12|pfx|jks|keystore)$/.test(basename);
  if (highSignalName) return true;
  if (
    segments.some((segment) => ['dist', 'coverage'].includes(segment)) ||
    normalized.includes('docs/.vitepress/cache/') ||
    normalized.includes('docs/.vitepress/dist/')
  ) {
    return false;
  }
  if (/^(?:config|settings)\.json$/.test(basename)) return true;
  return true;
}

async function commandGate({ name, call, runCommand, stagingDir, secrets, expected }) {
  const startedAt = new Date().toISOString();
  const before = Date.now();
  let result;
  let thrown;
  try {
    result = await runCommand(call);
  } catch (error) {
    thrown = error;
    result = {
      status: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
  const captured = redactEvidenceText(
    {
      command: safeCommandLabel(call),
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      error: thrown instanceof Error ? thrown.message : thrown ? String(thrown) : '',
    },
    { secrets }
  ).value;
  const log = `logs/${name}.log`;
  await mkdir(join(stagingDir, 'logs'), { recursive: true, mode: 0o700 });
  await writeFile(join(stagingDir, log), `${JSON.stringify(captured, null, 2)}\n`, { mode: 0o600 });
  const expectationPassed = expected ? expected(result) : result.status === 0;
  return {
    name,
    status: result.status === 0 && expectationPassed ? 'PASS' : 'FAIL',
    startedAt,
    durationMs: Date.now() - before,
    log,
    logSha256: sha256(await readFile(join(stagingDir, log))),
    result,
  };
}

async function retryCommandGate(options, { attempts = 3, delayMs = 20_000, sleep } = {}) {
  let gate;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    gate = await commandGate(options);
    gate.attempts = attempt;
    if (gate.status === 'PASS') return gate;
    const diagnostic = `${gate.result.stdout}\n${gate.result.stderr}`;
    if (/\b(?:401|403|E401|E403)\b|unauthorized|forbidden|authentication/i.test(diagnostic)) {
      return gate;
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  return gate;
}

function publicGate(gate) {
  const { result: _result, ...record } = gate;
  return record;
}

async function recordedGate({ name, status, stagingDir, details, startedAt, before, ...metadata }) {
  const log = `logs/${name}.log`;
  await mkdir(join(stagingDir, 'logs'), { recursive: true, mode: 0o700 });
  await writeFile(join(stagingDir, log), `${JSON.stringify(details, null, 2)}\n`, { mode: 0o600 });
  return {
    name,
    status,
    startedAt,
    durationMs: Date.now() - before,
    log,
    logSha256: sha256(await readFile(join(stagingDir, log))),
    ...metadata,
  };
}

async function credentialAbsenceGate({ repoRoot, baseEnv, runCommand, stagingDir }) {
  const startedAt = new Date().toISOString();
  const before = Date.now();
  let result;
  let commandError = false;
  try {
    result = await runCommand({
      label: 'checkout-local-credentials',
      command: 'git',
      args: [
        'config',
        '--local',
        '--get-regexp',
        '^(http(\\..*)?\\.extraheader|credential(\\..*)?\\.(helper|username|password|token))$',
      ],
      cwd: repoRoot,
      env: lifecycleSafeEnvironment(baseEnv),
    });
    commandError = result.signal !== undefined && result.signal !== null;
  } catch {
    commandError = true;
    result = { status: 128, stdout: '', stderr: '' };
  }
  const credentialEntryPresent = result.status === 0 || Boolean(result.stdout?.trim());
  const passed = !commandError && result.status === 1 && !credentialEntryPresent;
  return recordedGate({
    name: 'checkout-local-credentials',
    status: passed ? 'PASS' : 'FAIL',
    stagingDir,
    details: {
      exitStatus: result.status,
      credentialEntryPresent,
      commandError,
    },
    startedAt,
    before,
  });
}

async function versionSyncGate(repoRoot, version, stagingDir) {
  const sources = {
    package: (await readJson(join(repoRoot, 'package.json'))).version,
    template: (await readJson(join(repoRoot, 'templates', 'manifest.json'))).version,
    plugin: (
      await readJson(join(repoRoot, 'plugins', 'oh-my-customcodex', '.codex-plugin', 'plugin.json'))
    ).version,
  };
  const log = 'logs/version-sync.log';
  await mkdir(join(stagingDir, 'logs'), { recursive: true, mode: 0o700 });
  await writeFile(join(stagingDir, log), `${JSON.stringify(sources, null, 2)}\n`, { mode: 0o600 });
  return {
    name: 'version-sync',
    status: Object.values(sources).every((value) => value === version) ? 'PASS' : 'FAIL',
    startedAt: new Date().toISOString(),
    durationMs: 0,
    log,
    logSha256: sha256(await readFile(join(stagingDir, log))),
  };
}

function parseJsonOrScalar(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value.trim();
  }
}

function exactMetadataMatches(value, packageName, version, fixtureMode) {
  const parsed = parseJsonOrScalar(value);
  if (typeof parsed === 'string') return fixtureMode && parsed === version;
  return parsed?.name === packageName && parsed?.version === version;
}

async function inventoryInstalledPackage(packageRoot) {
  const files = [];
  async function walk(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      const stats = await lstat(path);
      if (stats.isDirectory()) {
        await walk(path, relativePath);
      } else if (stats.isSymbolicLink()) {
        files.push({ path: relativePath, type: 'symlink', target: await readlink(path) });
      } else if (stats.isFile()) {
        files.push({
          path: relativePath,
          type: 'file',
          mode: stats.mode & 0o777,
          sha256: sha256(await readFile(path)),
        });
      } else {
        throw new Error(`unsupported installed package entry: ${relativePath}`);
      }
    }
  }
  await walk(packageRoot);
  return {
    packageJson: await readJson(join(packageRoot, 'package.json')),
    files,
  };
}

async function writeLiveConsumerProbe(execution, packageName, version, repoRoot) {
  const probePath = join(execution.cwd, 'release-consumer-probe.mjs');
  await writeFile(
    probePath,
    `import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageName = ${JSON.stringify(packageName)};
const expectedVersion = ${JSON.stringify(version)};
const checkoutRoot = realpathSync(${JSON.stringify(repoRoot)});
const entryPath = fileURLToPath(import.meta.resolve(packageName));
let packageRoot = dirname(entryPath);
while (!existsSync(join(packageRoot, 'package.json'))) {
  const parent = dirname(packageRoot);
  assert.notEqual(parent, packageRoot);
  packageRoot = parent;
}
packageRoot = realpathSync(packageRoot);
const checkoutRelative = relative(checkoutRoot, packageRoot);
assert(checkoutRelative.startsWith('..') || checkoutRelative === '', 'consumer resolved the checkout package');
assert.notEqual(checkoutRelative, '', 'consumer resolved the checkout package');
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
assert.equal(packageJson.name, packageName);
assert.equal(packageJson.version, expectedVersion);
const api = await import(pathToFileURL(join(packageRoot, 'dist', 'index.js')).href);
assert.equal(api.VERSION, expectedVersion);
assert(existsSync(api.resolveTemplatePath('manifest.json')));

const fixture = join(process.cwd(), 'foreign-pretooluse');
const sentinel = join(fixture, 'foreign-command-ran');
const foreignGroup = {
  matcher: '^Bash$',
  owner: 'release-verifier-foreign',
  hooks: [{ type: 'command', command: 'printf should-not-run > ' + JSON.stringify(sentinel), timeout: 7 }],
};
await mkdir(join(fixture, '.codex'), { recursive: true });
await writeFile(join(fixture, '.codex', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [foreignGroup] } }, null, 2));
const first = await api.install({ targetDir: fixture, components: ['hooks'], force: true, skipConfirm: true });
assert.equal(first.success, true, first.error);
const firstRegistry = await readFile(join(fixture, '.codex', 'hooks.json'), 'utf8');
const parsed = JSON.parse(firstRegistry);
const projectForeignGroups = (registryText) =>
  JSON.parse(registryText)
    .hooks.PreToolUse.slice(0, 1)
    .map((group) => ({
      ...group,
      hooks: group.hooks.filter(
        (hook) =>
          !(typeof hook.command === 'string' && hook.command.includes('# omcustomcodex-hook:'))
      ),
    }));
const managedMarkers = ${JSON.stringify([
      'destructive-git-guard.sh',
      'file-change-validator.sh',
      'schema-validator.sh',
      'secret-filter.sh',
      'shell-reserved-var-advisor.sh',
    ])};
const assertManagedMarkersExactlyOnce = (registryText) => {
  const observed = Object.values(JSON.parse(registryText).hooks)
    .flatMap((groups) => groups)
    .flatMap((group) => group.hooks)
    .map((hook) =>
      typeof hook.command === 'string'
        ? hook.command.match(/# omcustomcodex-hook:([^\\s#]+\\.sh)\\s*$/)?.[1]
        : undefined
    )
    .filter(Boolean);
  assert.deepEqual([...new Set(observed)].sort(), [...managedMarkers].sort());
  for (const marker of managedMarkers) {
    assert.equal(observed.filter((value) => value === marker).length, 1);
  }
};
assert.deepEqual(projectForeignGroups(firstRegistry), [foreignGroup]);
assertManagedMarkersExactlyOnce(firstRegistry);
assert.equal(existsSync(sentinel), false);
assert(JSON.stringify(parsed).includes('shell-reserved-var-advisor.sh'));
const firstUpdate = await api.update({ targetDir: fixture, components: ['hooks'], force: true });
assert.equal(firstUpdate.success, true, firstUpdate.error);
const registryAfterFirstUpdate = await readFile(join(fixture, '.codex', 'hooks.json'), 'utf8');
assert.deepEqual(projectForeignGroups(registryAfterFirstUpdate), [foreignGroup]);
assertManagedMarkersExactlyOnce(registryAfterFirstUpdate);
const secondUpdate = await api.update({ targetDir: fixture, components: ['hooks'], force: true });
assert.equal(secondUpdate.success, true, secondUpdate.error);
assert.equal(await readFile(join(fixture, '.codex', 'hooks.json'), 'utf8'), registryAfterFirstUpdate);
assertManagedMarkersExactlyOnce(registryAfterFirstUpdate);
assert.equal(existsSync(sentinel), false);
console.log(JSON.stringify({ packageName, version: api.VERSION, packageRoot }));
`,
    { mode: 0o600 }
  );
  return probePath;
}

async function writeParityEvidence(stagingDir, inventories) {
  const startedAt = new Date().toISOString();
  const before = Date.now();
  await writeFile(
    join(stagingDir, 'inventory-unscoped.json'),
    `${JSON.stringify(inventories.unscoped, null, 2)}\n`,
    { mode: 0o600 }
  );
  await writeFile(
    join(stagingDir, 'inventory-scoped.json'),
    `${JSON.stringify(inventories.scoped, null, 2)}\n`,
    { mode: 0o600 }
  );
  const unscopedFiles = inventories.unscoped.files.filter(({ path }) => path !== 'package.json');
  const scopedFiles = inventories.scoped.files.filter(({ path }) => path !== 'package.json');
  const normalizedScoped = {
    ...inventories.scoped.packageJson,
    name: inventories.unscoped.packageJson.name,
    publishConfig: inventories.unscoped.packageJson.publishConfig,
  };
  const parity = {
    pathsAndBytesEqual: isDeepStrictEqual(scopedFiles, unscopedFiles),
    metadataEqual: isDeepStrictEqual(normalizedScoped, inventories.unscoped.packageJson),
    approvedDifferences: ['name', 'publishConfig'],
  };
  await writeFile(join(stagingDir, 'parity.json'), `${JSON.stringify(parity, null, 2)}\n`, {
    mode: 0o600,
  });
  const log = 'logs/registry-parity.log';
  await mkdir(join(stagingDir, 'logs'), { recursive: true });
  await writeFile(join(stagingDir, log), `${JSON.stringify(parity, null, 2)}\n`, { mode: 0o600 });
  return {
    name: 'registry-installed-parity',
    status: parity.pathsAndBytesEqual && parity.metadataEqual ? 'PASS' : 'FAIL',
    startedAt,
    durationMs: Date.now() - before,
    log,
    logSha256: sha256(await readFile(join(stagingDir, log))),
  };
}

async function materializeTrustedArtifact(execution, artifact, name) {
  const localPath = join(execution.cwd, `release-artifact-${name}-${randomUUID()}.tgz`);
  await writeFile(localPath, artifact.bytes, { flag: 'wx', mode: 0o400 });
  const localBytes = await readFile(localPath);
  if (sha256(localBytes) !== artifact.sha256) {
    throw new Error(`trusted ${name} artifact changed during isolated materialization`);
  }
  return localPath;
}

async function createLiveProbeFakeTools(execution) {
  const toolRoot = join(execution.root, `live-probe-tools-${randomUUID()}`);
  await mkdir(toolRoot, { mode: 0o700 });
  await Promise.all([
    writeFile(join(toolRoot, 'rtk'), '#!/bin/sh\nexit 0\n', { mode: 0o755 }),
    writeFile(join(toolRoot, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 }),
    writeFile(
      join(toolRoot, 'omx'),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  printf "oh-my-codex v0.20.2\\n"\nfi\nexit 0\n',
      { mode: 0o755 }
    ),
  ]);
  return toolRoot;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Each consumer smoke is recorded as a distinct fail-closed release gate.
async function verifyLiveConsumers({
  repoRoot,
  version,
  runCommand,
  stagingDir,
  secrets,
  baseEnv,
  artifacts,
}) {
  const executionRoot = await mkdtemp(join(tmpdir(), 'omcustomcodex-release-live-'));
  const gates = [];
  try {
    const contexts = await createIsolatedExecutionRoots({
      baseDir: executionRoot,
      repositoryRoot: repoRoot,
      baseEnv: lifecycleSafeEnvironment(baseEnv),
    });
    const inventories = {};
    for (const [name, packageName, execution, artifact] of [
      ['unscoped', PUBLIC_PACKAGE, contexts.unscoped, artifacts.unscoped],
      ['scoped', SCOPED_PACKAGE, contexts.scoped, artifacts.scoped],
    ]) {
      await writeFile(join(execution.cwd, 'package.json'), '{"private":true,"type":"module"}\n', {
        mode: 0o600,
      });
      const artifactStartedAt = new Date().toISOString();
      const artifactBefore = Date.now();
      const artifactPath = await materializeTrustedArtifact(execution, artifact, name);
      const fakeToolRoot = await createLiveProbeFakeTools(execution);
      execution.env.PATH = `${fakeToolRoot}${delimiter}${execution.env.PATH ?? ''}`;
      const artifactGate = await recordedGate({
        name: `consumer-${name}-local-artifact`,
        status: 'PASS',
        stagingDir,
        details: { file: basename(artifactPath), sha256: artifact.sha256 },
        startedAt: artifactStartedAt,
        before: artifactBefore,
      });
      gates.push(artifactGate);

      const lifecycleEnv = execution.env;
      const install = await commandGate({
        name: `consumer-${name}-install`,
        call: {
          label: `consumer-${name}-install`,
          command: 'npm',
          args: ['install', '--no-audit', '--no-fund', '--no-package-lock', artifactPath],
          cwd: execution.cwd,
          env: lifecycleEnv,
        },
        runCommand,
        stagingDir,
        secrets,
      });
      gates.push(publicGate(install));
      if (install.status !== 'PASS') {
        for (const smoke of ['version', 'help', 'esm-hooks-foreign', 'doctor']) {
          gates.push({
            name: `consumer-${name}-${smoke}`,
            status: 'SKIPPED',
            reason: 'exact package install failed',
            durationMs: 0,
            log: install.log,
          });
        }
        continue;
      }

      const artifactAfterStartedAt = new Date().toISOString();
      const artifactAfterBefore = Date.now();
      const artifactAfterHash = sha256(await readFile(artifactPath));
      const artifactAfterGate = await recordedGate({
        name: `consumer-${name}-local-artifact-after`,
        status: artifactAfterHash === artifact.sha256 ? 'PASS' : 'FAIL',
        stagingDir,
        details: {
          file: basename(artifactPath),
          expectedSha256: artifact.sha256,
          artifactAfterHash,
        },
        startedAt: artifactAfterStartedAt,
        before: artifactAfterBefore,
      });
      gates.push(artifactAfterGate);
      if (artifactAfterGate.status !== 'PASS') continue;

      const bin = join(execution.cwd, 'node_modules', '.bin', 'omcustomcodex');
      const probePath = await writeLiveConsumerProbe(execution, packageName, version, repoRoot);
      for (const [smoke, command, args, expected] of [
        ['version', bin, ['--version'], (result) => result.stdout.trim() === version],
        ['help', bin, ['--help'], (result) => /Usage:/.test(result.stdout)],
        ['esm-hooks-foreign', process.execPath, [probePath], undefined],
        [
          'doctor',
          bin,
          ['--skip-version-check', 'doctor'],
          (result) => !/\n\s+at\s+\S+|Error:\s/.test(`${result.stdout}\n${result.stderr}`),
        ],
      ]) {
        const gate = await commandGate({
          name: `consumer-${name}-${smoke}`,
          call: {
            label: `consumer-${name}-${smoke}`,
            command,
            args,
            cwd: execution.cwd,
            env: lifecycleEnv,
          },
          runCommand,
          stagingDir,
          secrets,
          expected,
        });
        gates.push(publicGate(gate));
      }
      const installedRoot = join(execution.cwd, 'node_modules', packageName);
      inventories[name] = await inventoryInstalledPackage(await realpath(installedRoot));
    }
    if (inventories.unscoped && inventories.scoped) {
      gates.push(await writeParityEvidence(stagingDir, inventories));
    }
    return gates;
  } finally {
    await rm(executionRoot, { recursive: true, force: true });
  }
}

function requiredOfflineAliases(packageGate) {
  return [
    'lifecycle-scripts-enabled',
    'registry-artifact-parity',
    'cli-and-esm-smoke',
    'doctor-smoke',
    'foreign-pretooluse-preservation',
  ].map((name) => ({
    name,
    status: packageGate.status,
    importedFrom: 'package-contract',
    startedAt: packageGate.startedAt,
    durationMs: packageGate.durationMs,
    log: packageGate.log,
    logSha256: packageGate.logSha256,
  }));
}

async function validateTrackedEntries({
  repoRoot,
  entries,
  stagingDir,
  fixtureMode,
  preconditionError,
}) {
  const startedAt = new Date().toISOString();
  const before = Date.now();
  let inventory = [];
  let error = preconditionError;
  if (!fixtureMode && !error) {
    try {
      inventory = await inspectCanonicalTrackedEntries({
        sourceRoot: repoRoot,
        entries,
        requiredSymlinks: REQUIRED_TRACKED_SYMLINKS,
      });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }
  await writeFile(
    join(stagingDir, 'tracked-entry-types.json'),
    `${JSON.stringify(inventory, null, 2)}\n`,
    { mode: 0o600 }
  );
  const gate = await recordedGate({
    name: 'tracked-entry-types',
    status: error ? 'FAIL' : 'PASS',
    stagingDir,
    details: { fixtureMode, error: error ?? null, entries: inventory },
    startedAt,
    before,
  });
  return { gate, inventory };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Every repository trust-boundary check remains an explicit pre-execution gate.
async function runOfflineRepositoryPreflight(context) {
  const { repoRoot, stagingDir, runCommand, secrets, fixtureMode, baseEnv } = context;
  const gates = [];
  let entries = [];
  let indexError;
  let unexpectedExtras = [];
  let ignoredExtras = [];
  let sensitiveIgnoredExtras = [];
  let invalidIgnoredRoots = [];
  let extrasError;

  if (!fixtureMode) {
    const indexGate = await commandGate({
      name: 'git-index',
      call: {
        label: 'git-index',
        command: 'git',
        args: ['ls-files', '--stage', '-z'],
        cwd: repoRoot,
        env: baseEnv,
      },
      runCommand,
      stagingDir,
      secrets,
    });
    gates.push(publicGate(indexGate));
    if (indexGate.status === 'PASS') {
      try {
        entries = parseGitIndex(indexGate.result.stdout);
      } catch (error) {
        indexError = error instanceof Error ? error.message : String(error);
      }
    } else {
      indexError = 'git index inventory command failed';
    }

    const worktreeDriftGate = await commandGate({
      name: 'git-worktree-index-drift',
      call: {
        label: 'git-worktree-index-drift',
        command: 'git',
        args: ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', '--'],
        cwd: repoRoot,
        env: baseEnv,
      },
      runCommand,
      stagingDir,
      secrets,
      expected: (result) =>
        parseNulPaths(result.stdout).every((path) => path === '.omcodex.lock.json'),
    });
    gates.push(publicGate(worktreeDriftGate));
    if (worktreeDriftGate.status !== 'PASS') {
      indexError = 'tracked working-tree drift exceeds the canonical lock exception';
    }

    const extrasCommandGate = await commandGate({
      name: 'git-untracked-extras',
      call: {
        label: 'git-untracked-extras',
        command: 'git',
        args: ['ls-files', '--others', '--exclude-standard', '-z'],
        cwd: repoRoot,
        env: baseEnv,
      },
      runCommand,
      stagingDir,
      secrets,
    });
    gates.push(publicGate(extrasCommandGate));
    if (extrasCommandGate.status === 'PASS') {
      unexpectedExtras = parseNulPaths(extrasCommandGate.result.stdout).filter(
        (path) => !CANONICAL_GENERATED_ALLOWLIST.includes(path)
      );
      if (unexpectedExtras.length > 0) {
        extrasError = 'unreviewed non-index paths remain before canonicalization';
      }
    } else {
      extrasError = 'untracked canonical-extra inventory command failed';
    }

    const ignoredExtrasCommandGate = await commandGate({
      name: 'git-ignored-extras',
      call: {
        label: 'git-ignored-extras',
        command: 'git',
        args: ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'],
        cwd: repoRoot,
        env: baseEnv,
      },
      runCommand,
      stagingDir,
      secrets,
    });
    gates.push(publicGate(ignoredExtrasCommandGate));
    if (ignoredExtrasCommandGate.status === 'PASS') {
      ignoredExtras = parseNulPaths(ignoredExtrasCommandGate.result.stdout);
      invalidIgnoredRoots = await invalidStandardIgnoredRoots(repoRoot, ignoredExtras);
      sensitiveIgnoredExtras = ignoredExtras.filter(isSensitiveIgnoredPath);
      if (invalidIgnoredRoots.length > 0) {
        extrasError = 'standard ignored roots must be real directories inside the repository';
      } else if (sensitiveIgnoredExtras.length > 0) {
        extrasError = 'sensitive ignored non-index paths remain before canonicalization';
      }
    } else {
      extrasError = 'ignored canonical-extra inventory command failed';
    }
  }

  const extrasStartedAt = new Date().toISOString();
  const extrasBefore = Date.now();
  const canonicalExtrasGate = await recordedGate({
    name: 'canonical-extra-files',
    status: extrasError ? 'FAIL' : 'PASS',
    stagingDir,
    details: {
      fixtureMode,
      generatedAllowlist: CANONICAL_GENERATED_ALLOWLIST,
      unexpectedExtras,
      ignoredExtras,
      invalidIgnoredRoots,
      sensitiveIgnoredExtras,
      error: extrasError ?? null,
    },
    startedAt: extrasStartedAt,
    before: extrasBefore,
  });
  gates.push(canonicalExtrasGate);

  const tracked = await validateTrackedEntries({
    repoRoot,
    entries,
    stagingDir,
    fixtureMode,
    preconditionError: indexError,
  });
  gates.push(tracked.gate);
  return { gates, entries, canonicalExtrasGate, tracked };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The offline verifier records each required fail-closed release subgate explicitly.
async function runOffline(options, context) {
  const { repoRoot, stagingDir, runCommand, secrets, fixtureMode, baseEnv } = context;
  const packageJson = await readJson(join(repoRoot, 'package.json'));
  const version = strictVersion(options.version ?? packageJson.version, '--version');
  const gates = [];
  const executionRoot = await mkdtemp(join(tmpdir(), 'omcustomcodex-release-offline-'));
  try {
    const preflight = await runOfflineRepositoryPreflight(context);
    gates.push(...preflight.gates);
    gates.push(await versionSyncGate(repoRoot, version, stagingDir));

    let isolated;
    let isolatedGate;
    if (gates.every(({ status }) => status === 'PASS')) {
      isolated = await createIsolatedExecutionRoots({
        baseDir: executionRoot,
        repositoryRoot: repoRoot,
        baseEnv,
      });
      const isolatedStartedAt = new Date().toISOString();
      const isolatedBefore = Date.now();
      const distinct =
        new Set([isolated.repository.cwd, isolated.unscoped.cwd, isolated.scoped.cwd]).size === 3;
      isolatedGate = await recordedGate({
        name: 'isolated-consumer-environments',
        status: distinct ? 'PASS' : 'FAIL',
        stagingDir,
        details: {
          repository: isolated.repository.cwd,
          unscoped: isolated.unscoped.cwd,
          scoped: isolated.scoped.cwd,
        },
        startedAt: isolatedStartedAt,
        before: isolatedBefore,
      });
    } else {
      isolatedGate = {
        name: 'isolated-consumer-environments',
        status: 'SKIPPED',
        reason: 'repository preflight failed before lifecycle execution',
        durationMs: 0,
      };
    }
    gates.push(isolatedGate);

    let packageGate;
    if (gates.every(({ status }) => status === 'PASS')) {
      packageGate = publicGate(
        await commandGate({
          name: 'package-contract',
          call: {
            label: 'package-contract',
            command: process.execPath,
            args: [join(repoRoot, 'scripts', 'verify-package-contract.mjs'), '--skip-build'],
            cwd: repoRoot,
            env: withoutCheckoutResolutionEnvironment(isolated.repository.env),
          },
          runCommand,
          stagingDir,
          secrets,
        })
      );
    } else {
      packageGate = {
        name: 'package-contract',
        status: 'SKIPPED',
        reason: 'repository preflight failed before lifecycle execution',
        durationMs: 0,
      };
    }
    gates.push(packageGate, ...requiredOfflineAliases(packageGate));

    const { entries, canonicalExtrasGate, tracked } = preflight;
    let pendingCanonicalWrite;
    const preCanonicalGatesPass = gates.every(({ status }) => status === 'PASS');
    if (
      options.canonicalLockOutput &&
      preCanonicalGatesPass &&
      tracked.gate.status === 'PASS' &&
      canonicalExtrasGate.status === 'PASS'
    ) {
      if (fixtureMode) throw new Error('canonical lock output is unavailable in fixture mode');
      const standaloneRoot = join(executionRoot, 'canonical-standalone');
      await mkdir(standaloneRoot, { recursive: true, mode: 0o700 });
      const materializeGate = await commandGate({
        name: 'canonical-index-materialization',
        call: {
          label: 'canonical-index-materialization',
          command: 'git',
          args: ['checkout-index', '--all', `--prefix=${standaloneRoot}${sep}`],
          cwd: repoRoot,
          env: baseEnv,
        },
        runCommand,
        stagingDir,
        secrets,
      });
      gates.push(publicGate(materializeGate));
      let materializedInventory = [];
      let materializedError;
      if (materializeGate.status === 'PASS') {
        try {
          materializedInventory = await inspectCanonicalTrackedEntries({
            sourceRoot: standaloneRoot,
            entries,
            requiredSymlinks: REQUIRED_TRACKED_SYMLINKS,
          });
        } catch (error) {
          materializedError = error instanceof Error ? error.message : String(error);
        }
      } else {
        materializedError = 'Git index materialization failed';
      }
      const materializedStartedAt = new Date().toISOString();
      const materializedBefore = Date.now();
      const materializedGate = await recordedGate({
        name: 'canonical-materialized-entries',
        status: materializedError ? 'FAIL' : 'PASS',
        stagingDir,
        details: {
          error: materializedError ?? null,
          entries: materializedInventory,
        },
        startedAt: materializedStartedAt,
        before: materializedBefore,
      });
      gates.push(materializedGate);
      await writeFile(
        join(stagingDir, 'tracked-entry-types.json'),
        `${JSON.stringify(materializedInventory, null, 2)}\n`,
        { mode: 0o600 }
      );

      if (materializedGate.status === 'PASS') {
        let priorCanonicalLock;
        let priorCanonicalLockError;
        try {
          priorCanonicalLock = await readJson(join(standaloneRoot, '.omcodex.lock.json'));
        } catch (error) {
          priorCanonicalLockError = error instanceof Error ? error.message : String(error);
        }
        const priorLockStartedAt = new Date().toISOString();
        const priorLockBefore = Date.now();
        gates.push(
          await recordedGate({
            name: 'canonical-index-lock-input',
            status: priorCanonicalLockError ? 'FAIL' : 'PASS',
            stagingDir,
            details: { error: priorCanonicalLockError ?? null },
            startedAt: priorLockStartedAt,
            before: priorLockBefore,
          })
        );
        if (priorCanonicalLockError) {
          return {
            version,
            gates,
            sourceSha: fixtureMode ? 'fixture' : undefined,
            pendingCanonicalWrite,
          };
        }
        const lockGate = await commandGate({
          name: 'canonical-lock',
          call: {
            label: 'canonical-lock',
            command: 'bun',
            args: ['run', join(standaloneRoot, 'scripts', 'sync-source-lockfile.ts')],
            cwd: standaloneRoot,
            env: withoutCheckoutResolutionEnvironment(lifecycleSafeEnvironment(baseEnv)),
          },
          runCommand,
          stagingDir,
          secrets,
        });
        gates.push(publicGate(lockGate));
        if (lockGate.status === 'PASS') {
          const contractStartedAt = new Date().toISOString();
          const contractBefore = Date.now();
          let contractError;
          try {
            const lockPath = join(standaloneRoot, '.omcodex.lock.json');
            const lock = await readJson(lockPath);
            assertCanonicalLockContract({
              generatedLock: lock,
              priorLock: priorCanonicalLock,
              version,
            });
            const requestedOutputPath = resolve(repoRoot, options.canonicalLockOutput);
            const expectedOutputPath = resolve(repoRoot, '.omcodex.lock.json');
            if (requestedOutputPath !== expectedOutputPath) {
              throw new Error('canonical lock output must be exactly .omcodex.lock.json');
            }
            const outputPath = await assertPathContained(
              repoRoot,
              requestedOutputPath,
              'canonical lock output'
            );
            pendingCanonicalWrite = {
              outputPath,
              contents: await readFile(lockPath),
            };
          } catch (error) {
            contractError = error instanceof Error ? error.message : String(error);
          }
          gates.push(
            await recordedGate({
              name: 'canonical-lock-contract',
              status: contractError ? 'FAIL' : 'PASS',
              stagingDir,
              details: { error: contractError ?? null },
              startedAt: contractStartedAt,
              before: contractBefore,
            })
          );
        }
      }
    }

    return {
      version,
      gates,
      sourceSha: fixtureMode ? 'fixture' : undefined,
      pendingCanonicalWrite,
    };
  } finally {
    await rm(executionRoot, { recursive: true, force: true });
  }
}

const LIVE_INPUT_FILES = ['external-state.json', 'scoped.tgz', 'unscoped.tgz'];

async function readTrustedRegularFile(path, name) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error(`live input must be a regular file: ${name}`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Fixed-file identity, metadata, and hash checks intentionally share one fail-closed trust-boundary audit.
async function loadTrustedLiveInputs({ options, version, stagingDir, protectedPaths }) {
  const startedAt = new Date().toISOString();
  const before = Date.now();
  let state;
  let artifacts;
  let inputRoot;
  let error;
  try {
    if (!options.liveInputDir) throw new Error('--live-input-dir is required in live mode');
    inputRoot = await assertSafeExistingDirectory(resolve(options.liveInputDir), {
      protectedPaths,
    });
    const entries = (await readdir(inputRoot)).sort();
    if (!isDeepStrictEqual(entries, LIVE_INPUT_FILES)) {
      throw new Error('live input directory must contain only the fixed release input files');
    }
    for (const name of LIVE_INPUT_FILES) {
      const stats = await lstat(join(inputRoot, name));
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error(`live input must be a regular file: ${name}`);
      }
    }
    state = await readJson(join(inputRoot, 'external-state.json'));
    if (
      state.schemaVersion !== 1 ||
      state.version !== version ||
      state.tag !== options.tag ||
      state.expectedSourceSha !== options.expectedSourceSha ||
      state.repository !== options.repository
    ) {
      throw new Error('live input identity does not match the requested release');
    }
    artifacts = {};
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const checks = [
    {
      name: 'registry-npm',
      passed:
        !error &&
        state?.registries?.npm &&
        exactMetadataMatches(
          JSON.stringify(state?.registries?.npm),
          PUBLIC_PACKAGE,
          version,
          false
        ),
      details: state?.registries?.npm,
    },
    {
      name: 'registry-github-packages',
      passed:
        !error &&
        state?.registries?.githubPackages &&
        exactMetadataMatches(
          JSON.stringify(state?.registries?.githubPackages),
          SCOPED_PACKAGE,
          version,
          false
        ),
      details: state?.registries?.githubPackages,
    },
    {
      name: 'github-release',
      passed: !error && state?.githubRelease?.tagName === options.tag,
      details: state?.githubRelease,
    },
  ];

  if (!error) {
    for (const name of ['unscoped', 'scoped']) {
      const path = join(inputRoot, `${name}.tgz`);
      const expected = state?.artifacts?.[name];
      const bytes = await readTrustedRegularFile(path, `${name}.tgz`);
      if (
        expected?.file !== `${name}.tgz` ||
        typeof expected?.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(expected.sha256) ||
        sha256(bytes) !== expected.sha256
      ) {
        error = `live input artifact hash mismatch: ${name}`;
        break;
      }
      artifacts[name] = { file: `${name}.tgz`, sha256: expected.sha256, bytes };
    }
  }

  const gates = [];
  for (const check of checks) {
    gates.push(
      await recordedGate({
        name: check.name,
        status: check.passed && !error ? 'PASS' : 'FAIL',
        stagingDir,
        details: {
          source: 'trusted-script-disabled-prefetch',
          error: error ?? null,
          value: check.details,
        },
        startedAt,
        before,
      })
    );
  }
  gates.push(
    await recordedGate({
      name: 'release-input-artifacts',
      status: !error ? 'PASS' : 'FAIL',
      stagingDir,
      details: { files: LIVE_INPUT_FILES, artifacts: state?.artifacts, error: error ?? null },
      startedAt,
      before,
    })
  );
  return { gates, state, inputRoot, artifacts: error ? undefined : artifacts };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The live verifier keeps each trust-boundary gate explicit and auditable.
async function runLive(options, context) {
  const { repoRoot, stagingDir, runCommand, secrets, fixtureMode, sleep, baseEnv, protectedPaths } =
    context;
  const version = strictVersion(options.version, '--version');
  if (options.tag !== `v${version}`) throw new Error('--tag must equal v<version>');
  if (!options.expectedSourceSha) throw new Error('--expected-source-sha is required in live mode');
  if (!options.repository) throw new Error('--repository is required in live mode');
  const gates = [];

  const peel = await commandGate({
    name: 'tag-peel',
    call: {
      label: 'tag-peel',
      command: 'git',
      args: ['rev-parse', `${options.tag}^{commit}`],
      cwd: repoRoot,
      env: baseEnv,
    },
    runCommand,
    stagingDir,
    secrets,
    expected: (result) => result.stdout.trim() === options.expectedSourceSha,
  });
  gates.push(publicGate(peel));
  if (peel.status !== 'PASS') return { version, gates, sourceSha: options.expectedSourceSha };

  if (!fixtureMode) {
    const credentialGate = await credentialAbsenceGate({
      repoRoot,
      baseEnv,
      runCommand,
      stagingDir,
    });
    gates.push(credentialGate);
    if (credentialGate.status !== 'PASS') {
      return { version, gates, sourceSha: options.expectedSourceSha };
    }
    const inputs = await loadTrustedLiveInputs({
      options,
      version,
      stagingDir,
      protectedPaths,
    });
    gates.push(...inputs.gates);
    await writeFile(
      join(stagingDir, 'external-state.json'),
      `${JSON.stringify(inputs.state ?? { error: 'invalid trusted live input' }, null, 2)}\n`,
      { mode: 0o600 }
    );
    if (inputs.artifacts && gates.every(({ status }) => status === 'PASS')) {
      const retirementStartedAt = new Date().toISOString();
      const retirementBefore = Date.now();
      let retirementError;
      try {
        for (const name of LIVE_INPUT_FILES) {
          await rm(join(inputs.inputRoot, name));
        }
        await rmdir(inputs.inputRoot);
      } catch (error) {
        retirementError = error instanceof Error ? error.message : String(error);
      }
      gates.push(
        await recordedGate({
          name: 'trusted-live-input-retirement',
          status: retirementError ? 'FAIL' : 'PASS',
          stagingDir,
          details: { removedBeforeLifecycle: !retirementError, error: retirementError ?? null },
          startedAt: retirementStartedAt,
          before: retirementBefore,
        })
      );
    }
    if (inputs.artifacts && gates.every(({ status }) => status === 'PASS')) {
      gates.push(
        ...(await verifyLiveConsumers({
          repoRoot,
          version,
          runCommand,
          stagingDir,
          secrets,
          baseEnv,
          artifacts: inputs.artifacts,
        }))
      );
    } else {
      gates.push({
        name: 'live-consumers',
        status: 'SKIPPED',
        reason: 'trusted script-disabled release input failed validation',
        durationMs: 0,
        log: gates.find(({ status }) => status !== 'PASS')?.log,
      });
    }
    return { version, gates, sourceSha: options.expectedSourceSha };
  }

  const exactProbes = [
    {
      name: 'registry-npm',
      command: 'npm',
      args: [
        'view',
        `${PUBLIC_PACKAGE}@${version}`,
        'name',
        'version',
        'dist.integrity',
        'dist.tarball',
        '--json',
      ],
      expected: (result) =>
        exactMetadataMatches(result.stdout, PUBLIC_PACKAGE, version, fixtureMode),
    },
    {
      name: 'registry-github-packages',
      command: 'npm',
      args: [
        'view',
        `${SCOPED_PACKAGE}@${version}`,
        'name',
        'version',
        'dist.integrity',
        'dist.tarball',
        '--json',
        '--registry=https://npm.pkg.github.com',
      ],
      expected: (result) =>
        exactMetadataMatches(result.stdout, SCOPED_PACKAGE, version, fixtureMode),
    },
    {
      name: 'github-release',
      command: 'gh',
      args: ['release', 'view', options.tag, '--repo', options.repository, '--json', 'tagName,url'],
      expected: (result) => {
        try {
          return JSON.parse(result.stdout).tagName === options.tag;
        } catch {
          return fixtureMode && result.stdout.trim() === version;
        }
      },
    },
  ];
  const externalState = {
    version,
    tag: options.tag,
    expectedSourceSha: options.expectedSourceSha,
    repository: options.repository,
  };
  for (const probe of exactProbes) {
    const gate = await retryCommandGate(
      {
        name: probe.name,
        call: {
          label: probe.name,
          command: probe.command,
          args: probe.args,
          cwd: repoRoot,
          env: baseEnv,
        },
        runCommand,
        stagingDir,
        secrets,
        expected: probe.expected,
      },
      { attempts: fixtureMode ? 1 : 3, sleep }
    );
    gates.push(publicGate(gate));
    externalState[probe.name] = parseJsonOrScalar(gate.result.stdout);
  }
  await writeFile(
    join(stagingDir, 'external-state.json'),
    `${JSON.stringify(externalState, null, 2)}\n`,
    { mode: 0o600 }
  );

  return { version, gates, sourceSha: options.expectedSourceSha };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Final evidence state transitions stay in one auditable orchestration boundary.
export async function verifyReleaseContract(options, dependencies = {}) {
  if (!['offline', 'live'].includes(options.mode))
    throw new Error('--mode must be offline or live');
  if (!options.evidenceDir) throw new Error('--evidence-dir is required');
  const suppliedEnv = { ...(dependencies.env ?? process.env) };
  if (options.mode === 'live' && dependencies.fixtureMode !== true) {
    const unsafeParentNames = presentLiveParentUnsafeNames(suppliedEnv);
    if (unsafeParentNames.length > 0) {
      throw new Error(
        `live mode must start in a credential-free process after trusted prefetch: ${unsafeParentNames.join(', ')}`
      );
    }
  }
  const baseEnv = options.mode === 'offline' ? offlineEnvironment(suppliedEnv) : suppliedEnv;
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const protectedPaths = [repoRoot, process.cwd(), suppliedEnv.HOME || homedir()];
  const evidenceDir = await assertSafeEvidenceDestination(resolve(options.evidenceDir), {
    protectedPaths,
  });
  const stagingDir = await mkdtemp(
    join(tmpdir(), `omcustomcodex-release-evidence-${randomUUID()}-`)
  );
  const startedAt = new Date().toISOString();
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const sleep =
    dependencies.sleep ??
    ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
  const secrets = secretValues(baseEnv);
  try {
    const modeResult =
      options.mode === 'offline'
        ? await runOffline(options, {
            repoRoot,
            stagingDir,
            runCommand,
            secrets,
            fixtureMode: dependencies.fixtureMode === true,
            baseEnv,
          })
        : await runLive(options, {
            repoRoot,
            stagingDir,
            runCommand,
            secrets,
            fixtureMode: dependencies.fixtureMode === true,
            sleep,
            baseEnv,
            protectedPaths,
          });

    if (options.mode === 'offline' && !modeResult.sourceSha && !dependencies.fixtureMode) {
      const shaGate = await commandGate({
        name: 'source-sha',
        call: {
          label: 'source-sha',
          command: 'git',
          args: ['rev-parse', 'HEAD'],
          cwd: repoRoot,
          env: baseEnv,
        },
        runCommand,
        stagingDir,
        secrets,
      });
      modeResult.gates.push(publicGate(shaGate));
      modeResult.sourceSha = shaGate.result.stdout.trim();
    }
    if (options.mode === 'offline' && options.canonicalLockOutput) {
      const outputStartedAt = new Date().toISOString();
      const outputBefore = Date.now();
      let outputError;
      if (!modeResult.gates.every(({ status }) => status === 'PASS')) {
        outputError = 'canonical lock output blocked by a failed prerequisite gate';
      } else if (!modeResult.pendingCanonicalWrite) {
        outputError = 'canonical lock output was requested but no validated replacement exists';
      } else {
        try {
          await replaceRegularFileAtomically(
            modeResult.pendingCanonicalWrite.outputPath,
            modeResult.pendingCanonicalWrite.contents
          );
        } catch (error) {
          outputError = error instanceof Error ? error.message : String(error);
        }
      }
      modeResult.gates.push(
        await recordedGate({
          name: 'canonical-lock-output',
          status: outputError ? 'FAIL' : 'PASS',
          stagingDir,
          details: { replacedAfterAllPrerequisites: !outputError, error: outputError ?? null },
          startedAt: outputStartedAt,
          before: outputBefore,
        })
      );
    }
    const overall =
      modeResult.gates.length > 0 && modeResult.gates.every(({ status }) => status === 'PASS')
        ? 'PASS'
        : 'FAIL';
    await writeFile(
      join(stagingDir, 'subgates.json'),
      `${JSON.stringify(modeResult.gates, null, 2)}\n`,
      { mode: 0o600 }
    );
    for (const name of ['inventory-unscoped.json', 'inventory-scoped.json', 'parity.json']) {
      if (!existsSync(join(stagingDir, name)))
        await writeFile(join(stagingDir, name), '{}\n', { mode: 0o600 });
    }
    if (!existsSync(join(stagingDir, 'tracked-entry-types.json'))) {
      await writeFile(join(stagingDir, 'tracked-entry-types.json'), '[]\n', { mode: 0o600 });
    }
    const manifest = {
      schemaVersion: 1,
      mode: options.mode,
      requestedVersion: modeResult.version,
      tag: options.tag ?? null,
      repository: options.repository ?? null,
      sourceSha: modeResult.sourceSha ?? null,
      startedAt,
      completedAt: new Date().toISOString(),
      overall,
      evidence_safe: true,
      gateCounts: {
        total: modeResult.gates.length,
        passed: modeResult.gates.filter(({ status }) => status === 'PASS').length,
        failed: modeResult.gates.filter(({ status }) => status === 'FAIL').length,
        skipped: modeResult.gates.filter(({ status }) => status === 'SKIPPED').length,
      },
      gates: modeResult.gates,
      tools: { node: process.version },
    };
    const finalized = await finalizeEvidence({
      stagingDir,
      evidenceDir,
      manifest,
      secrets,
      protectedPaths,
    });
    return { ...finalized, evidenceDir };
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

function writeWorkflowOutputs(result) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `evidence_safe=${result.evidence_safe === true}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `overall=${result.overall}\n`);
}

async function main() {
  const options = parseVerifyReleaseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${VERIFY_RELEASE_HELP}\n`);
    return;
  }
  const result = await verifyReleaseContract(options);
  writeWorkflowOutputs(result);
  process.stdout.write(
    `${JSON.stringify({ overall: result.overall, evidence_safe: result.evidence_safe, evidenceDir: result.evidenceDir })}\n`
  );
  if (result.overall !== 'PASS') process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(() => {
    const result = { overall: 'FAIL', evidence_safe: false };
    writeWorkflowOutputs(result);
    process.stderr.write('release verification failed; unsafe diagnostics suppressed\n');
    process.exitCode = 1;
  });
}
