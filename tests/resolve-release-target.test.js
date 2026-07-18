import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectGitHubPackagesProbe,
  collectNpmProbe,
  compareStableVersions,
  parseStableVersion,
  RESOLVE_RELEASE_TARGET_USAGE,
  resolveReleaseTarget,
} from '../scripts/resolve-release-target.mjs';

function okProbe(id, versions) {
  return { id, status: 'ok', versions };
}

function absentProbe(source, id) {
  const proof = {
    id,
    status: 'verified-absent',
    versions: [],
    registryReachable: true,
  };
  if (source === 'npm') {
    proof.npmPackageListVerified = true;
  } else {
    proof.githubPackagesListVerified = true;
  }
  return proof;
}

function baseInput(overrides = {}) {
  return {
    packageName: 'oh-my-customcodex',
    scopedPackageName: '@baekenough/oh-my-customcodex',
    measuredAt: '2026-07-16T00:00:00.000Z',
    sourceSha: 'abc123',
    probes: {
      git: okProbe('git-tags', ['v1.0.22']),
      npm: okProbe('npm-public', ['1.0.23']),
      ghp: okProbe('github-packages-authenticated', ['1.0.23']),
    },
    ...overrides,
  };
}

test('stable semver parser accepts strict releases and ignores prereleases', () => {
  assert.deepEqual(parseStableVersion('v1.2.3'), { major: 1, minor: 2, patch: 3 });
  assert.equal(parseStableVersion('1.2.3-rc.1'), null);
  assert.equal(parseStableVersion('1.2'), null);
  assert.equal(parseStableVersion('01.2.3'), null);
  assert.equal(parseStableVersion(' 1.2.3 '), null);
  assert.equal(compareStableVersions('1.2.3', '1.3.0'), -1);
});

test('uses the stable maximum across Git, public npm, and GitHub Packages', () => {
  const result = resolveReleaseTarget(baseInput());

  assert.equal(result.gitLatest, '1.0.22');
  assert.equal(result.npmLatest, '1.0.23');
  assert.equal(result.ghpLatest, '1.0.23');
  assert.equal(result.baseVersion, '1.0.23');
  assert.equal(result.targetVersion, '1.0.24');
  assert.equal(result.probes.ghp.id, 'github-packages-authenticated');
});

for (const source of ['git', 'npm', 'ghp']) {
  test(`advances past a newer stable version found in ${source}`, () => {
    const input = baseInput();
    input.probes[source] = okProbe(`${source}-probe`, ['1.0.24']);
    assert.equal(resolveReleaseTarget(input).targetVersion, '1.0.25');
  });
}

test('prereleases never outrank the stable maximum', () => {
  const input = baseInput();
  input.probes.git.versions.push('v9.0.0-rc.1');
  input.probes.npm.versions.push('2.0.0-beta.2');
  input.probes.ghp.versions.push('3.0.0-alpha.1');

  assert.equal(resolveReleaseTarget(input).targetVersion, '1.0.24');
});

test('treats expected-target as an assertion and never as a version override', () => {
  assert.equal(
    resolveReleaseTarget(baseInput({ expectedTarget: '1.0.24' })).targetVersion,
    '1.0.24'
  );
  assert.throws(
    () => resolveReleaseTarget(baseInput({ expectedTarget: '9.0.0' })),
    /expected target mismatch.*9\.0\.0.*1\.0\.24/i
  );
  assert.doesNotMatch(RESOLVE_RELEASE_TARGET_USAGE, /proposed-target/);
  assert.match(RESOLVE_RELEASE_TARGET_USAGE, /expected-target/);
});

for (const source of ['npm', 'ghp']) {
  for (const status of ['network-error', 'auth-error', 'parse-error', 'empty']) {
    test(`fails closed for ${source} ${status}`, () => {
      const input = baseInput();
      input.probes[source] = { id: `${source}-probe`, status, versions: [] };
      assert.throws(() => resolveReleaseTarget(input), new RegExp(`${source}.*${status}`, 'i'));
    });
  }
}

test('accepts only a proven first-release registry absence', () => {
  const proven = baseInput();
  proven.probes.npm = absentProbe('npm', 'npm-public');
  proven.probes.ghp = absentProbe('ghp', 'github-packages-authenticated');
  const result = resolveReleaseTarget(proven);
  assert.equal(result.targetVersion, '1.0.23');
  assert.equal(result.probes.npm.npmPackageListVerified, true);
  assert.equal(Object.hasOwn(result.probes.npm, 'githubPackagesListVerified'), false);
  assert.equal(result.probes.ghp.githubPackagesListVerified, true);
  assert.equal(Object.hasOwn(result.probes.ghp, 'npmPackageListVerified'), false);

  const ambiguous = baseInput();
  ambiguous.probes.ghp = {
    id: 'github-packages-authenticated',
    status: 'verified-absent',
    versions: [],
  };
  assert.throws(() => resolveReleaseTarget(ambiguous), /absence.*not verified/i);
});

