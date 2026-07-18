import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  assertPathContained,
  assertSafeEvidenceDestination,
  copyCanonicalTrackedEntries,
  createIsolatedExecutionRoots,
  finalizeEvidence,
  inspectCanonicalTrackedEntries,
  redactEvidenceText,
  replaceRegularFileAtomically,
  sha256,
} from '../scripts/release-evidence-lib.mjs';
import {
  assertCanonicalLockContract,
  isSensitiveIgnoredPath,
  parseVerifyReleaseArgs,
  standardIgnoredRoot,
  verifyReleaseContract,
} from '../scripts/verify-release-contract.mjs';

const roots = [];
async function fixture(prefix = 'release-contract-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function absentEvidencePath(prefix = 'release-evidence-') {
  return join(await fixture(prefix), 'evidence');
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writeOfflineRepository(root, version = '1.0.0') {
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'oh-my-customcodex', version })}\n`
  );
  await mkdir(join(root, 'templates'), { recursive: true });
  await writeFile(join(root, 'templates', 'manifest.json'), `${JSON.stringify({ version })}\n`);
  await mkdir(join(root, 'plugins', 'oh-my-customcodex', '.codex-plugin'), { recursive: true });
  await writeFile(
    join(root, 'plugins', 'oh-my-customcodex', '.codex-plugin', 'plugin.json'),
    `${JSON.stringify({ version })}\n`
  );
}

function gitIndexOutput(entries) {
  return entries
    .map(({ mode, path }, index) => `${mode} ${String(index + 1).padStart(40, '0')} 0\t${path}\0`)
    .join('');
}

function canonicalLockFixture(version = '1.0.24', count = 243) {
  return {
    generatorVersion: version,
    templateVersion: version,
    files: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `managed/file-${String(index).padStart(3, '0')}.txt`,
        { sha256: String(index).padStart(64, '0') },
      ])
    ),
  };
}

async function prepareCanonicalRepository(root) {
  await writeOfflineRepository(root, '1.0.24');
  await mkdir(join(root, 'docs', 'plans', 'refs'), { recursive: true });
  await mkdir(join(root, 'docs', 'plans', '2025-01-25'), { recursive: true });
  await symlink('../2025-01-25', join(root, 'docs', 'plans', 'refs', 'latest'));
  await mkdir(join(root, 'scripts'), { recursive: true });
  await writeFile(join(root, 'scripts', 'sync-source-lockfile.ts'), 'console.log("fixture")\n');
  await writeFile(
    join(root, '.omcodex.lock.json'),
    `${JSON.stringify(canonicalLockFixture(), null, 2)}\n`
  );
  return [
    { mode: '100644', path: '.omcodex.lock.json' },
    { mode: '120000', path: 'docs/plans/refs/latest' },
    { mode: '100644', path: 'package.json' },
    { mode: '100644', path: 'plugins/oh-my-customcodex/.codex-plugin/plugin.json' },
    { mode: '100644', path: 'scripts/sync-source-lockfile.ts' },
    { mode: '100644', path: 'templates/manifest.json' },
  ];
}

async function writeTrustedLiveInput(
  root,
  { version = '1.0.0', tag = `v${version}`, expectedSourceSha = 'abc123', repository = 'o/r' } = {}
) {
  const inputRoot = join(root, 'live-input');
  await mkdir(inputRoot, { mode: 0o700 });
  const unscoped = join(inputRoot, 'unscoped.tgz');
  const scoped = join(inputRoot, 'scoped.tgz');
  await writeFile(unscoped, 'unscoped tarball fixture\n');
  await writeFile(scoped, 'scoped tarball fixture\n');
  await writeFile(
    join(inputRoot, 'external-state.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        version,
        tag,
        expectedSourceSha,
        repository,
        registries: {
          npm: { name: 'oh-my-customcodex', version },
          githubPackages: { name: '@baekenough/oh-my-customcodex', version },
        },
        githubRelease: { tagName: tag, url: 'https://example.invalid/release' },
        artifacts: {
          unscoped: { file: 'unscoped.tgz', sha256: sha256(await readFile(unscoped)) },
          scoped: { file: 'scoped.tgz', sha256: sha256(await readFile(scoped)) },
        },
      },
      null,
      2
    )}\n`
  );
  return inputRoot;
}

async function verifyOfflineWithIndex(
  root,
  entries,
  evidenceName = 'evidence',
  untracked = [],
  ignored = [],
  { worktreeDrift = [], observedCalls = [], observedCallDetails = [] } = {}
) {
  await writeOfflineRepository(root);
  const evidenceDir = await absentEvidencePath();
  return verifyReleaseContract(
    {
      mode: 'offline',
      evidenceDir: join(dirname(evidenceDir), evidenceName),
      repoRoot: root,
      version: '1.0.0',
    },
    {
      env: {},
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The fixture maps each verifier gate label to deterministic evidence.
      runCommand: async (call) => {
        observedCalls.push(call.label);
        observedCallDetails.push(call);
        if (call.label === 'git-index') {
          return { status: 0, stdout: gitIndexOutput(entries), stderr: '' };
        }
        if (call.label === 'git-worktree-index-drift') {
          return {
            status: 0,
            stdout: worktreeDrift.length > 0 ? `${worktreeDrift.join('\0')}\0` : '',
            stderr: '',
          };
        }
        if (call.label === 'git-untracked-extras') {
          return {
            status: 0,
            stdout: untracked.length > 0 ? `${untracked.join('\0')}\0` : '',
            stderr: '',
          };
        }
        if (call.label === 'git-ignored-extras') {
          return {
            status: 0,
            stdout: ignored.length > 0 ? `${ignored.join('\0')}\0` : '',
            stderr: '',
          };
        }
        if (call.label === 'source-sha') {
          return { status: 0, stdout: 'abc123\n', stderr: '' };
        }
        return { status: 0, stdout: 'PASS\n', stderr: '' };
      },
    }
  );
}

test('hashes tracked worktree content instead of trusting recreated-file stat metadata', async () => {
  const root = await fixture('tracked-content-drift-');
  const observedCallDetails = [];
  await verifyOfflineWithIndex(root, [], 'content-drift-evidence', [], [], {
    observedCallDetails,
  });
  const call = observedCallDetails.find(({ label }) => label === 'git-worktree-index-drift');
  assert.deepEqual(call.args, [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--name-only',
    '-z',
    '--',
  ]);

  const gitRoot = await fixture('tracked-stat-git-');
  const generatedPath = join(gitRoot, 'generated.txt');
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: gitRoot }).status, 0);
  await writeFile(generatedPath, 'same bytes\n');
  assert.equal(spawnSync('git', ['add', 'generated.txt'], { cwd: gitRoot }).status, 0);
  assert.equal(spawnSync('git', ['update-index', '--refresh'], { cwd: gitRoot }).status, 0);

  await rm(generatedPath);
  await writeFile(generatedPath, 'same bytes\n');
  const future = new Date(Date.now() + 60_000);
  await utimes(generatedPath, future, future);
  const statOnly = spawnSync(call.command, call.args, {
    cwd: gitRoot,
    encoding: 'utf8',
  });
  assert.equal(statOnly.status, 0, statOnly.stderr);
  assert.equal(statOnly.stdout, '');

  await writeFile(generatedPath, 'different bytes\n');
  await utimes(generatedPath, future, future);
  const contentDrift = spawnSync(call.command, call.args, {
    cwd: gitRoot,
    encoding: 'utf8',
  });
  assert.equal(contentDrift.status, 0, contentDrift.stderr);
  assert.equal(contentDrift.stdout, 'generated.txt\0');
});

