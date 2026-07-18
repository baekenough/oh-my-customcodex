import { describe, expect, it } from 'bun:test';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const ROOT = resolve(import.meta.dir, '../../..');

function path(relativePath: string): string {
  return resolve(ROOT, relativePath);
}

async function text(relativePath: string): Promise<string> {
  return readFile(path(relativePath), 'utf8');
}

interface HookHandler {
  type: string;
  command?: string;
}

interface HookRegistry {
  hooks: Record<string, Array<{ hooks: HookHandler[] }>>;
}

interface WorkflowStep {
  name?: string;
  id?: string;
  if?: string;
  env?: Record<string, string>;
  run?: string;
}

interface WorkflowDocument {
  jobs: Record<string, { steps: WorkflowStep[] }>;
}

const HOOK_ROOTS = [
  '.codex/hooks/scripts',
  'templates/.claude/hooks/scripts',
  'plugins/oh-my-customcodex/hooks/scripts',
] as const;

const EXECUTABLE_HOOKS = [
  'agent-teams-advisor.sh',
  'destructive-git-guard.sh',
  'feedback-collector.sh',
  'git-delegation-guard.sh',
  'session-env-check.sh',
  'session-reflection.sh',
] as const;

describe('v1.0.29 harness hygiene contract', () => {
  it('keeps structured-dev-cycle stage state PPID-scoped across shipped mirrors', async () => {
    const files = [
      '.codex/hooks/scripts/stage-blocker.sh',
      '.codex/hooks/scripts/task-state-precompact.sh',
      '.codex/skills/structured-dev-cycle/SKILL.md',
      '.codex/rules/MUST-orchestrator-coordination.md',
      'templates/.claude/hooks/scripts/stage-blocker.sh',
      'templates/.claude/hooks/scripts/task-state-precompact.sh',
      'templates/.claude/skills/structured-dev-cycle/SKILL.md',
      'templates/.claude/rules/MUST-orchestrator-coordination.md',
      'plugins/oh-my-customcodex/hooks/scripts/stage-blocker.sh',
      'plugins/oh-my-customcodex/hooks/scripts/task-state-precompact.sh',
      'plugins/oh-my-customcodex/skills/structured-dev-cycle/SKILL.md',
    ];

    for (const file of files) {
      const content = await text(file);
      expect(content, file).toContain('/tmp/.codex-dev-stage-$PPID');
      expect(content, file).not.toMatch(/\/tmp\/\.codex-dev-stage(?!-\$PPID)/);
    }
  });

  it('registers session-autofix-prompt as a command hook in every shipped registry', async () => {
    for (const file of [
      '.codex/hooks/hooks.json',
      'templates/.claude/hooks/hooks.json',
      'plugins/oh-my-customcodex/hooks/hooks.json',
    ]) {
      const registry = JSON.parse(await text(file)) as HookRegistry;
      const handlers = Object.values(registry.hooks)
        .flat()
        .flatMap((group) => group.hooks);
      const handler = handlers.find((candidate) =>
        candidate.command?.includes('session-autofix-prompt.sh')
      );
      expect(handler, file).toBeDefined();
      expect(handler?.type, file).toBe('command');
    }
  });

  it('ships the six direct hook entrypoints as executable in every mirror', async () => {
    for (const root of HOOK_ROOTS) {
      for (const hook of EXECUTABLE_HOOKS) {
        const mode = (await stat(path(`${root}/${hook}`))).mode;
        expect(mode & 0o111, `${root}/${hook}`).not.toBe(0);
      }
    }
  });

  it('pins cache and artifact actions to the verified commit SHAs', async () => {
    const workflowFiles = (await readdir(path('.github/workflows'))).filter((file) =>
      /\.ya?ml$/.test(file)
    );
    const workflows = (
      await Promise.all(workflowFiles.map((file) => text(`.github/workflows/${file}`)))
    ).join('\n');

    expect(
      workflows.match(/uses:\s+actions\/(?:cache|upload-artifact|download-artifact)@v\d+/g) ?? []
    ).toEqual([]);
    expect(workflows).toContain('actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6');
    expect(workflows).toContain(
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7'
    );
    expect(workflows).toContain(
      'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8'
    );
  });

  it('stops wiki-sync steps when OMCODEX_MASTER is not configured', async () => {
    const content = await text('.github/workflows/docs-sync.yml');
    const workflow = parse(content) as WorkflowDocument;
    const steps = workflow.jobs['sync-wiki']?.steps ?? [];
    const check = steps.find((step) => step.name === 'Check PAT secret');

    expect(content).toContain('# Only run if OMCODEX_MASTER secret is configured');
    expect(content).not.toContain('WIKI_PAT');
    expect(check?.id).toBe('pat');
    expect(check?.env?.OMCODEX_MASTER).toBe('$' + '{{ secrets.OMCODEX_MASTER }}');
    expect(check?.run).toContain('configured=false');
    expect(check?.run).toContain('configured=true');

    for (const name of [
      'Checkout repository',
      'Checkout wiki',
      'Check wiki checkout',
      'Sync wiki pages',
      'Check for changes',
      'Commit and push wiki changes',
      'Create summary',
    ]) {
      const step = steps.find((candidate) => candidate.name === name);
      expect(step, name).toBeDefined();
      expect(String(step?.if), name).toContain("steps.pat.outputs.configured == 'true'");
    }
  });

  it('does not ship the upstream-confirmed stale and orphan assets', async () => {
    for (const file of [
      '.github/scripts/analyze-issue.ts',
      '.github/scripts/notify-teammates.ts',
      'scripts/sync-wiki.sh',
      'scripts/sync-core.ts',
      '.codex/ci-status.json.template',
      '.codex/TODO.md',
    ]) {
      await expect(access(path(file)), file).rejects.toThrow();
    }
  });
});