test('rejects an absence proof that uses fields from the other registry source', () => {
  const npmWithPackageListProof = baseInput();
  npmWithPackageListProof.probes.npm = {
    id: 'npm-public',
    status: 'verified-absent',
    versions: [],
    registryReachable: true,
    githubPackagesListVerified: true,
  };
  assert.throws(() => resolveReleaseTarget(npmWithPackageListProof), /npm.*absence.*not verified/i);

  const npmWithBare404Proof = baseInput();
  npmWithBare404Proof.probes.npm = {
    id: 'npm-public',
    status: 'verified-absent',
    versions: [],
    registryReachable: true,
    exactPackageNotFound: true,
  };
  assert.throws(() => resolveReleaseTarget(npmWithBare404Proof), /npm.*absence.*not verified/i);

  const ghpWithExactPackageProof = baseInput();
  ghpWithExactPackageProof.probes.ghp = {
    id: 'github-packages-authenticated',
    status: 'verified-absent',
    versions: [],
    registryReachable: true,
    npmPackageListVerified: true,
  };
  assert.throws(
    () => resolveReleaseTarget(ghpWithExactPackageProof),
    /ghp.*absence.*not verified/i
  );
});

for (const source of ['npm', 'ghp']) {
  test(`rejects contradictory ${source} absence proof with published versions`, () => {
    const input = baseInput();
    input.probes[source] = absentProbe(
      source,
      source === 'npm' ? 'npm-public' : 'github-packages-authenticated'
    );
    input.probes[source].versions = ['1.0.23'];
    assert.throws(() => resolveReleaseTarget(input), new RegExp(`${source}.*absence`, 'i'));
  });
}

test('increments the synthetic 0.0.0 base once when both registries prove absence', () => {
  const input = baseInput();
  input.probes.git = okProbe('git-tags', []);
  input.probes.npm = absentProbe('npm', 'npm-public');
  input.probes.ghp = absentProbe('ghp', 'github-packages-authenticated');

  assert.equal(resolveReleaseTarget(input).targetVersion, '0.0.1');
});

test('fails an expected-target assertion when a registry advances the measured maximum', () => {
  const input = baseInput({ expectedTarget: '1.0.24' });
  input.probes.ghp = okProbe('github-packages-authenticated', ['1.0.24']);
  assert.throws(() => resolveReleaseTarget(input), /expected target mismatch.*1\.0\.24.*1\.0\.25/i);
});

test('memory disagreement is advisory and output contains no credential details', () => {
  const result = resolveReleaseTarget(baseInput({ memoryVersion: '1.0.21' }));
  assert.equal(result.targetVersion, '1.0.24');
  assert.match(result.warnings.join('\n'), /memory/i);
  assert.equal(result.measuredAt, '2026-07-16T00:00:00.000Z');
  assert.equal(result.sourceSha, 'abc123');
  assert.equal(JSON.stringify(result).includes('token'), false);
});

function ghResult({ ok = true, stdout = '', stderr = '' } = {}) {
  return { ok, status: ok ? 0 : 1, stdout, stderr };
}

test('npm exact-package 404 plus registry ping remains an ambiguous fail-closed probe', () => {
  const calls = [];
  const responses = [
    ghResult({ ok: false, stderr: 'npm error code E404' }),
    ghResult({ stdout: JSON.stringify({ registry: 'https://registry.npmjs.org/' }) }),
  ];
  const probe = collectNpmProbe('oh-my-customcodex', (command, args) => {
    calls.push({ command, args });
    return responses.shift();
  });

  assert.equal(probe.status, 'ambiguous-absence');
  assert.equal(probe.registryReachable, true);
  assert.equal(probe.exactPackageNotFound, true);
  assert.equal(Object.hasOwn(probe, 'npmPackageListVerified'), false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args.slice(0, 3), ['view', 'oh-my-customcodex', 'versions']);
  assert.equal(calls[1].args[0], 'ping');

  const input = baseInput();
  input.probes.npm = probe;
  assert.throws(() => resolveReleaseTarget(input), /npm.*ambiguous-absence/i);
});

