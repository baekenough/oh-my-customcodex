import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const ROOT_WORKFLOW = resolve(import.meta.dir, '../../../workflows/auto-dev.yaml');
const TEMPLATE_WORKFLOW = resolve(import.meta.dir, '../../../templates/workflows/auto-dev.yaml');
const SKILL_WORKFLOW = resolve(
  import.meta.dir,
  '../../../.codex/skills/pipeline/workflows/auto-dev.yaml'
);
const POST_RELEASE = resolve(
  import.meta.dir,
  '../../../.codex/skills/post-release-followup/SKILL.md'
);
const POST_RELEASE_TEMPLATE = resolve(
  import.meta.dir,
  '../../../templates/.claude/skills/post-release-followup/SKILL.md'
);

interface WorkflowStep {
  name?: string;
  skill?: string;
  prompt?: string;
  description?: string;
  depends_on?: string | string[];
  parallel?: WorkflowStep[];
}

interface Workflow {
  steps?: WorkflowStep[];
}

function steps(content: string): WorkflowStep[] {
  return (parse(content) as Workflow).steps ?? [];
}

function stepText(step: WorkflowStep): string {
  return JSON.stringify(step);
}

function requireOrderedSteps(content: string): void {
  const names = steps(content).map(({ name }) => name);
  const required = [
    'preflight-sync',
    'scope-selection',
    'triage-draft',
    'plan',
    'deep-plan',
    'evidence-review',
    'mutation-commit',
    'implement',
  ];
  let previous = -1;
  for (const name of required) {
    const index = names.indexOf(name);
    expect(index, `missing workflow step: ${name}`).toBeGreaterThan(previous);
    previous = index;
  }
}

function expectSemanticLifecycle(content: string): void {
  expect(content).toContain('scripts/resolve-release-target.mjs');
  expect(content).toContain('public npm');
  expect(content).toContain('GitHub Packages');
  expect(content).toContain('ghpLatest');
  expect(content).toContain('triage-draft');
  expect(content).toContain('evidence-review');
  expect(content).toContain('mutation-commit');
  expect(content).toContain('scripts/apply-triage-draft.mjs');
  expect(content).toContain('direct readback');
  expect(content).toContain('--expected-target');
  expect(content).not.toContain('--proposed-target');
  requireOrderedSteps(content);
}