test('rejects executable-bit drift independently of Git core.fileMode', async () => {
  const root = await fixture('tracked-executable-mode-');
  const scriptPath = join(root, 'script.sh');
  await writeFile(scriptPath, '#!/bin/sh\nexit 0\n');
  await chmod(scriptPath, 0o644);
  await assert.rejects(
    inspectCanonicalTrackedEntries({
      sourceRoot: root,
      entries: [{ mode: '100755', path: 'script.sh' }],
    }),
    /tracked executable mode mismatch/
  );

  await chmod(scriptPath, 0o755);
  await assert.rejects(
    inspectCanonicalTrackedEntries({
      sourceRoot: root,
      entries: [{ mode: '100644', path: 'script.sh' }],
    }),
    /tracked executable mode mismatch/
  );
});

test('freezes the offline/live CLI option names', () => {
  assert.deepEqual(
    parseVerifyReleaseArgs([
      '--mode',
      'live',
      '--version',
      '1.2.3',
      '--tag',
      'v1.2.3',
      '--expected-source-sha',
      'abc',
      '--repository',
      'o/r',
      '--evidence-dir',
      '/tmp/e',
    ]),
    {
      help: false,
      mode: 'live',
      version: '1.2.3',
      tag: 'v1.2.3',
      expectedSourceSha: 'abc',
      repository: 'o/r',
      evidenceDir: '/tmp/e',
      canonicalLockOutput: undefined,
      liveInputDir: undefined,
    }
  );
});

test('rejects path prefix confusion and a symlink escape outside the canonical root', async () => {
  const root = await fixture('canonical-root-');
  const evil = await fixture('canonical-root-evil-');
  await assert.rejects(assertPathContained(root, join(evil, 'file')), /outside canonical root/);
  await symlink(evil, join(root, 'escape'));
  await assert.rejects(
    assertPathContained(root, join(root, 'escape', 'file')),
    /outside canonical root|symbolic link/
  );
});

test('rejects a symlinked evidence directory', async () => {
  const root = await fixture();
  const realEvidence = join(root, 'real');
  const evidence = join(root, 'evidence');
  await mkdir(realEvidence);
  await symlink(realEvidence, evidence);
  await assert.rejects(
    verifyReleaseContract(
      { mode: 'offline', evidenceDir: evidence, repoRoot: root, version: '1.0.0' },
      { fixtureMode: true, env: {} }
    ),
    /evidence directory.*symbolic link/i
  );
});

test('requires an absent evidence leaf and never deletes a pre-existing destination', async () => {
  const root = await fixture();
  const evidence = join(root, 'evidence');
  const sentinel = join(evidence, 'sentinel.txt');
  await mkdir(evidence);
  await writeFile(sentinel, 'keep me\n');
  await assert.rejects(
    verifyReleaseContract(
      { mode: 'offline', evidenceDir: evidence, repoRoot: root, version: '1.0.0' },
      { fixtureMode: true, env: {} }
    ),
    /absent dedicated leaf/i
  );
  assert.equal(await readFile(sentinel, 'utf8'), 'keep me\n');
});

test('rejects repository, HOME, filesystem root, and ancestor evidence destinations', async () => {
  const root = await fixture();
  const repository = join(root, 'repository', 'checkout');
  const home = join(root, 'home', 'user');
  await mkdir(repository, { recursive: true });
  await mkdir(home, { recursive: true });

  await assert.rejects(
    assertSafeEvidenceDestination(repository, { protectedPaths: [repository, home] }),
    /absent dedicated leaf|repository/i
  );
  await assert.rejects(
    assertSafeEvidenceDestination(home, { protectedPaths: [repository, home] }),
    /absent dedicated leaf|home/i
  );
  await assert.rejects(
    assertSafeEvidenceDestination(join(root, 'repository'), {
      protectedPaths: [repository, home],
    }),
    /absent dedicated leaf|ancestor/i
  );
  await assert.rejects(
    assertSafeEvidenceDestination(join(repository, 'nested', 'evidence'), {
      protectedPaths: [repository, home],
    }),
    /repository|home|protected|ancestor/i
  );
  await assert.rejects(assertSafeEvidenceDestination('/'), /filesystem root/i);
});

test('atomically replaces a canonical output path without mutating a hardlink peer', async () => {
  const root = await fixture('canonical-hardlink-');
  const victim = join(root, 'victim.json');
  const output = join(root, '.omcodex.lock.json');
  await writeFile(victim, 'victim-bytes\n');
  await link(victim, output);

  await replaceRegularFileAtomically(output, Buffer.from('replacement-bytes\n'));

  assert.equal(await readFile(victim, 'utf8'), 'victim-bytes\n');
  assert.equal(await readFile(output, 'utf8'), 'replacement-bytes\n');
});

test('rejects the verifier cwd and its ancestor when repoRoot is different', async () => {
  const repository = await fixture('different-repository-');
  for (const evidenceDir of [process.cwd(), dirname(process.cwd())]) {
    await assert.rejects(
      verifyReleaseContract(
        { mode: 'offline', evidenceDir, repoRoot: repository, version: '1.0.0' },
        { fixtureMode: true, env: { HOME: join(repository, 'home') } }
      ),
      /absent dedicated leaf|repository|home|ancestor/i
    );
  }
});

test('rejects a symlink anywhere in the lexical evidence ancestor chain', async () => {
  const root = await fixture();
  const target = join(root, 'target');
  const linkedParent = join(target, 'already-real');
  await mkdir(linkedParent, { recursive: true });
  await symlink(target, join(root, 'linked'));
  await assert.rejects(
    assertSafeEvidenceDestination(join(root, 'linked', 'already-real', 'evidence')),
    /unsafe ancestor symbolic link/i
  );
});

test('accepts the operating system trusted temporary root alias for an absent evidence leaf', async () => {
  const leaf = join('/tmp', `omcustomcodex-release-evidence-alias-${process.pid}-${Date.now()}`);
  assert.equal(existsSync(leaf), false);
  const resolved = await assertSafeEvidenceDestination(leaf, {
    protectedPaths: [process.cwd(), process.env.HOME],
  });
  assert.equal(resolved.endsWith(leaf.split('/').at(-1)), true);
});