test('npm exact-package 404 without a reachable registry remains a network failure', () => {
  const responses = [
    ghResult({ ok: false, stderr: 'npm error code E404' }),
    ghResult({ ok: false, stderr: 'network unavailable' }),
  ];
  const probe = collectNpmProbe('oh-my-customcodex', () => responses.shift());

  assert.equal(probe.status, 'network-error');
  assert.equal(Object.hasOwn(probe, 'exactPackageNotFound'), false);
  const input = baseInput();
  input.probes.npm = probe;
  assert.throws(() => resolveReleaseTarget(input), /npm.*network-error/i);
});

test('GitHub Packages probe requests slurped pagination and flattens multiple pages', () => {
  const calls = [];
  const runner = (command, args) => {
    calls.push({ command, args });
    return ghResult({
      stdout: JSON.stringify([[{ name: '1.0.22' }], [{ name: '1.0.23' }, { name: '2.0.0-rc.1' }]]),
    });
  };

  const probe = collectGitHubPackagesProbe('@baekenough/oh-my-customcodex', runner);

  assert.deepEqual(probe.versions, ['1.0.22', '1.0.23', '2.0.0-rc.1']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'gh');
  assert.deepEqual(calls[0].args.slice(0, 3), ['api', '--paginate', '--slurp']);
  assert.match(calls[0].args[3], /\/versions\?per_page=100$/);
});

for (const status of [401, 403]) {
  test(`GitHub Packages probe fails closed and redacts a ${status} credential error`, () => {
    const secret = 'ghp_do_not_echo_this_secret';
    const probe = collectGitHubPackagesProbe('@baekenough/oh-my-customcodex', () =>
      ghResult({ ok: false, stderr: `HTTP ${status}: token ${secret}` })
    );

    assert.equal(probe.status, 'auth-error');
    assert.equal(JSON.stringify(probe).includes(secret), false);
    const input = baseInput();
    input.probes.ghp = probe;
    assert.throws(() => resolveReleaseTarget(input), /ghp.*auth-error/i);
  });
}

test('a 404 is verified through the paginated package list before first-release absence', () => {
  const calls = [];
  const responses = [
    ghResult({ ok: false, stderr: 'HTTP 404: Not Found' }),
    ghResult({ stdout: JSON.stringify([[{ name: 'some-other-package' }], []]) }),
  ];
  const probe = collectGitHubPackagesProbe('@baekenough/oh-my-customcodex', (command, args) => {
    calls.push({ command, args });
    return responses.shift();
  });

  assert.equal(probe.status, 'verified-absent');
  assert.equal(probe.registryReachable, true);
  assert.equal(probe.githubPackagesListVerified, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args.slice(0, 3), ['api', '--paginate', '--slurp']);
  assert.match(calls[1].args[3], /packages\?package_type=npm&per_page=100$/);
});

test('a 404 remains ambiguous when package listing still finds the package', () => {
  const listedResponses = [
    ghResult({ ok: false, stderr: 'HTTP 404: Not Found' }),
    ghResult({ stdout: JSON.stringify([[{ name: 'oh-my-customcodex' }]]) }),
  ];
  const listed = collectGitHubPackagesProbe('@baekenough/oh-my-customcodex', () =>
    listedResponses.shift()
  );
  assert.equal(listed.status, 'empty');
});

for (const [status, expectedStatus] of [
  [401, 'auth-error'],
  [403, 'auth-error'],
  [404, 'package-list-error'],
]) {
  test(`package-list ${status} fails closed without leaking its credential-bearing stderr`, () => {
    const secret = `ghp_package_list_${status}_secret`;
    const responses = [
      ghResult({ ok: false, stderr: 'HTTP 404: package version endpoint missing' }),
      ghResult({ ok: false, stderr: `HTTP ${status}: credential ${secret}` }),
    ];
    const probe = collectGitHubPackagesProbe('@baekenough/oh-my-customcodex', () =>
      responses.shift()
    );

    assert.equal(probe.status, expectedStatus);
    assert.equal(JSON.stringify(probe).includes(secret), false);
    const input = baseInput();
    input.probes.ghp = probe;
    assert.throws(() => resolveReleaseTarget(input), new RegExp(`ghp.*${expectedStatus}`, 'i'));
  });
}

test('GitHub Packages parse failures never echo response payload secrets', () => {
  const secret = 'ghp_parse_payload_secret';
  assert.throws(
    () =>
      collectGitHubPackagesProbe('@baekenough/oh-my-customcodex', () =>
        ghResult({ stdout: `{not-json:${secret}}` })
      ),
    (error) => {
      assert.match(error.message, /ghp.*parse-error/i);
      assert.equal(error.message.includes(secret), false);
      return true;
    }
  );
});