function expectNoPreBarrierMutation(content: string): void {
  const workflowSteps = steps(content);
  const barrierIndex = workflowSteps.findIndex(({ name }) => name === 'mutation-commit');
  expect(barrierIndex).toBeGreaterThan(-1);
  const preBarrier = workflowSteps.slice(0, barrierIndex).map(stepText).join('\n');

  const forbidden = [
    /skill["']?\s*:\s*["']?professor-triage/i,
    /analyze-issue\.ts/i,
    /\bgh\s+label\s+create\b/i,
    /\bgh\s+issue\s+(?:edit|comment|close|reopen)\b/i,
    /\bgh\s+api\b[^\n]*(?:--method|-X)\s*(?:POST|PATCH|DELETE)\b/i,
    /\bnpm\s+publish\b/i,
    /\bgh\s+release\s+create\b/i,
  ];
  for (const pattern of forbidden) {
    expect(preBarrier).not.toMatch(pattern);
  }
}

function requireStep(content: string, name: string): WorkflowStep {
  const step = steps(content).find((candidate) => candidate.name === name);
  expect(step, `missing workflow step: ${name}`).toBeDefined();
  return step as WorkflowStep;
}

function expectNoDirectImplementLifecycleMutation(content: string): void {
  const implement = stepText(requireStep(content, 'implement'));
  const forbidden = [
    /\bgh\s+issue\s+(?:edit|comment|close|reopen)\b/i,
    /\bgh\s+api\b[^\n]*(?:--method|-X)\s*(?:POST|PATCH|DELETE)\b/i,
    /\bgh\s+label\s+(?:create|edit|delete)\b/i,
  ];

  for (const pattern of forbidden) {
    expect(implement).not.toMatch(pattern);
  }
}

function expectDetailedLifecycleDraftReentry(content: string): void {
  const implement = stepText(requireStep(content, 'implement'));
  const mutationProtocol =
    'reviewed draft -> evidence review -> apply-triage-draft -> direct readback';
  for (const marker of [
    'lifecycle draft for the start transition',
    mutationProtocol,
    're-enter the lifecycle mutation protocol with new direct evidence and a fresh draft',
    'the start draft cannot authorize outcome-dependent actions',
    'Success draft:',
    'Failure draft:',
    'Any later retry or outcome-dependent lifecycle action must re-enter',
    'Never run a direct lifecycle mutation command or improvise a fallback',
  ]) {
    expect(implement).toContain(marker);
  }

  expect(implement.match(new RegExp(mutationProtocol, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(2);
  expect(implement.match(/scripts\/apply-triage-draft\.mjs/g)?.length ?? 0).toBeGreaterThanOrEqual(
    2
  );
  expect(implement.match(/direct readback/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
}

function expectAutoTagOwnedRelease(content: string): void {
  const release = stepText(requireStep(content, 'release'));
  for (const marker of [
    'Auto Tag workflow owns annotated tag creation',
    'tag-triggered Release workflow owns npm, GitHub Packages, and GitHub Release publication',
    'Do not create or push release tags manually',
    'Do not create the GitHub Release manually',
    'Do not directly close or relabel scoped issues or the milestone',
    'fresh reviewed draft',
    'scripts/apply-triage-draft.mjs',
    'direct readback',
    'After Auto Tag closes a milestone, verify by milestone number',
  ]) {
    expect(release).toContain(marker);
  }

  expect(release).not.toMatch(/\bgit\s+tag\b/i);
  expect(release).not.toMatch(/\bgh\s+release\s+create\b/i);
  expect(release).not.toMatch(/\bgh\s+issue\s+(?:edit|comment|close|reopen)\b/i);
}

function expectAutomationAwarePublish(content: string): void {
  const release = stepText(requireStep(content, 'release'));
  const publish = stepText(requireStep(content, 'publish'));
  const combined = `${release}\n${publish}`;
  for (const marker of [
    'Detect repository-owned tag and release automation before any external write',
    'When automation owns the transition, merge the reviewed release PR and observe the workflow',
    'Do not create or push tags manually while repository automation owns them',
    'Any manual issue or milestone recovery must use a fresh reviewed local mutation draft',
  ]) {
    expect(combined).toContain(marker);
  }
}

describe('auto-dev release lifecycle evidence', () => {
  it('keeps the root and template authoring workflows byte-identical', async () => {
    const [root, template] = await Promise.all([
      readFile(ROOT_WORKFLOW, 'utf8'),
      readFile(TEMPLATE_WORKFLOW, 'utf8'),
    ]);
    expect(root).toBe(template);
  });

  it('keeps semantic target and mutation ordering in both workflow surfaces', async () => {
    const [root, skill] = await Promise.all([
      readFile(ROOT_WORKFLOW, 'utf8'),
      readFile(SKILL_WORKFLOW, 'utf8'),
    ]);
    expectSemanticLifecycle(root);
    expectSemanticLifecycle(skill);
  });

  it('has zero GitHub mutation and no professor-triage execution before the barrier', async () => {
    const [root, skill] = await Promise.all([
      readFile(ROOT_WORKFLOW, 'utf8'),
      readFile(SKILL_WORKFLOW, 'utf8'),
    ]);
    expectNoPreBarrierMutation(root);
    expectNoPreBarrierMutation(skill);
  });

  it('forbids direct GitHub lifecycle writes from every implement surface', async () => {
    const [root, skill] = await Promise.all([
      readFile(ROOT_WORKFLOW, 'utf8'),
      readFile(SKILL_WORKFLOW, 'utf8'),
    ]);
    expectNoDirectImplementLifecycleMutation(root);
    expectNoDirectImplementLifecycleMutation(skill);
  });

  it('requires fresh reviewed-draft re-entry for start and outcome lifecycle changes', async () => {
    const skill = await readFile(SKILL_WORKFLOW, 'utf8');
    expectDetailedLifecycleDraftReentry(skill);
  });

  it('leaves tag, publication, and provisional closure to repository automation', async () => {
    const [root, template, skill] = await Promise.all([
      readFile(ROOT_WORKFLOW, 'utf8'),
      readFile(TEMPLATE_WORKFLOW, 'utf8'),
      readFile(SKILL_WORKFLOW, 'utf8'),
    ]);
    expectAutomationAwarePublish(root);
    expectAutomationAwarePublish(template);
    expectAutoTagOwnedRelease(skill);
  });

  it('binds every comment draft to a complete issue snapshot and exact regular-file bytes', async () => {
    const [root, template, skill] = await Promise.all([
      readFile(ROOT_WORKFLOW, 'utf8'),
      readFile(TEMPLATE_WORKFLOW, 'utf8'),
      readFile(SKILL_WORKFLOW, 'utf8'),
    ]);

    for (const content of [root, template, skill]) {
      expect(content).toContain('regular non-symlink body file');
      expect(content).toContain('complete issue precondition');
      expect(content).toContain('`bodyBytes`');
      expect(content).toContain('`bodySha256`');
      expect(content).toContain(
        'only `issue.update`, `label.ensure`, and `milestone.ensure` require a `desired` snapshot'
      );
      expect(content).toContain('order the comment before the update');
      expect(content).toContain('validates the full sequence before its first write');
    }
  });

  it('preserves the detailed compatibility workflow implementation, verification, release, and CI anchors', async () => {
    const skill = await readFile(SKILL_WORKFLOW, 'utf8');
    expect(skill.split('\n').length).toBeGreaterThanOrEqual(300);
    for (const anchor of [
      'Dispatch specialist agents per file domain',
      'TDD via superpowers:test-driven-development',
      'Scope-change re-entry guard',
      'bun test — MANDATORY, no silent skip',
      'Release notes via omcustomcodex-release-notes skill',
      'After Auto Tag closes a milestone, verify by milestone number',
      'Post-release CI verification.',
      'gh run list --limit 5',
    ]) {
      expect(skill).toContain(anchor);
    }
  });
});

describe('post-release lifecycle meaning', () => {
  it('uses verify-ready as remaining work and isolates decision-needed', async () => {
    const [source, template] = await Promise.all([
      readFile(POST_RELEASE, 'utf8'),
      readFile(POST_RELEASE_TEMPLATE, 'utf8'),
    ]);

    expect(source).toBe(template);
    expect(source).toContain(
      'gh issue list --label verify-ready --state open --json number,title,labels,milestone'
    );
    expect(source).toContain(
      'gh issue list --label decision-needed --state open --json number,title,labels,milestone'
    );
    expect(source).toContain('human decision queue');
    expect(source).toContain('--body-file');
    expect(source).toContain('title_file=$(mktemp)');
    expect(source).toContain('--title "$title"');
    expect(source).toContain('gh issue view "$issue_number"');
    expect(source).toContain('--json number,title,body,labels');
    expect(source).not.toContain('Read the latest professor-triage output');
    expect(source).not.toContain('--title "{간결한 설명}"');
    expect(source).not.toContain('gh issue list --label verify-done --state open');
  });
});

describe('release verification rules', () => {
  const pairs = [
    ['MAY-optimization.md', ['PIPESTATUS[0]', 'explicit Bash', 'display pipe']],
    [
      'MUST-sync-verification.md',
      [
        'git log -- <path>',
        'deletion-adjacent',
        'latest pre-deletion behavior',
        'Do not restore an arbitrary older version',
        'tracked entry type',
        'symbolic link',
        'git status --short',
        'git diff -- <path>',
        'shasum -a 256 <path>',
        'narrowest relevant test',
      ],
    ],
    [
      'MUST-completion-verification.md',
      [
        'evidence join',
        'reviewed local mutation draft',
        'direct ground truth',
        'direct readback',
        'Exact-Worktree Verification Guard',
        'verify_dir=$(cd -P -- "$verify_dir" && pwd)',
        'git rev-parse --show-toplevel',
        'test "$actual_sha" = "$expected_sha"',
        'post-merge install and test commands',
        'Artifact helper write, validate, and select steps remain separate',
      ],
    ],
  ] as const;

  for (const [filename, markers] of pairs) {
    it(`keeps ${filename} mirrored with lifecycle evidence markers`, async () => {
      const [source, template] = await Promise.all([
        readFile(resolve(import.meta.dir, '../../../.codex/rules', filename), 'utf8'),
        readFile(resolve(import.meta.dir, '../../../templates/.claude/rules', filename), 'utf8'),
      ]);
      expect(source).toBe(template);
      for (const marker of markers) {
        expect(source).toContain(marker);
      }
    });
  }

  it('uses direct ground truth instead of unconditional verifier resume', async () => {
    const source = await readFile(
      resolve(import.meta.dir, '../../../.codex/rules/MUST-completion-verification.md'),
      'utf8'
    );
    expect(source).toContain('Direct ground truth is primary');
    expect(source).toContain('only when');
    expect(source).toContain('unfinished verification work');
    expect(source).toContain('Synthesize the verdict from direct ground truth');
    expect(source).not.toContain('do not end the turn without a final PASS/FAIL verdict');
    expect(source).not.toContain('resume it and obtain the final verdict');
    expect(source).not.toContain('resume on mid-step termination');
  });

  it('scopes exact-worktree same-shell execution to post-merge install and test commands', async () => {
    const source = await readFile(
      resolve(import.meta.dir, '../../../.codex/rules/MUST-completion-verification.md'),
      'utf8'
    );

    expect(source).toContain(
      'This same-shell guard governs post-merge install and test commands only.'
    );
    expect(source).toContain(
      'Artifact helper write, validate, and select steps remain separate and must'
    );
    expect(source).not.toContain('install, test, build, and artifact');
  });
});
