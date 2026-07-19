import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const WIKI_LOG = resolve(import.meta.dir, '../../../wiki/log.jsonl');
const TRIAGE_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/triage-dispatch.yml');
const ROOT_AUTO_DEV_WORKFLOW = resolve(import.meta.dir, '../../../workflows/auto-dev.yaml');
const TEMPLATE_AUTO_DEV_WORKFLOW = resolve(
  import.meta.dir,
  '../../../templates/workflows/auto-dev.yaml'
);
const SKILL_AUTO_DEV_WORKFLOW = resolve(
  import.meta.dir,
  '../../../.codex/skills/pipeline/workflows/auto-dev.yaml'
);
const PLUGIN_AUTO_DEV_WORKFLOW = resolve(
  import.meta.dir,
  '../../../plugins/oh-my-customcodex/skills/pipeline/workflows/auto-dev.yaml'
);
const ARTIFACT_CONTRACT_HELPER = resolve(
  import.meta.dir,
  '../../../.codex/skills/deep-verify/scripts/artifact-contract.mjs'
);
const DEEP_VERIFY_SKILL = resolve(import.meta.dir, '../../../.codex/skills/deep-verify/SKILL.md');
const SECURITY_AUDIT_WORKFLOW = resolve(
  import.meta.dir,
  '../../../.github/workflows/security-audit.yml'
);
const CI_CHANGE_CLASSIFIER = resolve(
  import.meta.dir,
  '../../../.github/scripts/classify-ci-changes.sh'
);
const TRIAGE_DISPATCH = resolve(import.meta.dir, '../../../.github/scripts/triage-dispatch.sh');

interface WorkflowStep {
  name?: string;
  id?: string;
  run?: string;
  uses?: string;
  if?: string;
  'continue-on-error'?: boolean;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  name?: string;
  if?: string;
  needs?: string | string[];
  outputs?: Record<string, string>;
  steps?: WorkflowStep[];
}

interface WorkflowDocument {
  name?: string;
  concurrency?: {
    group?: string;
    'cancel-in-progress'?: boolean;
  };
  on?: {
    pull_request?: {
      branches?: string[];
    };
  };
  jobs?: Record<string, WorkflowJob>;
}

interface AutoDevStep {
  name?: string;
  depends_on?: string | string[];
  description?: string;
  prompt?: string;
  skill?: string;
}

interface AutoDevWorkflow {
  steps?: AutoDevStep[];
}

function requireAutoDevStep(content: string, name: string): AutoDevStep {
  const step = (parse(content) as AutoDevWorkflow).steps?.find(
    (candidate) => candidate.name === name
  );
  expect(step, `missing auto-dev step: ${name}`).toBeDefined();
  return step as AutoDevStep;
}

function autoDevDependencies(step: AutoDevStep): string[] {
  if (typeof step.depends_on === 'string') return [step.depends_on];
  return step.depends_on ?? [];
}

function expectAcyclicAutoDev(content: string): void {
  const steps = (parse(content) as AutoDevWorkflow).steps ?? [];
  const positions = new Map(steps.map((step, index) => [step.name, index]));

  for (const [index, step] of steps.entries()) {
    for (const dependency of autoDevDependencies(step)) {
      const dependencyIndex = positions.get(dependency);
      expect(dependencyIndex, `missing dependency: ${dependency}`).toBeDefined();
      expect(
        dependencyIndex as number,
        `${step.name ?? 'unnamed'} must follow ${dependency}`
      ).toBeLessThan(index);
    }
  }
}

function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

async function createGitFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'omcodex-ci-classifier-'));
  expect(run('git', ['init', '--quiet'], directory).status).toBe(0);
  expect(run('git', ['config', 'user.email', 'ci@example.com'], directory).status).toBe(0);
  expect(run('git', ['config', 'user.name', 'CI Fixture'], directory).status).toBe(0);
  await writeFile(join(directory, 'baseline.txt'), 'baseline\n');
  expect(run('git', ['add', '.'], directory).status).toBe(0);
  expect(run('git', ['commit', '--quiet', '-m', 'baseline'], directory).status).toBe(0);
  return directory;
}

function gitHead(directory: string): string {
  const result = run('git', ['rev-parse', 'HEAD'], directory);
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

async function commitPath(directory: string, path: string, content = 'changed\n'): Promise<string> {
  await mkdir(join(directory, path, '..'), { recursive: true });
  await writeFile(join(directory, path), content);
  expect(run('git', ['add', '--', path], directory).status).toBe(0);
  expect(run('git', ['commit', '--quiet', '-m', `change ${path}`], directory).status).toBe(0);
  return gitHead(directory);
}

async function classify(directory: string, base: string, head: string) {
  const output = join(directory, 'github-output.txt');
  await rm(output, { force: true });
  const result = run('bash', [CI_CHANGE_CLASSIFIER, base, head], directory, {
    GITHUB_OUTPUT: output,
  });
  let fullCi: string | undefined;
  try {
    const values = await readFile(output, 'utf8');
    fullCi = values.match(/^full_ci=(true|false)$/m)?.[1];
  } catch {
    // The assertion reports missing fail-closed output alongside the process result.
  }
  return { ...result, fullCi };
}

async function createFakeGh(): Promise<{ bin: string; state: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'omcodex-triage-gh-'));
  const bin = join(directory, 'bin');
  const state = join(directory, 'state');
  await mkdir(bin, { recursive: true });
  await mkdir(state, { recursive: true });
  await Promise.all([
    writeFile(join(state, 'labels'), ''),
    writeFile(join(state, 'comments'), ''),
    writeFile(join(state, 'comment-count'), '0\n'),
    writeFile(join(state, 'edit-count'), '0\n'),
    writeFile(join(state, 'label-api-count'), '0\n'),
    writeFile(join(state, 'comment-api-count'), '0\n'),
  ]);
  await writeFile(
    join(bin, 'gh'),
    `#!/bin/bash
set -euo pipefail
state="\${FAKE_GH_STATE:?}"

increment() {
  local file="$1"
  local value
  value=$(cat "$state/$file")
  printf '%s\\n' "$((value + 1))" > "$state/$file"
}

if [[ "$1" == "api" ]]; then
  [[ "\${2:-}" == "--paginate" && "\${4:-}" == "--jq" ]] || exit 47
  case "\${3:-}" in
    "repos/owner/repo/issues/123/labels?per_page=100")
      [[ "\${5:-}" == ".[].name" ]] || exit 48
      [[ "\${FAIL_LABEL_READ:-0}" != "1" ]] || exit 41
      increment label-api-count
      cat "$state/labels"
      [[ ! -f "$state/labels-page-2" ]] || cat "$state/labels-page-2"
      exit 0
      ;;
    "repos/owner/repo/issues/123/comments?per_page=100")
      [[ "\${5:-}" == ".[].body" ]] || exit 49
      [[ "\${FAIL_COMMENT_READ:-0}" != "1" ]] || exit 42
      increment comment-api-count
      cat "$state/comments"
      [[ ! -f "$state/comments-page-2" ]] || cat "$state/comments-page-2"
      exit 0
      ;;
  esac
fi

if [[ "$1 $2" == "issue comment" ]]; then
  [[ "\${FAIL_COMMENT_POST:-0}" != "1" ]] || exit 46
  increment comment-count
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--body-file" ]]; then
      cat "$2" >> "$state/comments"
      printf '\\n' >> "$state/comments"
      exit 0
    fi
    shift
  done
  exit 43
fi

if [[ "$1 $2" == "issue edit" ]]; then
  increment edit-count
  if [[ -f "$state/fail-edit-once" ]]; then
    rm "$state/fail-edit-once"
    exit 44
  fi
  printf 'triaged\\n' > "$state/labels"
  exit 0
fi

echo "unexpected gh invocation: $*" >&2
exit 45
`,
    { mode: 0o755 }
  );
  return { bin, state };
}