test('uses three distinct cwd values and fully isolates consumer resolution', async () => {
  const base = await fixture();
  const repository = await fixture('repository-');
  const contexts = await createIsolatedExecutionRoots({
    baseDir: base,
    repositoryRoot: repository,
    baseEnv: { NODE_PATH: '/checkout/node_modules', HOME: '/real-home' },
  });
  assert.equal(
    new Set([contexts.repository.cwd, contexts.unscoped.cwd, contexts.scoped.cwd]).size,
    3
  );
  for (const context of [contexts.repository, contexts.unscoped, contexts.scoped]) {
    assert.equal(context.env.NODE_PATH, undefined);
    assert.notEqual(context.env.HOME, '/real-home');
    assert.equal(context.env.npm_config_ignore_scripts, 'false');
    assert.ok(context.env.CODEX_HOME.startsWith(base));
    assert.ok(context.env.npm_config_cache.startsWith(base));
    assert.ok(context.env.npm_config_userconfig.startsWith(base));
    assert.ok(context.env.npm_config_prefix.startsWith(base));
  }
});

test('executes a harmless lifecycle sentinel when isolated installs resolve ignore-scripts=false', async () => {
  const base = await fixture();
  const repository = await fixture('repository-');
  const packageRoot = join(base, 'lifecycle-package');
  const sentinel = join(base, 'lifecycle-ran');
  await mkdir(packageRoot);
  await writeFile(
    join(packageRoot, 'package.json'),
    `${JSON.stringify({
      name: 'lifecycle-sentinel-fixture',
      version: '1.0.0',
      scripts: { install: 'node install.cjs' },
    })}\n`
  );
  await writeFile(
    join(packageRoot, 'install.cjs'),
    "require('node:fs').writeFileSync(process.env.LIFECYCLE_SENTINEL, 'ran')\n"
  );
  const contexts = await createIsolatedExecutionRoots({
    baseDir: join(base, 'execution'),
    repositoryRoot: repository,
  });
  await writeFile(join(contexts.unscoped.cwd, 'package.json'), '{"private":true}\n');
  const result = spawnSync(
    'npm',
    ['install', '--no-audit', '--no-fund', '--no-package-lock', packageRoot],
    {
      cwd: contexts.unscoped.cwd,
      env: { ...contexts.unscoped.env, LIFECYCLE_SENTINEL: sentinel },
      encoding: 'utf8',
    }
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(existsSync(sentinel), true);
});

test('redacts secrets from stdout, stderr, argv labels, and thrown error text using one constant', () => {
  const token = 'npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
  const captured = {
    stdout: `published ${token}`,
    stderr: `failed ${token}`,
    argv: ['--token', token],
    error: new Error(`boom ${token}`).message,
  };
  const redacted = redactEvidenceText(captured, { secrets: [token] });
  const serialized = JSON.stringify(redacted.value);
  assert.equal(redacted.detected, true);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.match(/\[REDACTED\]/g)?.length, 4);
});

test('sets evidence_safe false and keeps the tainted upload destination absent', async () => {
  const root = await fixture();
  const stagingDir = join(root, 'staging');
  const evidenceDir = join(root, 'upload');
  await mkdir(stagingDir);
  await writeFile(
    join(stagingDir, 'manifest.json'),
    '{"token":"ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}\n'
  );
  const result = await finalizeEvidence({
    stagingDir,
    evidenceDir,
    manifest: { overall: 'FAIL' },
    forceUnsafe: true,
  });
  assert.equal(result.evidence_safe, false);
  await assert.rejects(readFile(join(evidenceDir, 'manifest.json')), /ENOENT/);
  assert.equal(JSON.stringify(result).includes('ghp_'), false);
});

