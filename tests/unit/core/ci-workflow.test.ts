import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import {
  CRITICAL_NATIVE_REGRESSION_FILES,
  extractRunBunBatchHelper,
  extractStableBatchInventory,
  extractTestJobEnvironment,
  RELEASE_LIFECYCLE_REGRESSION_FILES,
  WORKFLOW_INVENTORY_GUARDS,
} from './workflow-test-inventory.js';

const CI_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/ci.yml');
const RELEASE_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/release.yml');
const AUTO_TAG_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/auto-tag.yml');
const DEPLOY_TEST_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/deploy-test.yml');

interface WorkflowStep {
  name?: string;
  id?: string;
  run?: string;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  name?: string;
  steps?: WorkflowStep[];
}

interface WorkflowDocument {
  name?: string;
  on?: {
    pull_request?: {
      branches?: string[];
    };
  };
  jobs?: Record<string, WorkflowJob>;
}

async function readWorkflow(): Promise<string> {
  return readFile(CI_WORKFLOW, 'utf-8');
}

function parseWorkflow(content: string): WorkflowDocument {
  return parse(content) as WorkflowDocument;
}

function requireJob(workflow: WorkflowDocument, jobName: string): WorkflowJob {
  const job = workflow.jobs?.[jobName];
  if (!job) {
    throw new Error(`Workflow job not found: ${jobName}`);
  }
  return job;
}

function extractRequiredWorkflowNames(workflow: WorkflowDocument): string[] {
  const names = new Set<string>();

  for (const job of Object.values(workflow.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      for (const assignment of step.run?.matchAll(/required_workflows\+?=\(([^)]*)\)/g) ?? []) {
        for (const name of assignment[1].matchAll(/["']([^"']+)["']/g)) {
          names.add(name[1]);
        }
      }
    }
  }

  return [...names];
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

  it('uses the TypeScript validator as the only entry-document count gate', async () => {
    const content = await readWorkflow();

    expect(content).not.toMatch(/grep\s+-[^\n]*P/);
    expect(content).not.toContain('Verify entry doc counts');
    expect(content).not.toContain('DOC_AGENTS=');
    expect(content).not.toContain('DOC_SKILLS=');
    expect(content).not.toContain('DOC_GUIDES=');
    expect(content).not.toContain('|| echo "0"');
  });

  it('names bun.lock accurately in every lockfile diagnostic', async () => {
    const content = await readWorkflow();

    expect(content).toContain('bun.lock is out of sync');
    expect(content).not.toContain('bun.lockb');
  });
});

describe('ci.yml — offline release evidence', () => {
  it('builds once and invokes the canonical offline verifier once with the package version', async () => {
    const content = await readWorkflow();
    const steps = requireJob(parseWorkflow(content), 'package-contract').steps ?? [];
    const buildSteps = steps.filter((step) =>
      step.run?.split(/\r?\n/).some((line) => line.trim() === 'bun run build')
    );
    const verifierSteps = steps.filter((step) =>
      step.run?.includes('node scripts/verify-release-contract.mjs')
    );

    expect(buildSteps).toHaveLength(1);
    expect(verifierSteps).toHaveLength(1);
    expect(steps.indexOf(verifierSteps[0])).toBeGreaterThan(steps.indexOf(buildSteps[0]));
    expect(verifierSteps[0].id).toBe('offline_release_contract');
    expect(verifierSteps[0].run).toContain(
      'PACKAGE_VERSION=$(node -p "require(\'./package.json\').version")'
    );
    expect(verifierSteps[0].run).toContain('--mode offline');
    expect(verifierSteps[0].run).toContain('--version "$PACKAGE_VERSION"');
    expect(content).not.toContain('1.0.24');
  });

  it('uploads only the offline evidence directory even when verification fails', async () => {
    const steps = requireJob(parseWorkflow(await readWorkflow()), 'package-contract').steps ?? [];
    const uploadSteps = steps.filter((step) => step.uses?.startsWith('actions/upload-artifact@'));

    expect(uploadSteps).toHaveLength(1);
    expect(uploadSteps[0].if).toBe(
      `\${{ always() && steps.offline_release_contract.outputs.evidence_safe == 'true' }}`
    );
    expect(uploadSteps[0].with?.path).toBe(
      `/tmp/omcustomcodex-release-\${{ github.run_id }}-\${{ github.run_attempt }}-offline`
    );
  });
});

describe('deploy-test.yml — preserved parent-port disposition', () => {
  it('stays off develop and outside CI and tag/release required-workflow lists', async () => {
    const [deployTestContent, ciContent, autoTagContent, releaseContent] = await Promise.all([
      readFile(DEPLOY_TEST_WORKFLOW, 'utf-8'),
      readWorkflow(),
      readFile(AUTO_TAG_WORKFLOW, 'utf-8'),
      readFile(RELEASE_WORKFLOW, 'utf-8'),
    ]);
    const deployTestWorkflow = parseWorkflow(deployTestContent);
    const ciWorkflow = parseWorkflow(ciContent);
    const requiredWorkflowLists = [
      extractRequiredWorkflowNames(parseWorkflow(autoTagContent)),
      extractRequiredWorkflowNames(parseWorkflow(releaseContent)),
    ];

    expect(deployTestWorkflow.on?.pull_request?.branches).toEqual(['release/**']);
    expect(deployTestWorkflow.on?.pull_request?.branches).not.toContain('develop');
    expect(
      Object.values(ciWorkflow.jobs ?? {}).some((job) => job.name?.includes('Deploy Test'))
    ).toBe(false);
    expect(Object.keys(ciWorkflow.jobs ?? {})).not.toContain('deploy-test');
    for (const requiredWorkflows of requiredWorkflowLists) {
      expect(requiredWorkflows).toContain('CI');
      expect(requiredWorkflows).not.toContain('Deploy Test');
    }
  });
});

describe('ci.yml — stable Bun test inventory', () => {
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
