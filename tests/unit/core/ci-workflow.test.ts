import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const TRIAGE_WORKFLOW = resolve(import.meta.dir, '../../../.github/workflows/triage-dispatch.yml');
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
