import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CRITICAL_NATIVE_REGRESSION_FILES,
  extractStableBatchInventory,
  extractTestJobEnvironment,
  RELEASE_LIFECYCLE_REGRESSION_FILES,
  WORKFLOW_INVENTORY_GUARDS,
} from './workflow-test-inventory.js';

const CI_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/ci.yml');
const RELEASE_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/release.yml');

async function readWorkflow(): Promise<string> {
  return readFile(RELEASE_WORKFLOW, 'utf-8');
}

function extractJob(content: string, jobName: string): string {
  const start = content.search(new RegExp(`^  ${jobName}:`, 'm'));
  expect(start).toBeGreaterThan(-1);
  const rest = content.slice(start);
  const nextJob = rest.slice(1).search(/^ {2}[a-zA-Z0-9_-]+:/m);
  return nextJob === -1 ? rest : rest.slice(0, nextJob + 1);
}

describe('release.yml — file existence', () => {
  it('should exist at .github/workflows/release.yml', async () => {
    const content = await readWorkflow();
    expect(content.length).toBeGreaterThan(0);
  });
});

describe('release.yml — trigger conditions', () => {
  it('should trigger on v* tag pushes', async () => {
    const content = await readWorkflow();
    expect(content).toContain('tags:');
    expect(content).toContain("- 'v*'");
  });
});

describe('release.yml — stable Bun test inventory', () => {
  it('provides deterministic OMX model lanes to the test job', async () => {
    expect(extractTestJobEnvironment(await readWorkflow())).toMatchObject({
      OMX_DEFAULT_FRONTIER_MODEL: 'test-frontier-model',
      OMX_DEFAULT_SPARK_MODEL: 'test-spark-model',
    });
  });

  it('includes every critical native and release-lifecycle regression plus both inventory guards', async () => {
    const inventory = extractStableBatchInventory(await readWorkflow());

    for (const testPath of [
      ...CRITICAL_NATIVE_REGRESSION_FILES,
      ...RELEASE_LIFECYCLE_REGRESSION_FILES,
      ...WORKFLOW_INVENTORY_GUARDS,
    ]) {
      expect(inventory).toContain(testPath);
    }
  });

  it('stays synchronized with the CI workflow inventory', async () => {
    const [ciContent, releaseContent] = await Promise.all([
      readFile(CI_WORKFLOW, 'utf-8'),
      readWorkflow(),
    ]);

    expect(extractStableBatchInventory(releaseContent)).toEqual(
      extractStableBatchInventory(ciContent)
    );
  });
});

describe('release.yml — CI gate', () => {
  it('should define a gate job before publish work begins', async () => {
    const content = await readWorkflow();
    expect(content).toContain('gate:');
    expect(content).toContain('name: Gate Release On CI');
  });

  it('should compute required workflows from the tagged commit changed files', async () => {
    const content = await readWorkflow();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell snippet assertion
    expect(content).toContain('git show -m --pretty="" --name-only "${tag_sha}"');
    expect(content).toContain('required_workflows=("CI")');
    expect(content).toContain('required_workflows+=("Docs Sync")');
    expect(content).toContain('required_workflows+=("Wiki Sync")');
  });

  it('should make test and docs validation depend on the gate job', async () => {
    const content = await readWorkflow();
    expect(content).toContain('test:');
    expect(content).toContain('needs: [gate]');
    expect(content).toContain('docs-validate:');
  });
});