function runTriageHelper(bin: string, state: string, env?: NodeJS.ProcessEnv) {
  return run('bash', [TRIAGE_DISPATCH], resolve(import.meta.dir, '../../..'), {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    FAKE_GH_STATE: state,
    GH_REPO: 'owner/repo',
    ISSUE_NUMBER: '123',
    ISSUE_TITLE: 'fixture issue',
    ...env,
  });
}

async function createFakeRepoLabelGh(): Promise<{ bin: string; state: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'omcodex-triage-label-gh-'));
  const bin = join(directory, 'bin');
  const state = join(directory, 'state');
  await mkdir(bin, { recursive: true });
  await mkdir(state, { recursive: true });
  await Promise.all([
    writeFile(join(state, 'repo-labels'), ''),
    writeFile(join(state, 'api-count'), '0\n'),
    writeFile(join(state, 'create-count'), '0\n'),
    writeFile(join(state, 'labels'), ''),
    writeFile(join(state, 'comments'), ''),
    writeFile(join(state, 'comment-count'), '0\n'),
    writeFile(join(state, 'edit-count'), '0\n'),
    writeFile(join(state, 'label-api-count'), '0\n'),
    writeFile(join(state, 'comment-api-count'), '0\n'),
  ]);
  await writeFile(
    join(bin, 'gh'),
    `#!/bin/bash
set -euo pipefail
state="\${FAKE_GH_STATE:?}"

increment() {
  local file="$1"
  local value
  value=$(cat "$state/$file")
  value=$((value + 1))
  printf '%s\\n' "$value" > "$state/$file"
}

if [[ "$1" == "api" ]]; then
  [[ "\${2:-}" == "--paginate" && "\${4:-}" == "--jq" ]] || exit 61
  case "\${3:-}" in
    "repos/owner/repo/labels?per_page=100")
      [[ "\${5:-}" == ".[].name" ]] || exit 62
      increment api-count
      call=$(cat "$state/api-count")
      [[ "\${FAIL_REPO_LABEL_READ_ON_CALL:-0}" != "$call" ]] || exit 64
      cat "$state/repo-labels"
      [[ ! -f "$state/repo-labels-page-2" ]] || cat "$state/repo-labels-page-2"
      exit 0
      ;;
    "repos/owner/repo/issues/123/labels?per_page=100")
      [[ "\${5:-}" == ".[].name" ]] || exit 63
      [[ "\${FAIL_LABEL_READ:-0}" != "1" ]] || exit 41
      increment label-api-count
      cat "$state/labels"
      [[ ! -f "$state/labels-page-2" ]] || cat "$state/labels-page-2"
      exit 0
      ;;
    "repos/owner/repo/issues/123/comments?per_page=100")
      [[ "\${5:-}" == ".[].body" ]] || exit 69
      [[ "\${FAIL_COMMENT_READ:-0}" != "1" ]] || exit 42
      increment comment-api-count
      cat "$state/comments"
      [[ ! -f "$state/comments-page-2" ]] || cat "$state/comments-page-2"
      exit 0
      ;;
  esac
fi

if [[ "$1 $2" == "label create" ]]; then
  increment create-count >/dev/null
  [[ "$3" == "triaged" ]] || exit 65
  [[ "$*" == *'--repo owner/repo'* ]] || exit 66
  if grep -Fqx 'triaged' "$state/repo-labels"; then
    exit 1
  fi
  case "\${CREATE_MODE:-success}" in
    success)
      printf 'triaged\\n' >> "$state/repo-labels"
      exit 0
      ;;
    race)
      printf 'triaged\\n' >> "$state/repo-labels"
      exit 1
      ;;
    fail)
      exit 1
      ;;
    phantom)
      exit 0
      ;;
    *)
      exit 67
      ;;
  esac
fi

if [[ "$1 $2" == "issue comment" ]]; then
  [[ "\${FAIL_COMMENT_POST:-0}" != "1" ]] || exit 46
  increment comment-count
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--body-file" ]]; then
      cat "$2" >> "$state/comments"
      printf '\\n' >> "$state/comments"
      exit 0
    fi
    shift
  done
  exit 43
fi

if [[ "$1 $2" == "issue edit" ]]; then
  increment edit-count
  printf 'triaged\\n' > "$state/labels"
  exit 0
fi

echo "unexpected gh invocation: $*" >&2
exit 68
`,
    { mode: 0o755 }
  );
  return { bin, state };
}

async function runTriageLabelEnsure(bin: string, state: string, env?: NodeJS.ProcessEnv) {
  const workflow = parseWorkflow(await readFile(TRIAGE_WORKFLOW, 'utf8'));
  const step = requireJob(workflow, 'triage').steps?.find(
    (candidate) => candidate.name === 'Ensure triaged label exists'
  );
  expect(step?.run).toBeDefined();
  return run('bash', ['-c', step?.run ?? 'exit 1'], resolve(import.meta.dir, '../../..'), {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    FAKE_GH_STATE: state,
    GH_REPO: 'owner/repo',
    ...env,
  });
}

async function runComposedTriageDispatch(bin: string, state: string, env?: NodeJS.ProcessEnv) {
  const ensure = await runTriageLabelEnsure(bin, state, env);
  if (ensure.status !== 0) {
    return { ensure, acknowledgment: null };
  }
  return { ensure, acknowledgment: runTriageHelper(bin, state, env) };
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

describe('deploy-test.yml — release PR Verdaccio gate', () => {
  it('runs only for release PRs targeting develop with a real ephemeral publish token', async () => {
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
    const deployTestJob = requireJob(deployTestWorkflow, 'deploy-test');
    const checkoutStep = deployTestJob.steps?.find((step) => step.name === 'Checkout');
    const verifyHeadStep = deployTestJob.steps?.find(
      (step) => step.name === 'Verify immutable PR head'
    );
    const configureStep = deployTestJob.steps?.find(
      (step) => step.name === 'Configure npm for Verdaccio'
    );
    const publishStep = deployTestJob.steps?.find((step) => step.name === 'Publish to Verdaccio');
    const installStep = deployTestJob.steps?.find((step) => step.name === 'Test global install');

    expect(deployTestWorkflow.on?.pull_request?.branches).toEqual(['develop']);
    expect(deployTestWorkflow.permissions).toEqual({ contents: 'read' });
    expect(deployTestJob.if).toContain("startsWith(github.head_ref, 'release/')");
    expect(deployTestJob.if).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository'
    );
    expect(checkoutStep?.with?.ref).toBe(`\${{ github.event.pull_request.head.sha }}`);
    expect(verifyHeadStep?.run).toContain('git rev-parse HEAD');
    expect(verifyHeadStep?.run).toContain(`\${{ github.event.pull_request.head.sha }}`);
    expect(configureStep?.run).toContain('curl -sf -X PUT');
    expect(configureStep?.run).toContain('org.couchdb.user:test');
    expect(configureStep?.run).toContain("jq -r '.token'");
    expect(configureStep?.run).toContain('test -n "$TOKEN"');
    expect(configureStep?.run).toContain('test "$TOKEN" != "null"');
    expect(configureStep?.run).toContain('_authToken "$TOKEN"');
    expect(publishStep?.run).toContain(
      'npm publish --ignore-scripts --registry http://localhost:4873/'
    );
    expect(installStep?.run).toContain('npm install -g oh-my-customcodex');
    expect(installStep?.run).toContain('--registry http://localhost:4873/');
    expect(deployTestContent).toContain('omcustomcodex --version');
    expect(deployTestContent).toContain('omcustomcodex --help');
    expect(deployTestContent).not.toContain('oh-my-customcode --registry');
    expect(deployTestContent).not.toMatch(/\bomcustom\b/);
    expect(
      Object.values(ciWorkflow.jobs ?? {}).some((job) => job.name?.includes('Deploy Test'))
    ).toBe(false);
    expect(Object.keys(ciWorkflow.jobs ?? {})).not.toContain('deploy-test');
    for (const requiredWorkflows of requiredWorkflowLists) {
      expect(requiredWorkflows).toContain('CI');
      expect(requiredWorkflows).not.toContain('Deploy Test');
    }
  });

  it('records the release workflow page in the v1.0.32 wiki ingest event', async () => {
    const events = (await readFile(WIKI_LOG, 'utf-8'))
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            target: string;
            pages_updated: number;
            details?: { reason?: string };
          }
      );
    const event = events.find(
      ({ details }) =>
        details?.reason === 'v1.0.32 Claude compatibility and release integrity bundle'
    );
    const targets = event?.target.split(',') ?? [];

    expect(targets).toContain('workflows/auto-dev.yaml');
    expect(targets).toContain('.codex/skills/pipeline/workflows/auto-dev.yaml');
    expect(event?.pages_updated).toBe(9);
  });
});

