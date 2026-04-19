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
    expect(content).toContain('git show --pretty="" --name-only "${tag_sha}"');
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
