import { parse } from 'yaml';

export const CRITICAL_NATIVE_REGRESSION_FILES = [
  'tests/e2e/native-agent-omx.test.ts',
  'tests/integration/omx-readiness.test.ts',
  'tests/unit/cli/doctor-omx-readiness.test.ts',
  'tests/unit/cli/doctor-omx.test.ts',
  'tests/unit/cli/init-orchestration.test.ts',
  'tests/unit/core/agent-compiler.test.ts',
  'tests/unit/core/codex-hooks-integration.test.ts',
  'tests/unit/core/codex-hooks.test.ts',
  'tests/unit/core/omx-readiness.test.ts',
  'tests/unit/serve/agent-files.test.ts',
] as const;

export const WORKFLOW_INVENTORY_GUARDS = [
  'tests/unit/core/ci-workflow.test.ts',
  'tests/unit/core/release-workflow.test.ts',
] as const;

interface WorkflowDefinition {
  jobs?: {
    test?: {
      steps?: Array<{ name?: string; run?: string }>;
    };
  };
}

export function extractStableBatchScript(content: string): string {
  const workflow = parse(content) as WorkflowDefinition;
  const batchStep = workflow.jobs?.test?.steps?.find(
    ({ name }) => name === 'Run tests in stable batches'
  );
  if (typeof batchStep?.run !== 'string') {
    throw new Error('Run tests in stable batches step is missing');
  }

  return batchStep.run;
}

export function extractRunBunBatchHelper(content: string): string {
  const helper = extractStableBatchScript(content).match(/^run_bun_batch\(\) \{[\s\S]*?^\}/m)?.[0];
  if (!helper) {
    throw new Error('run_bun_batch helper is missing');
  }

  return helper;
}

export function extractStableBatchInventory(content: string): string[] {
  const script = extractStableBatchScript(content);

  return [
    ...new Set(
      [...script.matchAll(/\btests\/[A-Za-z0-9_./-]+\.test\.(?:ts|js)\b/g)].map(
        ([testPath]) => testPath
      )
    ),
  ].sort();
}