describe('auto-dev — managed shell and durable verification gates', () => {
  it('keeps the authoring pair byte-identical and all canonical workflows parseable', async () => {
    const [root, template, skill, plugin] = await Promise.all([
      readFile(ROOT_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(TEMPLATE_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(SKILL_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(PLUGIN_AUTO_DEV_WORKFLOW, 'utf8'),
    ]);

    expect(root).toBe(template);
    expect(skill).toBe(plugin);
    for (const content of [root, template, skill, plugin]) {
      expect(() => parse(content)).not.toThrow();
    }
  });

  it('fails closed on the exact managed shell advisor before implementation', async () => {
    const workflows = await Promise.all([
      readFile(ROOT_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(SKILL_AUTO_DEV_WORKFLOW, 'utf8'),
    ]);

    for (const content of workflows) {
      const preflight = requireAutoDevStep(content, 'managed-shell-advisor-preflight');
      const text = preflight.prompt ?? '';
      const implement = requireAutoDevStep(content, 'implement');

      expect(text).toContain('omcustomcodex doctor --require-shell-advisor');
      expect(text).toContain('missing');
      expect(text).toContain('omcustomcodex update --hooks');
      expect(text).toContain('integrity-failed');
      expect(text).toContain('assets-modified');
      expect(text).toContain('review');
      expect(text).toContain('back up');
      expect(text).toContain('omcustomcodex update --hooks --force-overwrite-all');
      expect(text).toContain('inactive');
      expect(text).toContain('[features] hooks = true');
      expect(text).toContain('untrusted linked');
      expect(text).toContain('approval-needed');
      expect(text).toContain('/hooks');
      expect(text).toContain('unverified');
      expect(text).toContain('Never write trust state automatically');
      expect(text).toContain('generic OMX/plugin hook readiness');
      expect(implement.depends_on).toBe('managed-shell-advisor-preflight');
    }
  });

  it('uses the numeric Code Mode result and polls running sessions to terminal completion', async () => {
    const workflows = await Promise.all([
      readFile(ROOT_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(SKILL_AUTO_DEV_WORKFLOW, 'utf8'),
    ]);

    for (const content of workflows) {
      const text = requireAutoDevStep(content, 'managed-shell-advisor-preflight').prompt ?? '';

      expect(text).toContain('tools.exec_command');
      expect(text).toContain('typeof gateResult.exit_code === "number"');
      expect(text).toContain('gateResult.exit_code === 0');
      expect(text).toContain('session_id');
      expect(text).toContain('tools.write_stdin');
      expect(text).toContain('terminal result');
      expect(text).toMatch(/Do not infer success\s+from stdout/);
      expect(text).toMatch(/Do not append\s+`status=\$\?`, `path=\.\.\.`, or `argv=\.\.\.`/);
      expect(text).not.toContain('NATIVE_TOOL_NAMES.push');
      expect(text).not.toContain('functions.exec matcher');
    }
  });

  it('orders source preparation and final commit as an acyclic release DAG', async () => {
    const workflowCases = await Promise.all([
      readFile(ROOT_AUTO_DEV_WORKFLOW, 'utf8').then((content) => ({
        content,
        verifyStep: 'verify',
      })),
      readFile(SKILL_AUTO_DEV_WORKFLOW, 'utf8').then((content) => ({
        content,
        verifyStep: 'deep-verify',
      })),
    ]);

    for (const { content, verifyStep } of workflowCases) {
      expectAcyclicAutoDev(content);
      const releasePrepare = requireAutoDevStep(content, 'release-prepare');
      const verifyBuild = requireAutoDevStep(content, 'verify-build');
      const deepVerify = requireAutoDevStep(content, verifyStep);
      const artifact = requireAutoDevStep(content, 'verification-artifact');
      const release = requireAutoDevStep(content, 'release');

      expect(releasePrepare.depends_on).toBe('implement');
      expect(verifyBuild.depends_on).toBe('release-prepare');
      expect(artifact.depends_on).toBe(verifyStep);
      expect(release.depends_on).toBe('verification-artifact');
      expect(releasePrepare.prompt).toContain('scripts/resolve-release-target.mjs');
      expect(releasePrepare.prompt).toContain('package.json');
      expect(releasePrepare.prompt).toContain('templates/manifest.json');
      expect(releasePrepare.prompt).toContain('CHANGELOG.md');
      expect(releasePrepare.prompt).toContain('Do not commit');
      expect(releasePrepare.prompt).toContain('Do not push');
      expect(verifyBuild.prompt).toContain('allowlisted generated output');
      expect(verifyBuild.prompt).toContain('final post-build inventory');
      expect(verifyBuild.prompt).toContain('GIT_INDEX_FILE');
      expect(verifyBuild.prompt).toContain('git read-tree HEAD');
      expect(verifyBuild.prompt).toContain('git add -A -- .');
      expect(verifyBuild.prompt).toContain(
        'reviewedTree=$(GIT_INDEX_FILE="$reviewIndex" git write-tree)'
      );
      expect(verifyBuild.prompt).toContain('reviewedTree');
      expect(deepVerify.skill).toBe('deep-verify');
      expect(deepVerify.description).toContain('Rounds 1–7');
      expect(deepVerify.description).toContain('Pipeline-deferred finalization');
      expect(deepVerify.description).toContain('reviewedTree');
      expect(artifact.prompt).toMatch(/same\s+deep-verify execution/);

      const releaseText = release.prompt ?? '';
      expect(releaseText).toMatch(/final\s+PR\s+head/);
      expect(releaseText).toContain('verifiedSha');
      expect(releaseText).toContain('push');
      expect(releaseText).toContain('merge');
      expect(releaseText).not.toContain('re-enter');
      expect(releaseText).not.toContain('git commit');
      expect(releaseText).not.toContain('chore(release): bump');
      expect(releaseText).not.toContain('Promote `CHANGELOG.md`');
      expect(releaseText).not.toContain('update `package.json`');
      expect(releaseText).not.toContain('git switch');
      expect(releaseText).not.toContain('git branch -m');
      expect(releaseText).not.toContain('git branch --list release');
      expect(releaseText).toContain('already-existing exact release branch');
    }
  });

  it('separates remote merge from worktree cleanup and bans source mutation after freeze', async () => {
    const [autoTagContent, ...workflows] = await Promise.all([
      readFile(AUTO_TAG_WORKFLOW, 'utf8'),
      readFile(ROOT_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(TEMPLATE_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(SKILL_AUTO_DEV_WORKFLOW, 'utf8'),
    ]);

    expect(autoTagContent).not.toContain('Delete merged release branch');
    expect(autoTagContent).not.toContain('git push origin --delete');

    for (const content of workflows) {
      const verifyBuildText = requireAutoDevStep(content, 'verify-build').prompt ?? '';
      const artifactText = requireAutoDevStep(content, 'verification-artifact').prompt ?? '';
      const releaseText = requireAutoDevStep(content, 'release').prompt ?? '';

      const wikiGate = verifyBuildText.indexOf('bash .github/scripts/verify-wiki-sync.sh');
      const frozenTree = verifyBuildText.indexOf(
        'reviewedTree=$(GIT_INDEX_FILE="$reviewIndex" git write-tree)'
      );
      expect(wikiGate).toBeGreaterThanOrEqual(0);
      expect(frozenTree).toBeGreaterThan(wikiGate);
      expect(artifactText).toContain('source-mutating build, package, sync, or autofix command');
      expect(artifactText).toContain('new acyclic pipeline run');
      expect(releaseText).toContain('Merge without `--delete-branch`');
      expect(releaseText).not.toMatch(/gh pr merge[^\n]*--delete-branch/);
      expect(releaseText).toContain('`state=MERGED`');
      expect(releaseText).toContain('`mergedAt`');
      expect(releaseText).toContain('`mergeCommit.oid`');
      expect(releaseText).toContain('gh api --method DELETE');
      expect(releaseText).toContain('git/refs/heads/');
      expect(releaseText).toContain('remote ref is absent');
      expect(releaseText).toContain('bounded readback');
      expect(releaseText).toContain('set -euo pipefail');
      expect(releaseText).toContain('never infer success from a display pipe or stale output');
      expect(releaseText).toContain('--match-head-commit "$verifiedSha"');
      expect(releaseText).toContain('at most 5 attempts');
      expect(releaseText).toContain('sleep 2 seconds');
      expect(releaseText).toContain('exclusive temporary directory');
      expect(releaseText).toContain('/bin/bash');
      expect(releaseText).toContain('Never switch, delete, or rename a local branch');
      expect(releaseText).not.toContain('release-branch deletion');
    }
  });

  it('reviews the frozen dirty tree object instead of omitting it behind HEAD', async () => {
    const [deepVerifySkill, root, skill] = await Promise.all([
      readFile(DEEP_VERIFY_SKILL, 'utf8'),
      readFile(ROOT_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(SKILL_AUTO_DEV_WORKFLOW, 'utf8'),
    ]);

    expect(deepVerifySkill).toContain('git cat-file -e "$reviewedTree^{tree}"');
    expect(deepVerifySkill).toContain('git diff --no-ext-diff --binary develop "$reviewedTree"');
    expect(deepVerifySkill).toMatch(/exact full[\s\S]{0,220}all six\s+reviewers/i);
    expect(deepVerifySkill).toMatch(/must never[\s\S]{0,240}fall back to `HEAD`/i);

    for (const content of [root, skill]) {
      const verifyBuild = requireAutoDevStep(content, 'verify-build').prompt ?? '';
      const artifact = requireAutoDevStep(content, 'verification-artifact').prompt ?? '';

      expect(verifyBuild).toContain('temporary index');
      expect(verifyBuild).toContain('reviewedTree');
      expect(verifyBuild).toContain('40-character lowercase');
      expect(artifact).toContain('git read-tree "$reviewedTree"');
      expect(artifact).toContain('stagedTree=$(git write-tree)');
      expect(artifact).toMatch(/stagedTree[\s\S]{0,120}reviewedTree/);
      expect(artifact).toMatch(/committed[\s]+tree[\s\S]{0,160}reviewedTree/i);
      expect(artifact).not.toContain('reviewedTree=$(git write-tree)');
    }
  });

  it('requires a safe active-skill-relative artifact finalization in every mode', async () => {
    const workflows = await Promise.all([
      readFile(ROOT_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(SKILL_AUTO_DEV_WORKFLOW, 'utf8'),
    ]);

    for (const content of workflows) {
      const text = requireAutoDevStep(content, 'verification-artifact').prompt ?? '';

      expect(text).toContain('active loaded `deep-verify` skill catalog entry');
      expect(text).toMatch(/sibling\s+`scripts\/artifact-contract\.mjs`/);
      expect(text).not.toContain('.codex/skills/deep-verify/scripts/artifact-contract.mjs');
      expect(text).not.toContain('.agents/skills/deep-verify/scripts/artifact-contract.mjs');
      expect(text).toContain('standard');
      expect(text).toContain('docs-only-self-review');
      expect(text).toContain('lite-deterministic');
      expect(text).toContain('converged-substitution');
      expect(text).toContain('artifact-contract.mjs write');
      expect(text).toMatch(/top-level\s+keys exactly `\{artifact, body\}`/);
      expect(text).toMatch(/exclusive\s+regular/);
      expect(text).toContain('mode 0600');
      expect(text).toContain('writerProjectionFile');
      expect(text).toContain('JSON data');
      expect(text).toContain('`.path`');
      expect(text).toContain('node "$artifactHelper" write');
      expect(text).toContain('node "$artifactHelper" validate');
      expect(text).toContain('node "$artifactHelper" select');
      expect(text).toContain('--repository "$repository"');
      expect(text).toContain('--release-version "$releaseVersion"');
      expect(text).toContain('--verified-sha "$verifiedSha"');
      expect(text).toContain('fail closed');
      expect(text).toContain('selected path');
      expect(text).toContain('git write-tree');
      expect(text).toContain('stagedTree=$(git write-tree)');
      expect(text).toContain('local Lore commit');
      expect(text).toMatch(/committed\s+tree/);
      expect(text).toContain('never relabel');
      expect(text).toContain('final post-build inventory');
      expect(text).toContain('Pipeline-deferred finalization');
      expect(text).toMatch(/same\s+deep-verify execution/);
      expect(text).toContain('Branch placement before commit');
      expect(text).toContain('git branch --list release');
      expect(text).toContain(['release/v$', '{releaseVersion}'].join(''));
      expect(text.indexOf('Branch placement before commit')).toBeLessThan(
        text.indexOf('Create the local Lore commit now')
      );
    }
  });

  it('executes write, validate, and exact selection for all four artifact modes', async () => {
    const modes = [
      'standard',
      'docs-only-self-review',
      'lite-deterministic',
      'converged-substitution',
    ] as const;

    for (const [index, executionMode] of modes.entries()) {
      const projectRoot = await mkdtemp(join(tmpdir(), `omcodex-auto-dev-${index}-`));
      try {
        const verifiedSha = `${index + 1}`.repeat(40);
        const artifact = {
          schemaVersion: 1,
          skill: 'deep-verify',
          date: `2026-07-19T01:23:0${index}+09:00`,
          query: `auto-dev ${executionMode}`,
          repository: 'owner/repo',
          releaseVersion: '1.2.3',
          verifiedSha,
          executionMode,
          verdict: 'READY',
          findings: { initial: [], falsePositives: [], fixed: [], unresolved: [] },
          verificationEvidence: [
            { gate: 'auto-dev contract', outcome: 'pass', reference: `${executionMode} fixture` },
          ],
        };
        const artifactInputFile = join(projectRoot, 'artifact-input.json');
        const writerProjectionFile = join(projectRoot, 'writer-projection.json');
        await writeFile(
          artifactInputFile,
          JSON.stringify({ artifact, body: `# Safe ${executionMode} report` }),
          { flag: 'wx', mode: 0o600 }
        );

        const input = JSON.parse(await readFile(artifactInputFile, 'utf8')) as object;
        expect(Object.keys(input).sort()).toEqual(['artifact', 'body']);
        const writeResult = run(
          process.execPath,
          [
            ARTIFACT_CONTRACT_HELPER,
            'write',
            '--project-root',
            projectRoot,
            '--input',
            artifactInputFile,
          ],
          projectRoot
        );
        expect(writeResult.status, writeResult.stderr).toBe(0);
        await writeFile(writerProjectionFile, writeResult.stdout, { flag: 'wx', mode: 0o600 });

        const projectionInfo = await lstat(writerProjectionFile);
        expect(projectionInfo.isFile()).toBe(true);
        expect(projectionInfo.isSymbolicLink()).toBe(false);
        const writerProjection = JSON.parse(await readFile(writerProjectionFile, 'utf8')) as {
          path?: string;
          artifact?: { executionMode?: string };
        };
        expect(writerProjection.artifact?.executionMode).toBe(executionMode);
        expect(typeof writerProjection.path).toBe('string');

        const validateResult = run(
          process.execPath,
          [ARTIFACT_CONTRACT_HELPER, 'validate', '--file', writerProjection.path as string],
          projectRoot
        );
        expect(validateResult.status, validateResult.stderr).toBe(0);
        const selectResult = run(
          process.execPath,
          [
            ARTIFACT_CONTRACT_HELPER,
            'select',
            '--project-root',
            projectRoot,
            '--repository',
            'owner/repo',
            '--release-version',
            '1.2.3',
            '--verified-sha',
            verifiedSha,
          ],
          projectRoot
        );
        expect(selectResult.status, selectResult.stderr).toBe(0);
        const selection = JSON.parse(selectResult.stdout) as {
          path?: string;
          artifact?: { executionMode?: string };
        };
        expect(selection.path).toBe(writerProjection.path);
        expect(selection.artifact?.executionMode).toBe(executionMode);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    }
  });

  it('writes a new merge-SHA artifact before post-release follow-up', async () => {
    const [root, template, skill, plugin] = await Promise.all([
      readFile(ROOT_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(TEMPLATE_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(SKILL_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(PLUGIN_AUTO_DEV_WORKFLOW, 'utf8'),
    ]);

    for (const content of [root, template, skill, plugin]) {
      const postMerge = requireAutoDevStep(content, 'post-release-verification-artifact');
      const text = postMerge.prompt ?? '';
      const followupName =
        content === root || content === template ? 'followup' : 'post-release-followup';
      const orderedGuard = [
        'set -euo pipefail',
        `: "\${verify_dir:?}" "\${expected_sha:?}"`,
        'verify_dir=$(cd -P -- "$verify_dir" && pwd)',
        'cd -- "$verify_dir"',
        'verify_root=$(git rev-parse --show-toplevel)',
        'actual_sha=$(git rev-parse HEAD)',
        'test "$PWD" = "$verify_dir"',
        'test "$verify_root" = "$verify_dir"',
        'test "$actual_sha" = "$expected_sha"',
        'printf \'R020_HEAD=%s\\nR020_WORKTREE=%s\\n\' "$actual_sha" "$verify_root"',
        'bun install --frozen-lockfile',
        'bun test',
      ];

      expect(text).toContain('exact released merge SHA');
      let previous = -1;
      for (const marker of orderedGuard) {
        const index = text.indexOf(marker);
        expect(index, `missing or out-of-order exact-worktree guard: ${marker}`).toBeGreaterThan(
          previous
        );
        previous = index;
      }
      expect(text).toContain(
        'A guard run in one subprocess followed by verification in another working directory does not satisfy this contract.'
      );
      expect(text).toContain('required post-merge install and test gates');
      expect(text).not.toContain('every required post-merge gate');
      expect(text).toContain(
        'Artifact helper steps remain separate and must satisfy their existing cwd and identity-validation contract.'
      );
      expect(text).toMatch(/Do\s+not copy, relabel, or reuse the pre-merge artifact/);
      expect(text).toContain('artifact-contract.mjs write');
      expect(text).toContain('artifact-contract.mjs validate');
      expect(text).toContain('artifact-contract.mjs select');
      expect(text).toMatch(/active loaded `deep-verify` skill catalog\s+entry/);
      expect(text).toContain('post-release Source B');
      expect(requireAutoDevStep(content, followupName).depends_on).toBe(
        'post-release-verification-artifact'
      );
    }
  });

  it('keeps helper-owned count markers out of every artifact writer input prompt', async () => {
    const workflows = await Promise.all([
      readFile(ROOT_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(TEMPLATE_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(SKILL_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(PLUGIN_AUTO_DEV_WORKFLOW, 'utf8'),
    ]);

    for (const content of workflows) {
      for (const stepName of ['verification-artifact', 'post-release-verification-artifact']) {
        const text = requireAutoDevStep(content, stepName).prompt ?? '';
        expect(text).toContain(
          'The caller-supplied Markdown `body` must not contain any `<!-- deep-verify-counts:... -->` marker.'
        );
        expect(text).toContain(
          'The helper appends exactly one count marker from the validated structured findings.'
        );
        expect(text).toContain(
          'A caller-supplied structured marker fails closed with `artifact body already contains a structured count marker`.'
        );
      }
    }
  });

  it('requires the Verdaccio PR check at the immutable release head before merge', async () => {
    const workflows = await Promise.all([
      readFile(ROOT_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(TEMPLATE_AUTO_DEV_WORKFLOW, 'utf8'),
      readFile(SKILL_AUTO_DEV_WORKFLOW, 'utf8'),
    ]);

    for (const content of workflows) {
      const releasePrompt = requireAutoDevStep(content, 'release').prompt ?? '';
      expect(releasePrompt).toContain('Deploy Test with Verdaccio');
      expect(releasePrompt).toContain('headRefOid');
      expect(releasePrompt).toContain('statusCheckRollup');
      expect(releasePrompt).toContain('verifiedSha');
      expect(releasePrompt).toContain('SUCCESS');
      expect(releasePrompt).toMatch(/latest\s+matching\s+check run/);
      expect(releasePrompt).toContain('startedAt');
      expect(releasePrompt).toContain('completed-time');
      expect(releasePrompt).toContain('database-ID');
      expect(releasePrompt).toMatch(/absent, pending,\s+skipped, neutral, or unsuccessful/);
      expect(releasePrompt).not.toContain('exactly one non-skipped');
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
      'tests/unit/cli/doctor-shell-advisor.test.ts',
      'tests/unit/cli/index.test.ts',
      'tests/unit/core/managed-shell-advisor-readiness.test.ts',
      'tests/unit/core/shell-advisor-guidance.test.ts',
      'tests/unit/core/deep-verify-artifact-contract.test.ts',
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

describe('ci.yml — conservative documentation-only fast path', () => {
  it('classifies only the explicit static Markdown allowlist as documentation-only', async () => {
    const allowed = [
      'README.md',
      'README.ko.md',
      'CHANGELOG.md',
      'docs/reference.md',
      'docs/nested/reference.md',
      'guides/quickstart.md',
      'guides/nested/quickstart.md',
      'wiki/Home.md',
      'wiki/nested/Home.md',
    ];

    for (const path of allowed) {
      const directory = await createGitFixture();
      try {
        const base = gitHead(directory);
        const head = await commitPath(directory, path);
        const result = await classify(directory, base, head);
        expect(result.status, `${path}: ${result.stderr}`).toBe(0);
        expect(result.fullCi, path).toBe('false');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it('fails closed for protected, executable, generated, and package surfaces', async () => {
    const protectedPaths = [
      'src/index.ts',
      '.codex/rules/MUST-test.md',
      '.agents/skills/test/SKILL.md',
      '.github/README.md',
      '.github/workflows/ci.yml',
      'README/nested.md',
      'docs/.vitepress/config.md',
      'plugins/example/README.md',
      'templates/guides/example/README.md',
      'package.json',
      'packages/eval-core/package.json',
      'bun.lock',
      'plugin-manifest.json',
    ];

    for (const path of protectedPaths) {
      const directory = await createGitFixture();
      try {
        const base = gitHead(directory);
        const head = await commitPath(directory, path);
        const result = await classify(directory, base, head);
        expect(result.status, `${path}: ${result.stderr}`).toBe(0);
        expect(result.fullCi, path).toBe('true');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it('uses full CI when an otherwise static Markdown change is mixed with code', async () => {
    const directory = await createGitFixture();
    try {
      const base = gitHead(directory);
      await mkdir(join(directory, 'docs'), { recursive: true });
      await mkdir(join(directory, 'src'), { recursive: true });
      await writeFile(join(directory, 'docs/reference.md'), 'documentation\n');
      await writeFile(join(directory, 'src/index.ts'), 'export {};\n');
      expect(run('git', ['add', '.'], directory).status).toBe(0);
      expect(run('git', ['commit', '--quiet', '-m', 'mixed change'], directory).status).toBe(0);

      const result = await classify(directory, base, gitHead(directory));
      expect(result.status, result.stderr).toBe(0);
      expect(result.fullCi).toBe('true');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed for missing, zero, unavailable, identical, and invalid revisions', async () => {
    const directory = await createGitFixture();
    try {
      const head = gitHead(directory);
      const cases: Array<[string, string]> = [
        ['', head],
        ['0000000000000000000000000000000000000000', head],
        ['1111111111111111111111111111111111111111', head],
        [head, head],
        ['not-a-revision', head],
      ];

      for (const [base, candidateHead] of cases) {
        const result = await classify(directory, base, candidateHead);
        expect(result.status, `${base || '<missing>'}: ${result.stderr}`).toBe(0);
        expect(result.fullCi, base || '<missing>').toBe('true');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('emits full CI when Git fails while reading an otherwise valid diff', async () => {
    const directory = await createGitFixture();
    const fakeBin = await mkdtemp(join(tmpdir(), 'omcodex-classifier-git-'));
    try {
      const base = gitHead(directory);
      const head = await commitPath(directory, 'docs/reference.md');
      const realGit = run('bash', ['-c', 'command -v git'], directory).stdout.trim();
      await writeFile(
        join(fakeBin, 'git'),
        `#!/bin/bash\nif [[ "$1" == "diff" ]]; then exit 55; fi\nexec ${JSON.stringify(realGit)} "$@"\n`,
        { mode: 0o755 }
      );
      const output = join(directory, 'git-failure-output.txt');
      const result = run('bash', [CI_CHANGE_CLASSIFIER, base, head], directory, {
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        GITHUB_OUTPUT: output,
      });

      expect(result.status, result.stderr).toBe(0);
      expect(await readFile(output, 'utf8')).toContain('full_ci=true');
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(fakeBin, { recursive: true, force: true });
    }
  });

  it('keeps required jobs present and gates their steps instead of the jobs', async () => {
    const workflow = parseWorkflow(await readWorkflow());
    const requiredJobs = ['lockfile-sync', 'lint', 'test', 'rust-test'];
    const gate = `\${{ needs.changes.outputs.full_ci != 'false' }}`;
    const noticeGate = `\${{ needs.changes.outputs.full_ci == 'false' }}`;

    expect(requireJob(workflow, 'changes').outputs?.full_ci).toBe(
      `\${{ steps.normalize.outputs.full_ci }}`
    );
    for (const jobName of requiredJobs) {
      const job = requireJob(workflow, jobName);
      expect(job.if, jobName).toBeUndefined();
      expect(job.steps?.length, jobName).toBeGreaterThan(0);
      const noticeSteps = (job.steps ?? []).filter((step) => step.if === noticeGate);
      expect(noticeSteps, jobName).toHaveLength(1);
      expect(noticeSteps[0].name, jobName).toBe('Report documentation-only fast path');
      for (const step of (job.steps ?? []).filter((step) => step !== noticeSteps[0])) {
        expect(step.if, `${jobName}: ${step.name ?? step.uses ?? '<unnamed>'}`).toBe(gate);
      }
    }

    for (const jobName of ['package-contract', 'docs-validate', 'version-sync', 'template-sync']) {
      const job = requireJob(workflow, jobName);
      expect(job.if, jobName).toBeUndefined();
      expect(
        job.steps?.some((step) => step.if === gate),
        jobName
      ).toBe(false);
    }
  });

  it('uses full history and the fail-closed classifier for PR and push revisions', async () => {
    const workflow = parseWorkflow(await readWorkflow());
    const steps = requireJob(workflow, 'changes').steps ?? [];
    const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    const classifier = steps.find((step) => step.id === 'classify');

    expect(checkout?.with?.['fetch-depth']).toBe(0);
    expect(classifier?.run).toBe(
      'bash .github/scripts/classify-ci-changes.sh "$BASE_SHA" "$HEAD_SHA"'
    );
    expect(classifier?.run).not.toContain('|| true');
  });

  it('normalizes missing, invalid, and failed classifications to full CI', async () => {
    const workflow = parseWorkflow(await readWorkflow());
    const steps = requireJob(workflow, 'changes').steps ?? [];
    const checkout = steps.find((step) => step.id === 'checkout');
    const classifier = steps.find((step) => step.id === 'classify');
    const normalizer = steps.find((step) => step.id === 'normalize');

    expect(checkout?.['continue-on-error']).toBe(true);
    expect(classifier?.if).toBe(`\${{ always() }}`);
    expect(classifier?.['continue-on-error']).toBe(true);
    expect(normalizer?.if).toBe(`\${{ always() }}`);
    expect(normalizer?.['continue-on-error']).toBe(true);
    expect(normalizer?.run).toBeTruthy();

    const cases: Array<{
      checkout: string;
      classifier: string;
      raw: string;
      expected: 'true' | 'false';
    }> = [
      { checkout: 'success', classifier: 'success', raw: 'false', expected: 'false' },
      { checkout: 'success', classifier: 'success', raw: 'true', expected: 'true' },
      { checkout: 'success', classifier: 'success', raw: '', expected: 'true' },
      { checkout: 'success', classifier: 'success', raw: 'unexpected', expected: 'true' },
      { checkout: 'success', classifier: 'failure', raw: 'false', expected: 'true' },
      { checkout: 'failure', classifier: 'success', raw: 'false', expected: 'true' },
    ];
    const directory = await mkdtemp(join(tmpdir(), 'omcodex-ci-normalizer-'));
    try {
      for (const testCase of cases) {
        const output = join(directory, 'github-output.txt');
        await writeFile(output, '');
        const result = run('bash', ['-c', normalizer?.run ?? 'exit 1'], directory, {
          CHECKOUT_OUTCOME: testCase.checkout,
          CLASSIFY_OUTCOME: testCase.classifier,
          RAW_FULL_CI: testCase.raw,
          GITHUB_OUTPUT: output,
        });

        expect(result.status, result.stderr).toBe(0);
        expect(await readFile(output, 'utf8')).toBe(`full_ci=${testCase.expected}\n`);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('triage-dispatch.yml — serialized idempotent acknowledgment', () => {
  it('serializes each issue without cancellation or unsupported queue syntax', async () => {
    const content = await readFile(TRIAGE_WORKFLOW, 'utf8');
    const workflow = parseWorkflow(content);

    expect(workflow.concurrency?.group).toBe(
      `\${{ github.workflow }}-\${{ github.event.issue.number }}`
    );
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(false);
    expect(content).not.toMatch(/^\s*queue:/m);
    expect(content).toContain('bash .github/scripts/triage-dispatch.sh');
    expect(content).not.toContain('gh label view');
    expect(content).not.toContain('|| true');
  });

  it('executes the label ensure step without mutation when the exact label already exists', async () => {
    const fixture = await createFakeRepoLabelGh();
    try {
      await writeFile(join(fixture.state, 'repo-labels'), 'P2\ntriaged\nquality\n');
      const result = await runTriageLabelEnsure(fixture.bin, fixture.state);

      expect(result.status, result.stderr).toBe(0);
      expect(await readFile(join(fixture.state, 'api-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'create-count'), 'utf8')).toBe('0\n');
    } finally {
      await rm(resolve(fixture.bin, '..'), { recursive: true, force: true });
    }
  });

  it('finds the exact repository label on a later paginated page', async () => {
    const fixture = await createFakeRepoLabelGh();
    try {
      await writeFile(join(fixture.state, 'repo-labels'), 'P2\nquality\n');
      await writeFile(join(fixture.state, 'repo-labels-page-2'), 'triaged\n');
      const result = await runTriageLabelEnsure(fixture.bin, fixture.state);

      expect(result.status, result.stderr).toBe(0);
      expect(await readFile(join(fixture.state, 'api-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'create-count'), 'utf8')).toBe('0\n');
    } finally {
      await rm(resolve(fixture.bin, '..'), { recursive: true, force: true });
    }
  });

  it('creates an absent exact label and requires a successful readback', async () => {
    const fixture = await createFakeRepoLabelGh();
    try {
      await writeFile(join(fixture.state, 'repo-labels'), 'P2\nnot-triaged\n');
      const result = await runTriageLabelEnsure(fixture.bin, fixture.state);

      expect(result.status, result.stderr).toBe(0);
      expect(await readFile(join(fixture.state, 'api-count'), 'utf8')).toBe('2\n');
      expect(await readFile(join(fixture.state, 'create-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'repo-labels'), 'utf8')).toBe(
        'P2\nnot-triaged\ntriaged\n'
      );
    } finally {
      await rm(resolve(fixture.bin, '..'), { recursive: true, force: true });
    }
  });

  it('fails closed without creation when the initial repository-label lookup fails', async () => {
    const fixture = await createFakeRepoLabelGh();
    try {
      const result = await runTriageLabelEnsure(fixture.bin, fixture.state, {
        FAIL_REPO_LABEL_READ_ON_CALL: '1',
      });

      expect(result.status).not.toBe(0);
      expect(await readFile(join(fixture.state, 'api-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'create-count'), 'utf8')).toBe('0\n');
    } finally {
      await rm(resolve(fixture.bin, '..'), { recursive: true, force: true });
    }
  });

  it('fails closed when successful creation cannot be confirmed by readback', async () => {
    const fixture = await createFakeRepoLabelGh();
    try {
      const result = await runTriageLabelEnsure(fixture.bin, fixture.state, {
        FAIL_REPO_LABEL_READ_ON_CALL: '2',
      });

      expect(result.status).not.toBe(0);
      expect(await readFile(join(fixture.state, 'api-count'), 'utf8')).toBe('2\n');
      expect(await readFile(join(fixture.state, 'create-count'), 'utf8')).toBe('1\n');
    } finally {
      await rm(resolve(fixture.bin, '..'), { recursive: true, force: true });
    }
  });

  it('treats one failed create as a race only when one readback finds the exact label', async () => {
    const raceFixture = await createFakeRepoLabelGh();
    try {
      const result = await runTriageLabelEnsure(raceFixture.bin, raceFixture.state, {
        CREATE_MODE: 'race',
      });

      expect(result.status, result.stderr).toBe(0);
      expect(await readFile(join(raceFixture.state, 'api-count'), 'utf8')).toBe('2\n');
      expect(await readFile(join(raceFixture.state, 'create-count'), 'utf8')).toBe('1\n');
    } finally {
      await rm(resolve(raceFixture.bin, '..'), { recursive: true, force: true });
    }

    const failedFixture = await createFakeRepoLabelGh();
    try {
      const result = await runTriageLabelEnsure(failedFixture.bin, failedFixture.state, {
        CREATE_MODE: 'fail',
      });

      expect(result.status).not.toBe(0);
      expect(await readFile(join(failedFixture.state, 'api-count'), 'utf8')).toBe('2\n');
      expect(await readFile(join(failedFixture.state, 'create-count'), 'utf8')).toBe('1\n');
    } finally {
      await rm(resolve(failedFixture.bin, '..'), { recursive: true, force: true });
    }
  });

  it('fails when a zero-status create does not materialize the exact label', async () => {
    const fixture = await createFakeRepoLabelGh();
    try {
      const result = await runTriageLabelEnsure(fixture.bin, fixture.state, {
        CREATE_MODE: 'phantom',
      });

      expect(result.status).not.toBe(0);
      expect(await readFile(join(fixture.state, 'api-count'), 'utf8')).toBe('2\n');
      expect(await readFile(join(fixture.state, 'create-count'), 'utf8')).toBe('1\n');
    } finally {
      await rm(resolve(fixture.bin, '..'), { recursive: true, force: true });
    }
  });

  it('reaches the real acknowledgment helper only after repository-label readiness succeeds', async () => {
    const fixture = await createFakeRepoLabelGh();
    try {
      const path = await runComposedTriageDispatch(fixture.bin, fixture.state);

      expect(path.ensure.status, path.ensure.stderr).toBe(0);
      expect(path.acknowledgment).not.toBeNull();
      expect(path.acknowledgment?.status, path.acknowledgment?.stderr).toBe(0);
      expect(await readFile(join(fixture.state, 'api-count'), 'utf8')).toBe('2\n');
      expect(await readFile(join(fixture.state, 'create-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'repo-labels'), 'utf8')).toBe('triaged\n');
      expect(await readFile(join(fixture.state, 'comment-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'edit-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'labels'), 'utf8')).toBe('triaged\n');
      expect(await readFile(join(fixture.state, 'comments'), 'utf8')).toContain(
        '<!-- triage-dispatch:acknowledged -->'
      );
    } finally {
      await rm(resolve(fixture.bin, '..'), { recursive: true, force: true });
    }
  });

  it('does not invoke acknowledgment mutations when repository-label readiness fails', async () => {
    const fixture = await createFakeRepoLabelGh();
    try {
      const path = await runComposedTriageDispatch(fixture.bin, fixture.state, {
        FAIL_REPO_LABEL_READ_ON_CALL: '1',
      });

      expect(path.ensure.status).not.toBe(0);
      expect(path.acknowledgment).toBeNull();
      expect(await readFile(join(fixture.state, 'create-count'), 'utf8')).toBe('0\n');
      expect(await readFile(join(fixture.state, 'label-api-count'), 'utf8')).toBe('0\n');
      expect(await readFile(join(fixture.state, 'comment-api-count'), 'utf8')).toBe('0\n');
      expect(await readFile(join(fixture.state, 'comment-count'), 'utf8')).toBe('0\n');
      expect(await readFile(join(fixture.state, 'edit-count'), 'utf8')).toBe('0\n');
    } finally {
      await rm(resolve(fixture.bin, '..'), { recursive: true, force: true });
    }
  });

  it('posts one marked acknowledgment and then applies the triaged label', async () => {
    const fixture = await createFakeGh();
    try {
      const result = runTriageHelper(fixture.bin, fixture.state);

      expect(result.status, result.stderr).toBe(0);
      expect(await readFile(join(fixture.state, 'comment-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'edit-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'labels'), 'utf8')).toBe('triaged\n');
      expect(await readFile(join(fixture.state, 'label-api-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'comment-api-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'comments'), 'utf8')).toContain(
        '<!-- triage-dispatch:acknowledged -->'
      );
    } finally {
      await rm(resolve(fixture.bin, '..'), { recursive: true, force: true });
    }
  });

  it('skips all mutation when the latest labels already contain triaged', async () => {
    const fixture = await createFakeGh();
    try {
      await writeFile(join(fixture.state, 'labels'), 'P2\ntriaged\n');
      const result = runTriageHelper(fixture.bin, fixture.state);

      expect(result.status, result.stderr).toBe(0);
      expect(await readFile(join(fixture.state, 'comment-count'), 'utf8')).toBe('0\n');
      expect(await readFile(join(fixture.state, 'edit-count'), 'utf8')).toBe('0\n');
      expect(await readFile(join(fixture.state, 'label-api-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'comment-api-count'), 'utf8')).toBe('0\n');
    } finally {
      await rm(resolve(fixture.bin, '..'), { recursive: true, force: true });
    }
  });

  it('finds triaged on a later paginated labels page before any mutation', async () => {
    const fixture = await createFakeGh();
    try {
      await writeFile(join(fixture.state, 'labels'), 'P2\nquality\n');
      await writeFile(join(fixture.state, 'labels-page-2'), 'triaged\n');
      const result = runTriageHelper(fixture.bin, fixture.state);

      expect(result.status, result.stderr).toBe(0);
      expect(await readFile(join(fixture.state, 'comment-count'), 'utf8')).toBe('0\n');
      expect(await readFile(join(fixture.state, 'edit-count'), 'utf8')).toBe('0\n');
      expect(await readFile(join(fixture.state, 'label-api-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'comment-api-count'), 'utf8')).toBe('0\n');
    } finally {
      await rm(resolve(fixture.bin, '..'), { recursive: true, force: true });
    }
  });

  it('repairs marker-only state by adding the label without another comment', async () => {
    const fixture = await createFakeGh();
    try {
      await writeFile(
        join(fixture.state, 'comments'),
        '<!-- triage-dispatch:acknowledged -->\nprevious acknowledgment\n'
      );
      const result = runTriageHelper(fixture.bin, fixture.state);

      expect(result.status, result.stderr).toBe(0);
      expect(await readFile(join(fixture.state, 'comment-count'), 'utf8')).toBe('0\n');
      expect(await readFile(join(fixture.state, 'edit-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'labels'), 'utf8')).toBe('triaged\n');
    } finally {
      await rm(resolve(fixture.bin, '..'), { recursive: true, force: true });
    }
  });

  it('retries comment-then-label partial failure without duplicating the marker comment', async () => {
    const fixture = await createFakeGh();
    try {
      await writeFile(join(fixture.state, 'fail-edit-once'), '1\n');

      const first = runTriageHelper(fixture.bin, fixture.state);
      expect(first.status).not.toBe(0);
      expect(await readFile(join(fixture.state, 'comment-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'labels'), 'utf8')).toBe('');

      const retry = runTriageHelper(fixture.bin, fixture.state);
      expect(retry.status, retry.stderr).toBe(0);
      expect(await readFile(join(fixture.state, 'comment-count'), 'utf8')).toBe('1\n');
      expect(await readFile(join(fixture.state, 'edit-count'), 'utf8')).toBe('2\n');
      expect(await readFile(join(fixture.state, 'labels'), 'utf8')).toBe('triaged\n');
      expect(await readFile(join(fixture.state, 'comments'), 'utf8')).toContain(
        '<!-- triage-dispatch:acknowledged -->'
      );
    } finally {
      await rm(resolve(fixture.bin, '..'), { recursive: true, force: true });
    }
  });

  it('fails closed before mutation when the latest labels or comments cannot be read', async () => {
    for (const env of [{ FAIL_LABEL_READ: '1' }, { FAIL_COMMENT_READ: '1' }]) {
      const fixture = await createFakeGh();
      try {
        const result = runTriageHelper(fixture.bin, fixture.state, env);
        expect(result.status).not.toBe(0);
        expect(await readFile(join(fixture.state, 'comment-count'), 'utf8')).toBe('0\n');
        expect(await readFile(join(fixture.state, 'edit-count'), 'utf8')).toBe('0\n');
      } finally {
        await rm(resolve(fixture.bin, '..'), { recursive: true, force: true });
      }
    }
  });

  it('propagates comment mutation failure without attempting the label mutation', async () => {
    const fixture = await createFakeGh();
    try {
      const result = runTriageHelper(fixture.bin, fixture.state, { FAIL_COMMENT_POST: '1' });

      expect(result.status).not.toBe(0);
      expect(await readFile(join(fixture.state, 'comment-count'), 'utf8')).toBe('0\n');
      expect(await readFile(join(fixture.state, 'edit-count'), 'utf8')).toBe('0\n');
      expect(await readFile(join(fixture.state, 'labels'), 'utf8')).toBe('');
    } finally {
      await rm(resolve(fixture.bin, '..'), { recursive: true, force: true });
    }
  });
});

describe('security-audit.yml — fail-closed Bun audit contract', () => {
  it('runs the native Bun audit and never skips or masks high-severity findings', async () => {
    const content = await readFile(SECURITY_AUDIT_WORKFLOW, 'utf8');

    expect(content).toContain('bun audit --audit-level=high');
    expect(content).not.toContain('npm i --package-lock-only');
    expect(content).not.toContain('npm audit');
    expect(content).not.toContain('Skipping');
    expect(content).not.toContain('|| true');
    expect(content).not.toContain('bun pm audit');
  });
});
