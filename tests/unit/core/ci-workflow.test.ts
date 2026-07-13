import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CRITICAL_NATIVE_REGRESSION_FILES,
  extractRunBunBatchHelper,
  extractStableBatchInventory,
  extractTestJobEnvironment,
  WORKFLOW_INVENTORY_GUARDS,
} from './workflow-test-inventory.js';

const CI_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/ci.yml');
const RELEASE_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/release.yml');

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

describe('ci.yml — stable Bun test inventory', () => {
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

  it('stays synchronized with the release workflow inventory', async () => {
    const [ciContent, releaseContent] = await Promise.all([
      readWorkflow(),
      readFile(RELEASE_WORKFLOW, 'utf-8'),
    ]);

    expect(extractStableBatchInventory(ciContent)).toEqual(
      extractStableBatchInventory(releaseContent)
    );
  });

  it('keeps both helpers synchronized and fails closed after a partial pass then crash', async () => {
    const [ciContent, releaseContent] = await Promise.all([
      readWorkflow(),
      readFile(RELEASE_WORKFLOW, 'utf-8'),
    ]);
    const helper = extractRunBunBatchHelper(ciContent);
    expect(helper).toBe(extractRunBunBatchHelper(releaseContent));

    const fakeBin = await mkdtemp(join(tmpdir(), 'omcodex-workflow-bun-'));
    try {
      await writeFile(
        join(fakeBin, 'bun'),
        [
          '#!/bin/bash',
          'echo "(pass) earlier test completed"',
          'echo "error: simulated loader crash after a passing test" >&2',
          'exit 2',
          '',
        ].join('\n'),
        { mode: 0o755 }
      );
      const script = [
        'set -e -o pipefail',
        helper,
        'run_bun_batch "workflow-test-inventory" tests/unit/core/ci-workflow.test.ts',
        'echo "SUBSEQUENT_BATCH_REACHED"',
        '',
      ].join('\n');
      const result = spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
      });
      const output = `${result.stdout}${result.stderr}`;

      expect(result.status).toBe(1);
      expect(output).toContain('workflow-test-inventory failed with exit 2');
      expect(output).not.toContain('SUBSEQUENT_BATCH_REACHED');
    } finally {
      await rm(fakeBin, { recursive: true, force: true });
    }
  });
});
