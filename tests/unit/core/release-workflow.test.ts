import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CRITICAL_NATIVE_REGRESSION_FILES,
  extractStableBatchInventory,
  extractTestJobEnvironment,
  WORKFLOW_INVENTORY_GUARDS,
} from './workflow-test-inventory.js';

const CI_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/ci.yml');
const RELEASE_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/release.yml');

async function readWorkflow(): Promise<string> {
  return readFile(RELEASE_WORKFLOW, 'utf-8');
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

  it('includes every v1.0.10 native regression and both inventory guards', async () => {
    const inventory = extractStableBatchInventory(await readWorkflow());

    for (const testPath of [...CRITICAL_NATIVE_REGRESSION_FILES, ...WORKFLOW_INVENTORY_GUARDS]) {
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

  it('should verify GitHub Packages through authenticated Packages API with exact version matching', async () => {
    const content = await readWorkflow();

    expect(content).not.toContain('continue-on-error: true');
    expect(content).toContain(
      'PACKAGE_API="/users/baekenough/packages/npm/oh-my-customcodex/versions?per_page=100"'
    );
    expect(content).toContain('GH_TOKEN: $' + '{{ secrets.GITHUB_TOKEN }}');
    expect(content).toContain('jq -r --arg version "$' + '{VERSION}"');
    expect(content).toContain('map(select(.name == $version)) | first | .name // ""');
    expect(content).toContain(
      '@baekenough/oh-my-customcodex@$' + '{VERSION} confirmed by Packages API'
    );
  });

  it('should fail GitHub Packages verification on auth/config errors and retry only eventual consistency', async () => {
    const content = await readWorkflow();

    expect(content).toContain("grep -qE 'HTTP 404|Not Found'");
    expect(content).toContain('treating as eventual consistency');
    expect(content).toContain('GitHub Packages API verification failed before exact version check');
    expect(content).toContain('was not confirmed after $' + '{MAX_ATTEMPTS} attempts');
    expect(content).toContain('exit 1');
    expect(content).toContain('API ERROR');
  });
});
