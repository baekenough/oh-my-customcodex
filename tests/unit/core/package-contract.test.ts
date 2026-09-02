import { describe, expect, it } from 'bun:test';

import packageJson from '../../../package.json';
import { VERSION } from '../../../src/index.js';

const requiredNodeRange = '>=23.5.0 || ^22.13.0 || ^20.17.0';
const inquirerPackageJson = await Bun.file(
  new URL('../../../node_modules/@inquirer/prompts/package.json', import.meta.url)
).json();
const packageVerifier = await Bun.file(
  new URL('../../../scripts/verify-package-contract.mjs', import.meta.url)
).text();
const bunLock = await Bun.file(new URL('../../../bun.lock', import.meta.url)).text();
const documentedNodeRequirement = 'Node.js 20.17+/22.13+/23.5+';
const publicPrerequisiteDocs = await Promise.all(
  ['README.md', 'README_ko.md', 'docs/guide/getting-started.md'].map(async (path) => ({
    path,
    content: await Bun.file(new URL(`../../../${path}`, import.meta.url)).text(),
  }))
);

describe('public package contract', () => {
  it('uses package metadata as the public VERSION source', () => {
    expect(VERSION).toBe(packageJson.version);
  });

  it('keeps the Bun root workspace identity aligned with the public package', () => {
    const rootWorkspaceName = bunLock.match(
      /"workspaces"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"([^"]+)"/
    )?.[1];

    expect(rootWorkspaceName).toBe(packageJson.name);
  });

  it('pins prompts while declaring the safe transitive Node lanes', () => {
    expect(packageJson.dependencies['@inquirer/prompts']).toBe(inquirerPackageJson.version);
    expect(packageJson.engines.node).toBe(requiredNodeRange);
  });

  it.each([
    ['20.17.0', true],
    ['20.16.1', false],
    ['21.7.0', false],
    ['22.13.0', true],
    ['22.12.9', false],
    ['23.5.0', true],
    ['23.4.9', false],
    ['24.0.0', true],
  ])('declares Node %s support accurately', (version, supported) => {
    expect(Bun.semver.satisfies(version, packageJson.engines.node)).toBe(supported);
  });

  it.each(publicPrerequisiteDocs)('documents the Node lanes in $path', ({ content }) => {
    expect(content.replaceAll('**', '')).toContain(documentedNodeRequirement);
  });

  it('builds the declarations referenced by the public exports map', () => {
    expect(packageJson.exports['.'].types).toBe('./dist/index.d.ts');
    expect(packageJson.scripts.build).toContain('tsc --project tsconfig.build.json');
  });

  it('makes both registry artifact contracts mandatory before publishing', () => {
    expect(packageJson.scripts['verify:package']).toBe('node scripts/verify-package-contract.mjs');
    expect(packageJson.scripts.prepublishOnly).toContain('bun run verify:package');
    expect(packageVerifier).toContain("SCOPED_PACKAGE_NAME = '@baekenough/oh-my-customcodex'");
    expect(packageVerifier).toContain('assertArtifactParity(unscopedArtifact, scopedArtifact)');
    expect(packageVerifier).toContain('packageName: SCOPED_PACKAGE_NAME');
    expect(packageVerifier).toContain('npm 10 still prints `prepare` lifecycle output');
    expect(packageVerifier).toContain("join(setupHooksDirectory, 'setup-hooks.sh')");
  });

  it('keeps the source-checkout offline release command build-first, version-dynamic, and rerunnable', async () => {
    const offlineRelease = packageJson.scripts['verify:release:offline'];
    const offlineWrapperFile = Bun.file(
      new URL('../../../scripts/verify-release-offline.mjs', import.meta.url)
    );

    expect(offlineRelease).toBe('bun run build && node scripts/verify-release-offline.mjs');
    expect(await offlineWrapperFile.exists()).toBe(true);
    const offlineWrapper = await offlineWrapperFile.text();
    expect(offlineWrapper).toContain("'--mode', 'offline'");
    expect(offlineWrapper).toContain("'--evidence-dir'");
    expect(offlineWrapper).toContain('randomUUID()');
    expect(offlineWrapper).toContain('tmpdir()');
    expect(offlineWrapper).not.toContain('tmp/release-evidence/offline');
    expect(offlineWrapper).not.toContain('mkdir');
    expect(offlineRelease).not.toMatch(/\b\d+\.\d+\.\d+\b/);
    expect(offlineRelease).not.toContain('env -u');
    expect(offlineRelease).not.toContain('--canonical-lock-output');
  });

  it('enables lifecycle scripts only inside fully isolated clean consumers', () => {
    const consumerFunction = packageVerifier.slice(
      packageVerifier.indexOf('async function verifyCleanConsumer'),
      packageVerifier.indexOf('async function main')
    );
    expect(consumerFunction).not.toContain("'--ignore-scripts'");
    expect(consumerFunction).toContain("npm_config_ignore_scripts: 'false'");
    expect(consumerFunction).toContain('npm_config_userconfig');
    expect(consumerFunction).toContain('npm_config_cache');
    expect(consumerFunction).toContain('npm_config_prefix');
    expect(consumerFunction).toContain('CODEX_HOME');
    expect(consumerFunction).toContain('delete consumerEnv.NODE_PATH');
  });

  it('verifies the fifth validated handler and foreign PreToolUse preservation', () => {
    expect(packageVerifier).toContain("'shell-reserved-var-advisor.sh'");
    expect(packageVerifier).toContain('foreign PreToolUse group order or content changed');
    expect(packageVerifier).toContain("hook.command.includes('# omcustomcodex-hook:')");
    expect(packageVerifier).toContain('assertManagedHookMarkersExactlyOnce');
    expect(packageVerifier).toContain('managed hook marker must appear exactly once');
    expect(
      packageVerifier.match(/assertManagedHookMarkersExactlyOnce\(/g)?.length
    ).toBeGreaterThanOrEqual(3);
    expect(packageVerifier).toContain('foreign hook command executed during install');
    expect(packageVerifier).toContain('foreign hook command executed during update');
    expect(packageVerifier).toContain(
      'native hook update overwrote a user-modified managed script'
    );
    expect(packageVerifier).toContain('second native hook update changed the registry bytes');
    expect(packageVerifier).toContain('second native hook update changed the user-modified script');
  });
});
