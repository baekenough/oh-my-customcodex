import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
});