describe('release.yml — publish safeguards', () => {
  it('keeps tests read-only and credential-free while preserving publish and verification auth', async () => {
    const content = await readWorkflow();
    const testJob = extractJob(content, 'test');
    const publishJob = extractJob(content, 'publish');
    const verifyJob = extractJob(content, 'verify-release');
    const testCheckoutIndex = testJob.indexOf('- name: Checkout');
    const testSetupBunIndex = testJob.indexOf('- name: Setup Bun');
    const testCheckoutStep = testJob.slice(testCheckoutIndex, testSetupBunIndex);

    expect(testJob).toContain('permissions:\n      contents: read\n    env:');
    expect(testCheckoutIndex).toBeGreaterThan(-1);
    expect(testSetupBunIndex).toBeGreaterThan(testCheckoutIndex);
    expect(testCheckoutStep).toContain('persist-credentials: false');
    expect(testJob).toContain('- name: Setup Node.js for npm');
    expect(testJob).not.toContain('registry-url:');
    expect(testJob).not.toContain('NODE_AUTH_TOKEN:');

    expect(publishJob).toContain("registry-url: 'https://registry.npmjs.org'");
    expect(publishJob).toContain(`NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}`);
    expect(publishJob).toContain("registry-url: 'https://npm.pkg.github.com'");
    expect(publishJob).toContain(`NODE_AUTH_TOKEN: \${{ secrets.GITHUB_TOKEN }}`);

    expect(verifyJob).toContain(
      '- name: Prefetch trusted release inputs without lifecycle scripts'
    );
    expect(verifyJob).toContain(`NODE_AUTH_TOKEN: \${{ secrets.GITHUB_TOKEN }}`);
  });

  it('should verify version sync before npm publish checks', async () => {
    const content = await readWorkflow();
    const verifyBuildIndex = content.indexOf('- name: Verify build artifacts');
    const verifyVersionSyncIndex = content.indexOf('- name: Verify version sync');
    const checkNpmVersionIndex = content.indexOf('- name: Check npm version');
    const publishIndex = content.indexOf('- name: Publish to npm');

    expect(verifyBuildIndex).toBeGreaterThan(-1);
    expect(verifyVersionSyncIndex).toBeGreaterThan(verifyBuildIndex);
    expect(checkNpmVersionIndex).toBeGreaterThan(verifyVersionSyncIndex);
    expect(publishIndex).toBeGreaterThan(checkNpmVersionIndex);
    expect(content).toContain('run: bash .github/scripts/verify-version-sync.sh');
  });

  it('should retry transient npm provenance Rekor publish failures before failing', async () => {
    const content = await readWorkflow();

    expect(content).toContain('MAX_PUBLISH_ATTEMPTS=3');
    expect(content).toContain('TLOG_CREATE_ENTRY_ERROR');
    expect(content).toContain('rekor\\.sigstore\\.dev');
    expect(content).toContain('Invalid response body.*aborted');
    expect(content).toContain('npm provenance/Rekor transient publish failure detected');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions bash snippet assertion
    expect(content).toContain('publish_exit=${PIPESTATUS[0]}');
  });

  it('should fail release publish when CHANGELOG lacks the tagged version section', async () => {
    const content = await readWorkflow();

    expect(content).toContain(
      'CHANGELOG.md not found. Release PRs must promote changelog entries before tagging.'
    );
    expect(content).toContain('No changelog entry found for version $' + '{VERSION}.');
    expect(content).toContain(
      "Add a '## [$" +
        "{VERSION}] - YYYY-MM-DD' section to CHANGELOG.md before creating the release tag."
    );
    expect(content).toContain('generate_release_notes: false');
    expect(content).not.toContain('Will use auto-generated release notes');
  });

  it('runs the canonical offline verifier once after build and uploads its safe manifest', async () => {
    const testJob = extractJob(await readWorkflow(), 'test');
    const buildIndex = testJob.indexOf('- name: Build');
    const verifierIndex = testJob.indexOf('node scripts/verify-release-contract.mjs');
    expect(verifierIndex).toBeGreaterThan(buildIndex);
    expect(testJob.match(/node scripts\/verify-release-contract\.mjs/g)).toHaveLength(1);
    expect(testJob).toContain('--mode offline');
    expect(testJob).not.toContain('node scripts/verify-package-contract.mjs');
    expect(testJob).toContain('name: offline-release-evidence');
  });

  it('verifies the exact tag through the canonical live verifier before registry evidence upload', async () => {
    const verifyJob = extractJob(await readWorkflow(), 'verify-release');
    const checkoutIndex = verifyJob.indexOf('- name: Checkout tagged source');
    const credentialBoundaryIndex = verifyJob.indexOf(
      '- name: Assert checkout credential boundary'
    );
    const prefetchIndex = verifyJob.indexOf(
      '- name: Prefetch trusted release inputs without lifecycle scripts'
    );
    const liveIndex = verifyJob.indexOf('- name: Run canonical live verifier');
    const uploadIndex = verifyJob.indexOf('- name: Upload live release evidence');
    const prefetchStep = verifyJob.slice(prefetchIndex, liveIndex);
    const credentialBoundaryStep = verifyJob.slice(credentialBoundaryIndex, liveIndex);
    const liveStep = verifyJob.slice(liveIndex, uploadIndex);
    expect(verifyJob).toContain(
      'permissions:\n      actions: read\n      contents: read\n      packages: read'
    );
    expect(verifyJob).not.toContain('contents: write');
    expect(verifyJob).not.toContain('packages: write');
    expect(verifyJob).not.toContain('id-token: write');
    expect(verifyJob).toContain('fetch-depth: 0');
    expect(verifyJob.slice(checkoutIndex, prefetchIndex)).toContain('persist-credentials: false');
    expect(credentialBoundaryIndex).toBeGreaterThan(prefetchIndex);
    expect(credentialBoundaryIndex).toBeLessThan(liveIndex);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell snippet assertion
    expect(credentialBoundaryStep).toContain('git config "${config_scope}" --get-regexp');
    expect(credentialBoundaryStep).toContain(
      "credential_pattern='^(http(\\..*)?\\.extraheader|credential(\\..*)?\\.(helper|username|password|token))$'"
    );
    expect(credentialBoundaryStep).not.toContain('(?:');
    expect(credentialBoundaryStep).toContain('credential_status=$?');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell snippet assertion
    expect(credentialBoundaryStep).toContain('case "${credential_status}" in');
    expect(credentialBoundaryStep).toMatch(
      /0\)[\s\S]*return 1[\s\S]*1\)[\s\S]*return 0[\s\S]*\*\)[\s\S]*return 1/
    );
    expect(credentialBoundaryStep.match(/assert_no_git_credentials --local/g)).toHaveLength(1);
    expect(credentialBoundaryStep.match(/assert_no_git_credentials --global/g)).toHaveLength(1);
    expect(verifyJob).toContain('name: offline-release-evidence');
    expect(verifyJob).toContain('sha256sum --check SHA256SUMS');
    expect(verifyJob).toContain('node scripts/verify-release-contract.mjs');
    expect(verifyJob).toContain('--mode live');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
    expect(verifyJob).toContain('--expected-source-sha "${{ github.sha }}"');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell expression
    expect(verifyJob).toContain('--tag "v${VERSION}"');
    expect(verifyJob).toContain('chmod 0600');
    expect(verifyJob).toContain("'ignore-scripts=true'");
    expect(prefetchIndex).toBeGreaterThan(-1);
    expect(liveIndex).toBeGreaterThan(prefetchIndex);
    expect(prefetchStep.indexOf(`git rev-parse "v\${VERSION}^{commit}"`)).toBeLessThan(
      prefetchStep.indexOf(`npm view "oh-my-customcodex@\${VERSION}"`)
    );
    expect(prefetchStep.indexOf(`git rev-parse "v\${VERSION}^{commit}"`)).toBeLessThan(
      prefetchStep.indexOf(`gh release view "v\${VERSION}"`)
    );
    expect(prefetchStep).toContain('npm pack --ignore-scripts');
    expect(prefetchStep).toContain('cleanup_auth');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell variable assertion
    expect(prefetchStep).toContain('npmrc_file="${RUNNER_TEMP}/omcustomcodex-release-');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell variable assertion
    expect(prefetchStep).toContain('chmod 0600 "${npmrc_file}"');
    expect(prefetchStep).toContain('trap cleanup_auth EXIT');
    expect(prefetchStep).toContain(`NODE_AUTH_TOKEN: \${{ secrets.GITHUB_TOKEN }}`);
    expect(liveStep).toContain('--live-input-dir');
    expect(liveStep).toContain(`unset "\${name}"`);
    expect(liveStep).toContain(
      'unset GITHUB_OUTPUT GITHUB_ENV GITHUB_PATH GITHUB_STATE GITHUB_STEP_SUMMARY'
    );
    expect(
      liveStep.indexOf(
        'unset GITHUB_OUTPUT GITHUB_ENV GITHUB_PATH GITHUB_STATE GITHUB_STEP_SUMMARY'
      )
    ).toBeLessThan(liveStep.indexOf('node scripts/verify-release-contract.mjs'));
    expect(liveStep).not.toContain('GH_TOKEN:');
    expect(liveStep).not.toContain('NODE_AUTH_TOKEN:');
    expect(verifyJob).toContain("steps.live_verify.outputs.evidence_safe == 'true'");
    expect(verifyJob).toContain('if: always()');
    expect(liveStep).not.toContain('npm view');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
    expect(verifyJob).not.toContain('gh api repos/${{ github.repository }}/releases/tags/');
  });

  it('suppresses tainted artifacts and fails only after the safe upload opportunity', async () => {
    const verifyJob = extractJob(await readWorkflow(), 'verify-release');
    const verifyIndex = verifyJob.indexOf('- name: Run canonical live verifier');
    const uploadIndex = verifyJob.indexOf('- name: Upload live release evidence');
    const failIndex = verifyJob.indexOf('- name: Enforce live verification result');
    expect(uploadIndex).toBeGreaterThan(verifyIndex);
    expect(failIndex).toBeGreaterThan(uploadIndex);
    expect(verifyJob).toContain('unsafe evidence suppressed');
  });
});