test('rehashes redacted gate logs consistently across manifest, subgates, evidenceFiles, and SHA256SUMS', async () => {
  const root = await fixture();
  const stagingDir = join(root, 'staging');
  const evidenceDir = join(root, 'upload');
  const token = 'npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
  const log = 'logs/redaction.log';
  await mkdir(join(stagingDir, 'logs'), { recursive: true });
  const originalLog = `captured ${token}\n`;
  await writeFile(join(stagingDir, log), originalLog);
  const gate = {
    name: 'redaction',
    status: 'PASS',
    startedAt: new Date().toISOString(),
    durationMs: 1,
    log,
    logSha256: sha256(originalLog),
  };
  await writeFile(join(stagingDir, 'subgates.json'), `${JSON.stringify([gate], null, 2)}\n`);

  await finalizeEvidence({
    stagingDir,
    evidenceDir,
    manifest: { overall: 'PASS', gates: [gate] },
    secrets: [token],
  });

  const redactedLog = await readFile(join(evidenceDir, log));
  const actualLogHash = sha256(redactedLog);
  const manifest = JSON.parse(await readFile(join(evidenceDir, 'manifest.json'), 'utf8'));
  const subgates = JSON.parse(await readFile(join(evidenceDir, 'subgates.json'), 'utf8'));
  const checksums = new Map(
    (await readFile(join(evidenceDir, 'SHA256SUMS'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => {
        const [hash, path] = line.split(/ {2}/, 2);
        return [path, hash];
      })
  );
  assert.equal(redactedLog.toString('utf8').includes(token), false);
  assert.equal(manifest.gates[0].logSha256, actualLogHash);
  assert.equal(subgates[0].logSha256, actualLogHash);
  assert.equal(manifest.evidenceFiles[log], actualLogHash);
  assert.equal(checksums.get(log), actualLogHash);
  assert.equal(
    manifest.evidenceFiles['subgates.json'],
    sha256(await readFile(join(evidenceDir, 'subgates.json')))
  );
  assert.equal(checksums.get('subgates.json'), manifest.evidenceFiles['subgates.json']);
});

test('rejects PASS or FAIL gate evidence that omits the required schema fields', async () => {
  const root = await fixture();
  const stagingDir = join(root, 'staging');
  await mkdir(stagingDir);
  const logContents = 'ok\n';
  await writeFile(join(stagingDir, 'gate.log'), logContents);
  const completeGate = {
    name: 'invalid',
    status: 'PASS',
    startedAt: new Date().toISOString(),
    durationMs: 1,
    log: 'gate.log',
    logSha256: sha256(logContents),
  };
  for (const field of ['startedAt', 'durationMs', 'log', 'logSha256']) {
    const gate = { ...completeGate };
    delete gate[field];
    await assert.rejects(
      finalizeEvidence({
        stagingDir,
        evidenceDir: join(root, `upload-${field}`),
        manifest: { overall: 'PASS', gates: [gate] },
      }),
      new RegExp(`gate schema.*${field}`, 'i'),
      field
    );
  }
});

test('fails a missing referenced log but preserves safe ordinary failure evidence', async () => {
  const root = await fixture();
  const stagingDir = join(root, 'staging');
  const evidenceDir = join(root, 'upload');
  await mkdir(stagingDir);
  await writeFile(join(stagingDir, 'subgates.json'), '[]\n');
  await assert.rejects(
    finalizeEvidence({
      stagingDir,
      evidenceDir,
      manifest: { overall: 'FAIL', gates: [{ log: 'logs/missing.log' }] },
    }),
    /missing referenced log/
  );
  await writeFile(join(stagingDir, 'failure.log'), 'ordinary failure\n');
  const safe = await finalizeEvidence({
    stagingDir,
    evidenceDir,
    manifest: { overall: 'FAIL', gates: [{ log: 'failure.log' }] },
  });
  assert.equal(safe.evidence_safe, true);
  assert.equal(
    JSON.parse(await readFile(join(evidenceDir, 'manifest.json'), 'utf8')).overall,
    'FAIL'
  );
});

test('offline invokes verify-package-contract exactly once with --skip-build and never builds', async () => {
  const root = await fixture();
  const evidenceDir = await absentEvidencePath();
  await writeOfflineRepository(root);
  const calls = [];
  const result = await verifyReleaseContract(
    { mode: 'offline', evidenceDir, repoRoot: root, version: '1.0.0' },
    {
      fixtureMode: true,
      env: {},
      runCommand: async (call) => {
        calls.push(call);
        return { status: 0, stdout: 'PASS', stderr: '' };
      },
    }
  );
  const packageCalls = calls.filter((call) =>
    call.args?.some((arg) => String(arg).includes('verify-package-contract.mjs'))
  );
  assert.equal(packageCalls.length, 1);
  assert.ok(packageCalls[0].args.includes('--skip-build'));
  assert.equal(
    calls.some((call) => call.args?.includes('build')),
    false
  );
  assert.equal(
    result.overall,
    'PASS',
    JSON.stringify(result.gates?.filter(({ status }) => status !== 'PASS'))
  );
  const manifest = JSON.parse(await readFile(join(evidenceDir, 'manifest.json'), 'utf8'));
  for (const gate of manifest.gates.filter(({ status }) => ['PASS', 'FAIL'].includes(status))) {
    assert.equal(typeof gate.startedAt, 'string', `${gate.name} startedAt`);
    assert.equal(typeof gate.durationMs, 'number', `${gate.name} durationMs`);
    assert.equal(typeof gate.log, 'string', `${gate.name} log`);
    assert.match(gate.logSha256, /^[a-f0-9]{64}$/, `${gate.name} logSha256`);
  }
});

test('offline rejects release credentials before invoking package-contract and strips empty credential keys', async () => {
  const root = await fixture();
  await writeOfflineRepository(root);
  let calls = 0;
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_TOKEN']) {
    await assert.rejects(
      verifyReleaseContract(
        {
          mode: 'offline',
          evidenceDir: join(root, `${name}-credential-evidence`),
          repoRoot: root,
          version: '1.0.0',
        },
        {
          fixtureMode: true,
          env: { [name]: 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
          runCommand: async () => {
            calls += 1;
            return { status: 0, stdout: 'PASS', stderr: '' };
          },
        }
      ),
      /offline.*credential|credential.*offline/i,
      name
    );
  }
  assert.equal(calls, 0);

  let packageEnv;
  let packageUserConfig;
  const hostileHome = await fixture('hostile-offline-home-');
  const hostileUserConfig = join(hostileHome, '.npmrc');
  await writeFile(hostileUserConfig, '//registry.example.invalid/:_authToken=host-secret\n');
  const emptyCredentialEvidence = await absentEvidencePath();
  await verifyReleaseContract(
    {
      mode: 'offline',
      evidenceDir: emptyCredentialEvidence,
      repoRoot: root,
      version: '1.0.0',
    },
    {
      fixtureMode: true,
      env: {
        HOME: hostileHome,
        GH_TOKEN: '',
        GITHUB_TOKEN: '',
        NODE_AUTH_TOKEN: '',
        NPM_TOKEN: '',
        ACTIONS_RUNTIME_TOKEN: 'runtime-secret',
        GITHUB_OUTPUT: '/tmp/github-output',
        GITHUB_ENV: '/tmp/github-env',
        GITHUB_PATH: '/tmp/github-path',
        GITHUB_STATE: '/tmp/github-state',
        NODE_OPTIONS: '--require=/tmp/hostile.cjs',
        npm_config_node_options: '--require=/tmp/hostile-lower.cjs',
        NPM_CONFIG_NODE_OPTIONS: '--require=/tmp/hostile-upper.cjs',
        BUN_OPTIONS: '--preload=/tmp/hostile.ts',
        npm_config_globalconfig: '/tmp/hostile-global-npmrc',
        NPM_CONFIG_GLOBALCONFIG: '/tmp/hostile-global-upper-npmrc',
        NPM_CONFIG_USERCONFIG: '/tmp/hostile-user-npmrc',
        npm_config_userconfig: hostileUserConfig,
        GH_CONFIG_DIR: '/tmp/hostile-gh-config',
      },
      runCommand: async (call) => {
        packageEnv = call.env;
        packageUserConfig = await readFile(call.env.npm_config_userconfig, 'utf8');
        return { status: 0, stdout: 'PASS', stderr: '' };
      },
    }
  );
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_TOKEN']) {
    assert.equal(Object.hasOwn(packageEnv, name), false, name);
  }
  for (const name of [
    'ACTIONS_RUNTIME_TOKEN',
    'GITHUB_OUTPUT',
    'GITHUB_ENV',
    'GITHUB_PATH',
    'GITHUB_STATE',
    'NODE_OPTIONS',
    'npm_config_node_options',
    'NPM_CONFIG_NODE_OPTIONS',
    'BUN_OPTIONS',
    'npm_config_globalconfig',
    'NPM_CONFIG_GLOBALCONFIG',
    'NPM_CONFIG_USERCONFIG',
    'GH_CONFIG_DIR',
  ]) {
    assert.equal(Object.hasOwn(packageEnv, name), false, name);
  }
  assert.notEqual(packageEnv.HOME, hostileHome);
  assert.notEqual(packageEnv.npm_config_userconfig, hostileUserConfig);
  assert.ok(packageEnv.npm_config_userconfig.endsWith('/npmrc'));
  assert.equal(packageUserConfig, 'ignore-scripts=false\nregistry=https://registry.npmjs.org/\n');
});

test('ordinary offline accepts every matching Git-index entry and fixed latest symlink', async () => {
  const root = await fixture('tracked-valid-');
  await mkdir(join(root, 'docs', 'plans', 'refs'), { recursive: true });
  await mkdir(join(root, 'docs', 'plans', '2025-01-25'), { recursive: true });
  await symlink('../2025-01-25', join(root, 'docs', 'plans', 'refs', 'latest'));
  const result = await verifyOfflineWithIndex(
    root,
    [{ mode: '120000', path: 'docs/plans/refs/latest' }],
    'valid-evidence'
  );
  assert.equal(
    result.overall,
    'PASS',
    JSON.stringify(result.gates?.filter(({ status }) => status !== 'PASS'))
  );
});

test('ordinary offline rejects a missing fixed symlink', async () => {
  const root = await fixture('tracked-missing-');
  const result = await verifyOfflineWithIndex(root, [], 'missing-evidence');
  assert.equal(result.overall, 'FAIL');
});

test('ordinary offline rejects an indexed entry missing from the working tree', async () => {
  const root = await fixture('tracked-entry-missing-');
  await mkdir(join(root, 'docs', 'plans', 'refs'), { recursive: true });
  await symlink('../2025-01-25', join(root, 'docs', 'plans', 'refs', 'latest'));
  const result = await verifyOfflineWithIndex(
    root,
    [
      { mode: '100644', path: 'missing.txt' },
      { mode: '120000', path: 'docs/plans/refs/latest' },
    ],
    'entry-missing-evidence'
  );
  assert.equal(result.overall, 'FAIL');
});

test('ordinary offline rejects a tracked entry type mismatch', async () => {
  const root = await fixture('tracked-type-');
  const path = join(root, 'docs', 'plans', 'refs', 'latest');
  await mkdir(join(root, 'docs', 'plans', 'refs'), { recursive: true });
  await writeFile(path, '../2025-01-25');
  const result = await verifyOfflineWithIndex(
    root,
    [{ mode: '120000', path: 'docs/plans/refs/latest' }],
    'type-evidence'
  );
  assert.equal(result.overall, 'FAIL');
});

test('ordinary offline rejects a tracked symlink escape', async () => {
  const root = await fixture('tracked-escape-');
  const outside = await fixture('tracked-outside-');
  await mkdir(join(root, 'docs', 'plans', 'refs'), { recursive: true });
  await symlink(outside, join(root, 'docs', 'plans', 'refs', 'latest'));
  const result = await verifyOfflineWithIndex(
    root,
    [{ mode: '120000', path: 'docs/plans/refs/latest' }],
    'escape-evidence'
  );
  assert.equal(result.overall, 'FAIL');
});

test('ordinary offline rejects a fixed symlink target mismatch', async () => {
  const root = await fixture('tracked-target-');
  await mkdir(join(root, 'docs', 'plans', 'refs'), { recursive: true });
  await symlink('../wrong-target', join(root, 'docs', 'plans', 'refs', 'latest'));
  const result = await verifyOfflineWithIndex(
    root,
    [{ mode: '120000', path: 'docs/plans/refs/latest' }],
    'target-evidence'
  );
  assert.equal(result.overall, 'FAIL');
});

test('ordinary offline rejects every non-index path outside the explicit generated allowlist', async () => {
  const root = await fixture('tracked-extra-');
  await mkdir(join(root, 'docs', 'plans', 'refs'), { recursive: true });
  await symlink('../2025-01-25', join(root, 'docs', 'plans', 'refs', 'latest'));
  const result = await verifyOfflineWithIndex(
    root,
    [{ mode: '120000', path: 'docs/plans/refs/latest' }],
    'extra-evidence',
    ['unexpected.txt']
  );
  assert.equal(result.overall, 'FAIL');
  const manifest = JSON.parse(await readFile(join(result.evidenceDir, 'manifest.json'), 'utf8'));
  const gate = manifest.gates.find(({ name }) => name === 'canonical-extra-files');
  assert.equal(gate.status, 'FAIL');
});

test('offline blocks lifecycle execution until tracked drift and sensitive extras pass preflight', async () => {
  for (const scenario of [
    {
      name: 'tracked-verifier-drift',
      worktreeDrift: ['scripts/verify-package-contract.mjs'],
      ignored: [],
    },
    { name: 'ignored-npmrc', worktreeDrift: [], ignored: ['.npmrc'] },
  ]) {
    const root = await fixture(`offline-preflight-${scenario.name}-`);
    await mkdir(join(root, 'docs', 'plans', 'refs'), { recursive: true });
    await mkdir(join(root, 'docs', 'plans', '2025-01-25'), { recursive: true });
    await symlink('../2025-01-25', join(root, 'docs', 'plans', 'refs', 'latest'));
    const observedCalls = [];
    const result = await verifyOfflineWithIndex(
      root,
      [{ mode: '120000', path: 'docs/plans/refs/latest' }],
      `${scenario.name}-evidence`,
      [],
      scenario.ignored,
      { worktreeDrift: scenario.worktreeDrift, observedCalls }
    );
    assert.equal(result.overall, 'FAIL', scenario.name);
    assert.equal(observedCalls.includes('package-contract'), false, scenario.name);
    const manifest = JSON.parse(await readFile(join(result.evidenceDir, 'manifest.json'), 'utf8'));
    assert.equal(
      manifest.gates.find(({ name }) => name === 'package-contract').status,
      'SKIPPED',
      scenario.name
    );
    for (const alias of [
      'lifecycle-scripts-enabled',
      'registry-artifact-parity',
      'cli-and-esm-smoke',
      'doctor-smoke',
      'foreign-pretooluse-preservation',
    ]) {
      assert.equal(manifest.gates.find(({ name }) => name === alias).status, 'SKIPPED', alias);
    }
  }
});

test('ordinary offline allows standard ignored build outputs after scanning them', async () => {
  const root = await fixture('tracked-ignored-build-');
  await mkdir(join(root, 'node_modules'), { recursive: true });
  await mkdir(join(root, 'packages', 'ontology-rag', 'target'), { recursive: true });
  await mkdir(join(root, 'packages', 'serve', '.svelte-kit'), { recursive: true });
  await mkdir(join(root, 'packages', 'serve', 'build'), { recursive: true });
  await mkdir(join(root, 'docs', 'plans', 'refs'), { recursive: true });
  await mkdir(join(root, 'docs', 'plans', '2025-01-25'), { recursive: true });
  await symlink('../2025-01-25', join(root, 'docs', 'plans', 'refs', 'latest'));
  const result = await verifyOfflineWithIndex(
    root,
    [{ mode: '120000', path: 'docs/plans/refs/latest' }],
    'ignored-build-evidence',
    [],
    [
      'dist/release-token.js',
      'node_modules/example/private-key.js',
      'node_modules/example/state/session.sqlite',
      'packages/ontology-rag/target/logs/session.db',
      'packages/serve/.svelte-kit/output/server/state/session.js',
      'packages/serve/build/server/logs/session.db',
      'coverage/token-summary.json',
      'docs/.vitepress/dist/search-token.json',
    ]
  );
  assert.equal(result.overall, 'PASS');
  const manifest = JSON.parse(await readFile(join(result.evidenceDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.gates.find(({ name }) => name === 'git-ignored-extras').status, 'PASS');
  assert.equal(manifest.gates.find(({ name }) => name === 'canonical-extra-files').status, 'PASS');
});

test('classifies only exact reviewed standard ignored build roots', () => {
  assert.equal(
    standardIgnoredRoot('packages/serve/.svelte-kit/output/server/state/session.js'),
    'packages/serve/.svelte-kit'
  );
  assert.equal(
    standardIgnoredRoot('packages/serve/build/server/logs/session.db'),
    'packages/serve/build'
  );
  assert.equal(isSensitiveIgnoredPath('packages/serve/build/server/logs/session.db'), false);
  assert.equal(isSensitiveIgnoredPath('packages/other/build/server/logs/session.db'), true);
  assert.equal(isSensitiveIgnoredPath('.omx/node_modules/example/state.js'), true);
  assert.equal(isSensitiveIgnoredPath('.codex/outputs/target/session.js'), true);
  assert.equal(isSensitiveIgnoredPath('.ssh/node_modules/example/key.js'), true);
});

test('ordinary offline rejects a symlinked standard ignored root', async () => {
  const root = await fixture('tracked-ignored-symlink-');
  const outside = await fixture('tracked-ignored-symlink-outside-');
  await symlink(outside, join(root, 'node_modules'));
  await mkdir(join(root, 'docs', 'plans', 'refs'), { recursive: true });
  await mkdir(join(root, 'docs', 'plans', '2025-01-25'), { recursive: true });
  await symlink('../2025-01-25', join(root, 'docs', 'plans', 'refs', 'latest'));
  const result = await verifyOfflineWithIndex(
    root,
    [{ mode: '120000', path: 'docs/plans/refs/latest' }],
    'ignored-symlink-evidence',
    [],
    ['node_modules/example/state/session.sqlite']
  );
  assert.equal(result.overall, 'FAIL');
  const manifest = JSON.parse(await readFile(join(result.evidenceDir, 'manifest.json'), 'utf8'));
  const gate = manifest.gates.find(({ name }) => name === 'canonical-extra-files');
  assert.equal(gate.status, 'FAIL');
  const log = JSON.parse(await readFile(join(result.evidenceDir, gate.log), 'utf8'));
  assert.deepEqual(log.invalidIgnoredRoots, ['node_modules']);
});

test('ordinary offline fails closed for sensitive ignored non-index paths', async () => {
  const root = await fixture('tracked-ignored-sensitive-');
  await mkdir(join(root, 'docs', 'plans', 'refs'), { recursive: true });
  await mkdir(join(root, 'docs', 'plans', '2025-01-25'), { recursive: true });
  await symlink('../2025-01-25', join(root, 'docs', 'plans', 'refs', 'latest'));
  const result = await verifyOfflineWithIndex(
    root,
    [{ mode: '120000', path: 'docs/plans/refs/latest' }],
    'ignored-sensitive-evidence',
    [],
    [
      'dist/index.js',
      '.env.production',
      'tmp/release-token.txt',
      '.omx/state/release.json',
      'logs/release.log',
      'dist/.env.production',
      'coverage/private.key',
      'docs/.vitepress/dist/auth.json',
      'dist/.aws/credentials',
      'tmp/state/release.json',
      'tmp/session.sqlite',
      'temp/config.json',
    ]
  );
  assert.equal(result.overall, 'FAIL');
  const manifest = JSON.parse(await readFile(join(result.evidenceDir, 'manifest.json'), 'utf8'));
  const gate = manifest.gates.find(({ name }) => name === 'canonical-extra-files');
  assert.equal(gate.status, 'FAIL');
  const log = JSON.parse(await readFile(join(result.evidenceDir, gate.log), 'utf8'));
  assert.deepEqual(log.sensitiveIgnoredExtras, [
    '.env.production',
    'tmp/release-token.txt',
    '.omx/state/release.json',
    'logs/release.log',
    'dist/.env.production',
    'coverage/private.key',
    'docs/.vitepress/dist/auth.json',
    'dist/.aws/credentials',
    'tmp/state/release.json',
    'tmp/session.sqlite',
    'temp/config.json',
  ]);
});

test('writes safe evidence and returns FAIL for an ordinary offline package subgate failure', async () => {
  const root = await fixture();
  const evidenceDir = await absentEvidencePath();
  const calls = [];
  await writeFile(join(root, 'package.json'), '{"name":"oh-my-customcodex","version":"1.0.0"}\n');
  await mkdir(join(root, 'templates'));
  await writeFile(join(root, 'templates', 'manifest.json'), '{"version":"1.0.0"}\n');
  await mkdir(join(root, 'plugins', 'oh-my-customcodex', '.codex-plugin'), { recursive: true });
  await writeFile(
    join(root, 'plugins', 'oh-my-customcodex', '.codex-plugin', 'plugin.json'),
    '{"version":"1.0.0"}\n'
  );
  const result = await verifyReleaseContract(
    {
      mode: 'offline',
      evidenceDir,
      repoRoot: root,
      version: '1.0.0',
      canonicalLockOutput: '.omcodex.lock.json',
    },
    {
      fixtureMode: true,
      env: {},
      runCommand: async (call) => {
        calls.push(call.label);
        return { status: 1, stdout: '', stderr: 'ordinary failure' };
      },
    }
  );
  const manifest = JSON.parse(await readFile(join(evidenceDir, 'manifest.json'), 'utf8'));
  assert.equal(result.overall, 'FAIL');
  assert.equal(result.evidence_safe, true);
  assert.equal(manifest.overall, 'FAIL');
  assert.equal(manifest.evidence_safe, true);
  assert.equal(calls.includes('canonical-lock'), false);
});

test('live peels the tag before any registry or GitHub Release probe', async () => {
  const root = await fixture();
  const evidenceDir = await absentEvidencePath();
  const calls = [];
  await verifyReleaseContract(
    {
      mode: 'live',
      version: '1.0.0',
      tag: 'v1.0.0',
      expectedSourceSha: 'abc123',
      repository: 'o/r',
      evidenceDir,
      repoRoot: root,
    },
    {
      fixtureMode: true,
      runCommand: async (call) => {
        calls.push(call);
        return {
          status: 0,
          stdout: call.label === 'tag-peel' ? 'abc123\n' : '1.0.0\n',
          stderr: '',
        };
      },
    }
  );
  assert.equal(calls[0].label, 'tag-peel');
  assert.ok(calls.slice(1).some((call) => call.label.startsWith('registry-')));
});

test('a tag peel mismatch fails before every registry and release probe', async () => {
  const root = await fixture();
  const evidenceDir = await absentEvidencePath();
  const calls = [];
  const result = await verifyReleaseContract(
    {
      mode: 'live',
      version: '1.0.0',
      tag: 'v1.0.0',
      expectedSourceSha: 'expected',
      repository: 'o/r',
      evidenceDir,
      repoRoot: root,
    },
    {
      fixtureMode: true,
      runCommand: async (call) => {
        calls.push(call);
        return { status: 0, stdout: 'different\n', stderr: '' };
      },
    }
  );
  assert.equal(result.overall, 'FAIL');
  assert.deepEqual(
    calls.map(({ label }) => label),
    ['tag-peel']
  );
});

test('runs local tarball lifecycle and CLI calls only inside a credential-free verifier process', async () => {
  const root = await fixture('live-boundary-');
  const evidenceDir = await absentEvidencePath();
  const liveInputDir = await writeTrustedLiveInput(await fixture('live-boundary-input-'));
  const forbiddenNames = [
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'NODE_AUTH_TOKEN',
    'NPM_TOKEN',
    'ACTIONS_RUNTIME_TOKEN',
    'GITHUB_OUTPUT',
    'GITHUB_ENV',
    'GITHUB_PATH',
    'GITHUB_STATE',
    'GITHUB_STEP_SUMMARY',
    'NODE_OPTIONS',
    'npm_config_node_options',
    'NPM_CONFIG_NODE_OPTIONS',
    'BUN_OPTIONS',
    'NPM_CONFIG_USERCONFIG',
    'npm_config_globalconfig',
    'NPM_CONFIG_GLOBALCONFIG',
    'GH_CONFIG_DIR',
    'npm_config_script_shell',
    'NPM_CONFIG_REGISTRY',
    'GITHUB_WORKSPACE',
    'RUNNER_TEMP',
  ];
  const consumerCalls = [];
  const result = await verifyReleaseContract(
    {
      mode: 'live',
      version: '1.0.0',
      tag: 'v1.0.0',
      expectedSourceSha: 'abc123',
      repository: 'o/r',
      evidenceDir,
      repoRoot: root,
      liveInputDir,
    },
    {
      env: {
        PATH: process.env.PATH,
        HOME: join(root, 'home'),
      },
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The adversarial command fixture creates both package identities and asserts every lifecycle child boundary.
      runCommand: async (call) => {
        if (call.label === 'tag-peel') {
          return { status: 0, stdout: 'abc123\n', stderr: '' };
        }
        if (call.label === 'checkout-local-credentials') {
          return { status: 1, stdout: '', stderr: '' };
        }
        if (call.label?.startsWith('consumer-')) {
          consumerCalls.push(call);
          for (const name of forbiddenNames) assert.equal(Object.hasOwn(call.env, name), false);
          assert.equal(call.env.npm_config_ignore_scripts, 'false');
          assert.match(call.env.npm_config_userconfig, /npmrc$/);
          assert.ok(call.env.TMPDIR.startsWith(dirname(call.env.HOME)));
          if (call.label.endsWith('-esm-hooks-foreign')) {
            assert.ok(
              call.env.PATH.split(process.platform === 'win32' ? ';' : ':').some((entry) =>
                entry.includes('live-probe-tools-')
              )
            );
          }
          if (call.label.endsWith('-install')) {
            assert.ok(call.args.at(-1).endsWith('.tgz'));
            assert.notEqual(dirname(call.args.at(-1)), liveInputDir);
            assert.equal(existsSync(liveInputDir), false);
            assert.equal(
              await readFile(call.args.at(-1), 'utf8'),
              call.label.includes('-scoped-')
                ? 'scoped tarball fixture\n'
                : 'unscoped tarball fixture\n'
            );
            const packageName = call.label.includes('-scoped-')
              ? '@baekenough/oh-my-customcodex'
              : 'oh-my-customcodex';
            const packageRoot = join(call.cwd, 'node_modules', packageName);
            await mkdir(packageRoot, { recursive: true });
            await writeFile(
              join(packageRoot, 'package.json'),
              `${JSON.stringify({
                name: packageName,
                version: '1.0.0',
                publishConfig: { access: 'public' },
              })}\n`
            );
          }
          if (call.label.endsWith('-version')) {
            return { status: 0, stdout: '1.0.0\n', stderr: '' };
          }
          if (call.label.endsWith('-help')) {
            return { status: 0, stdout: 'Usage: omcustomcodex\n', stderr: '' };
          }
          return { status: 0, stdout: 'PASS\n', stderr: '' };
        }
        throw new Error(`unexpected command: ${call.label}`);
      },
    }
  );
  assert.equal(
    result.overall,
    'PASS',
    JSON.stringify(result.gates?.filter(({ status }) => status !== 'PASS'))
  );
  assert.equal(
    consumerCalls.some(({ label }) => label.endsWith('-fetch')),
    false
  );
  assert.equal(consumerCalls.filter(({ label }) => label.endsWith('-install')).length, 2);
  assert.equal(consumerCalls.filter(({ label }) => label.endsWith('-doctor')).length, 2);
});

test('rejects credentials and lifecycle control injection before a non-fixture live command runs', async () => {
  const root = await fixture('live-parent-boundary-');
  const liveInputDir = await writeTrustedLiveInput(root);
  let calls = 0;
  for (const [name, value] of [
    ['GH_TOKEN', 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['ACTIONS_RUNTIME_TOKEN', 'actions-runtime-secret'],
    ['NODE_OPTIONS', '--require=/tmp/hostile.cjs'],
    ['NPM_CONFIG_USERCONFIG', '/tmp/credential-bearing-npmrc'],
    ['GH_CONFIG_DIR', '/tmp/credential-bearing-gh-config'],
    ['GITHUB_OUTPUT', '/tmp/github-output-channel'],
    ['npm_config_script_shell', '/tmp/hostile-shell'],
    ['NPM_CONFIG_REGISTRY', 'https://hostile.invalid'],
    ['GITHUB_WORKSPACE', '/tmp/checkout'],
    ['RUNNER_TEMP', '/tmp/runner-command-files'],
  ]) {
    await assert.rejects(
      verifyReleaseContract(
        {
          mode: 'live',
          version: '1.0.0',
          tag: 'v1.0.0',
          expectedSourceSha: 'abc123',
          repository: 'o/r',
          evidenceDir: join(root, `evidence-${name}`),
          repoRoot: root,
          liveInputDir,
        },
        {
          env: { PATH: process.env.PATH, HOME: join(root, 'home'), [name]: value },
          runCommand: async () => {
            calls += 1;
            return { status: 0, stdout: 'PASS\n', stderr: '' };
          },
        }
      ),
      /credential-free process/i,
      name
    );
  }
  assert.equal(calls, 0);
});

test('revalidates trusted live input source identity before any lifecycle command', async () => {
  const root = await fixture('live-input-identity-');
  const liveInputDir = await writeTrustedLiveInput(await fixture('live-identity-input-'), {
    expectedSourceSha: 'wrong-source',
  });
  const evidenceDir = await absentEvidencePath();
  const calls = [];
  const result = await verifyReleaseContract(
    {
      mode: 'live',
      version: '1.0.0',
      tag: 'v1.0.0',
      expectedSourceSha: 'abc123',
      repository: 'o/r',
      evidenceDir,
      repoRoot: root,
      liveInputDir,
    },
    {
      env: { PATH: process.env.PATH, HOME: join(root, 'home') },
      runCommand: async (call) => {
        calls.push(call.label);
        if (call.label === 'checkout-local-credentials') {
          return { status: 1, stdout: '', stderr: '' };
        }
        return { status: 0, stdout: 'abc123\n', stderr: '' };
      },
    }
  );
  assert.equal(result.overall, 'FAIL');
  assert.deepEqual(calls, ['tag-peel', 'checkout-local-credentials']);
  const manifest = JSON.parse(await readFile(join(evidenceDir, 'manifest.json'), 'utf8'));
  assert.equal(
    manifest.gates.find(({ name }) => name === 'release-input-artifacts').status,
    'FAIL'
  );
});

test('preserves tracked symlinks and fails closed for unknown git modes', async () => {
  const source = await fixture('tracked-source-');
  const destination = await fixture('tracked-destination-');
  await mkdir(join(source, 'docs', 'plans', 'refs'), { recursive: true });
  await symlink('../2025-01-25', join(source, 'docs', 'plans', 'refs', 'latest'));
  const inventory = await copyCanonicalTrackedEntries({
    sourceRoot: source,
    destinationRoot: destination,
    entries: [{ mode: '120000', path: 'docs/plans/refs/latest' }],
  });
  assert.equal(inventory[0].type, 'symlink');
  assert.equal(inventory[0].linkTarget, '../2025-01-25');
  assert.equal(
    await readFile(join(destination, 'docs', 'plans', 'refs', 'latest'), 'utf8').catch(() => null),
    null
  );
  await assert.rejects(
    copyCanonicalTrackedEntries({
      sourceRoot: source,
      destinationRoot: destination,
      entries: [{ mode: '160000', path: 'submodule' }],
    }),
    /unsupported git mode/
  );
});

test('requires exactly 243 canonical lock files for every requested release version', () => {
  const version = '9.8.7';
  const valid = canonicalLockFixture(version, 243);
  assert.doesNotThrow(() =>
    assertCanonicalLockContract({ generatedLock: valid, priorLock: valid, version })
  );
  assert.throws(
    () =>
      assertCanonicalLockContract({
        generatedLock: canonicalLockFixture(version, 242),
        priorLock: canonicalLockFixture(version, 242),
        version,
      }),
    /exactly 243 files/i
  );
});

test('keeps the permanent release verifier free of a release-specific version literal', async () => {
  const source = await readFile(new URL('../scripts/verify-release-contract.mjs', import.meta.url));
  assert.doesNotMatch(source.toString(), /1\.0\.24/);
});

test('executes the copied standalone canonical generator and only replaces .omcodex.lock.json', async () => {
  const root = await fixture('canonical-generator-');
  const entries = await prepareCanonicalRepository(root);
  const stagedCanonicalLock = await readFile(join(root, '.omcodex.lock.json'));
  let canonicalCall;
  const run = async (
    canonicalLockOutput,
    evidenceName,
    {
      sourceShaStatus = 0,
      generatedCount = 243,
      generatedHashCharacter = 'f',
      worktreeDrift = [],
    } = {}
  ) => {
    const evidenceDir = join(dirname(await absentEvidencePath()), evidenceName);
    return verifyReleaseContract(
      {
        mode: 'offline',
        evidenceDir,
        repoRoot: root,
        version: '1.0.24',
        canonicalLockOutput,
      },
      {
        env: { PATH: process.env.PATH },
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The canonical fixture simulates each Git and generator boundary explicitly.
        runCommand: async (call) => {
          if (call.label === 'git-index') {
            return { status: 0, stdout: gitIndexOutput(entries), stderr: '' };
          }
          if (['git-untracked-extras', 'git-ignored-extras'].includes(call.label)) {
            return { status: 0, stdout: '', stderr: '' };
          }
          if (call.label === 'git-worktree-index-drift') {
            return {
              status: 0,
              stdout: worktreeDrift.length > 0 ? `${worktreeDrift.join('\0')}\0` : '',
              stderr: '',
            };
          }
          if (call.label === 'canonical-index-materialization') {
            const prefix = call.args.find((arg) => arg.startsWith('--prefix=')).slice(9, -1);
            await copyCanonicalTrackedEntries({
              sourceRoot: root,
              destinationRoot: prefix,
              entries,
            });
            await writeFile(join(prefix, '.omcodex.lock.json'), stagedCanonicalLock);
            return { status: 0, stdout: '', stderr: '' };
          }
          if (call.label === 'canonical-lock') {
            canonicalCall = call;
            const generated = canonicalLockFixture('1.0.24', generatedCount);
            if (generatedCount === 243) {
              generated.files['managed/file-000.txt'].sha256 = generatedHashCharacter.repeat(64);
            }
            await writeFile(
              join(call.cwd, '.omcodex.lock.json'),
              `${JSON.stringify(generated, null, 2)}\n`
            );
            return { status: 0, stdout: 'generated\n', stderr: '' };
          }
          if (call.label === 'source-sha') {
            return {
              status: sourceShaStatus,
              stdout: sourceShaStatus === 0 ? 'abc123\n' : '',
              stderr: sourceShaStatus === 0 ? '' : 'source SHA unavailable',
            };
          }
          return { status: 0, stdout: 'PASS\n', stderr: '' };
        },
      }
    );
  };

  const result = await run('.omcodex.lock.json', 'canonical-evidence');
  assert.equal(result.overall, 'PASS');
  assert.equal(
    canonicalCall.args[1],
    join(canonicalCall.cwd, 'scripts', 'sync-source-lockfile.ts')
  );
  assert.notEqual(canonicalCall.args[1], join(root, 'scripts', 'sync-source-lockfile.ts'));

  const lockBeforeFailedSource = await readFile(join(root, '.omcodex.lock.json'));
  const failedSource = await run('.omcodex.lock.json', 'source-sha-failure-evidence', {
    sourceShaStatus: 1,
    generatedHashCharacter: 'e',
  });
  assert.equal(failedSource.overall, 'FAIL');
  assert.deepEqual(await readFile(join(root, '.omcodex.lock.json')), lockBeforeFailedSource);

  await writeFile(join(root, '.omcodex.lock.json'), '{"generatedAt":"unstaged"}\n');
  const timestampOnlyWorktreeDrift = await run(
    '.omcodex.lock.json',
    'timestamp-only-worktree-drift-evidence',
    { generatedHashCharacter: 'd', worktreeDrift: ['.omcodex.lock.json'] }
  );
  assert.equal(timestampOnlyWorktreeDrift.overall, 'PASS');
  assert.equal(
    JSON.parse(await readFile(join(root, '.omcodex.lock.json'), 'utf8')).files[
      'managed/file-000.txt'
    ].sha256,
    'd'.repeat(64)
  );

  const lockBeforeUnexpectedDrift = await readFile(join(root, '.omcodex.lock.json'));
  const unexpectedTrackedDrift = await run(
    '.omcodex.lock.json',
    'unexpected-tracked-worktree-drift-evidence',
    { generatedHashCharacter: 'c', worktreeDrift: ['package.json'] }
  );
  assert.equal(unexpectedTrackedDrift.overall, 'FAIL');
  assert.deepEqual(await readFile(join(root, '.omcodex.lock.json')), lockBeforeUnexpectedDrift);

  const invalidLock = await run('.omcodex.lock.json', 'invalid-lock-evidence', {
    generatedCount: 242,
  });
  assert.equal(invalidLock.overall, 'FAIL');
  assert.equal(
    JSON.parse(await readFile(join(invalidLock.evidenceDir, 'manifest.json'), 'utf8'))
      .evidence_safe,
    true
  );

  const packageBefore = await readFile(join(root, 'package.json'), 'utf8');
  const unsafeOutput = await run('package.json', 'unsafe-output-evidence');
  assert.equal(unsafeOutput.overall, 'FAIL');
  assert.equal(unsafeOutput.evidence_safe, true);
  const unsafeManifest = JSON.parse(
    await readFile(join(unsafeOutput.evidenceDir, 'manifest.json'), 'utf8')
  );
  const unsafeContractGate = unsafeManifest.gates.find(
    ({ name }) => name === 'canonical-lock-contract'
  );
  assert.match(
    await readFile(join(unsafeOutput.evidenceDir, unsafeContractGate.log), 'utf8'),
    /exactly \.omcodex\.lock\.json/i
  );
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), packageBefore);
});
