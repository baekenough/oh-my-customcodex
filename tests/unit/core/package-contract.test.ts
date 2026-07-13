import { describe, expect, it } from 'bun:test';

import packageJson from '../../../package.json';
import { VERSION } from '../../../src/index.js';

const requiredNodeRange = '>=23.5.0 || ^22.13.0 || ^20.17.0';
const inquirerPackageJson = await Bun.file(
  new URL('../../../node_modules/@inquirer/prompts/package.json', import.meta.url)
).json();
const ciWorkflow = await Bun.file(
  new URL('../../../.github/workflows/ci.yml', import.meta.url)
).text();
const releaseWorkflow = await Bun.file(
  new URL('../../../.github/workflows/release.yml', import.meta.url)
).text();
const packageVerifier = await Bun.file(
  new URL('../../../scripts/verify-package-contract.mjs', import.meta.url)
).text();
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
    expect(ciWorkflow).toContain('bun run verify:package');
    expect(packageVerifier).toContain("SCOPED_PACKAGE_NAME = '@baekenough/oh-my-customcodex'");
    expect(packageVerifier).toContain('assertArtifactParity(unscopedArtifact, scopedArtifact)');
    expect(packageVerifier).toContain('packageName: SCOPED_PACKAGE_NAME');
    expect(releaseWorkflow).toContain('Verify npm and GitHub Packages artifact parity');
    expect(releaseWorkflow).toContain('node scripts/verify-package-contract.mjs --skip-build');
    expect(releaseWorkflow).toContain('.name = "@baekenough/oh-my-customcodex"');
    expect(releaseWorkflow).toContain('"registry": "https://npm.pkg.github.com"');
    expect(releaseWorkflow).toContain('needs: [test, docs-validate]');
  });
});
