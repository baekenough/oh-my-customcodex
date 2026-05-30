import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CI_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/ci.yml');

async function readWorkflow(): Promise<string> {
  return readFile(CI_WORKFLOW, 'utf-8');
}

function extractJob(content: string, jobName: string): string {
  const start = content.search(new RegExp(`^  ${jobName}:`, 'm'));
  expect(start).toBeGreaterThan(-1);

  const rest = content.slice(start);
  const nextJob = rest.slice(1).search(/^ {2}[a-zA-Z0-9_-]+:/m);
  return nextJob === -1 ? rest : rest.slice(0, nextJob + 1);
}

describe('ci.yml — documentation validation', () => {
  it('runs programmatic documentation validation after lockfile sync', async () => {
    const content = await readWorkflow();
    const docsValidateJob = extractJob(content, 'docs-validate');

    expect(docsValidateJob).toContain('name: Validate Documentation');
    expect(docsValidateJob).toContain('needs: [lockfile-sync]');
    expect(docsValidateJob).toContain(
      'bun run .github/scripts/validate-docs.ts --programmatic-only'
    );
  });
});
