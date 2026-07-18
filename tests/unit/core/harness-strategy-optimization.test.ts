import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../../..');

async function read(relativePath: string): Promise<string> {
  return readFile(join(ROOT, relativePath), 'utf-8');
}

const DETERMINISTIC_GATES = [
  'verify-template-sync.sh',
  'verify-wiki-sync.sh',
  'verify-version-sync.sh',
  'verify-fork-list.sh',
  'validate-docs.ts --programmatic-only',
];

describe('R017 cost-aware verification strategy', () => {
  it('skips rounds 3-4 only after an exact clean result from both initial rounds', async () => {
    const skill = await read('.codex/skills/sauron-watch/SKILL.md');
    const templateSkill = await read('templates/.claude/skills/sauron-watch/SKILL.md');
    const agent = await read('.codex/agents/mgr-sauron.md');
    const templateAgent = await read('templates/.claude/agents/mgr-sauron.md');
    const rule = await read('.codex/rules/MUST-sync-verification.md');
    const templateRule = await read('templates/.claude/rules/MUST-sync-verification.md');

    expect(templateSkill).toBe(skill);
    expect(templateRule).toBe(rule);
    for (const content of [skill, agent, templateAgent, rule]) {
      expect(content).toContain('Round 1 and Round 2 both report exactly 0 issues');
      expect(content).toContain('SKIPPED (clean)');
      expect(content).toContain('warning, issue, execution error, or indeterminate result');
      expect(content).toContain('Deep Review rounds are never skipped');
    }
  });

  it('consumes deterministic script evidence without dropping semantic checks', async () => {
    const skill = await read('.codex/skills/sauron-watch/SKILL.md');
    const agent = await read('.codex/agents/mgr-sauron.md');
    const rule = await read('.codex/rules/MUST-sync-verification.md');

    for (const content of [skill, agent, rule]) {
      for (const gate of DETERMINISTIC_GATES) expect(content).toContain(gate);
      expect(content).toContain('[script]');
      expect(content).toContain('frontmatter');
      expect(content).toContain('skill refs');
      expect(content).toContain('routing');
    }
  });
});

describe('delegated permission provider boundary', () => {
  it('makes R010 canonical without adding a Claude-only mode to native spawn_agent', async () => {
    const r010 = await read('.codex/rules/MUST-orchestrator-coordination.md');
    const templateR010 = await read('templates/.claude/rules/MUST-orchestrator-coordination.md');
    const r006 = await read('.codex/rules/MUST-agent-design.md');

    expect(templateR010).toBe(r010);
    for (const phrase of [
      '## Delegated Permission Ownership',
      'Codex/OMX native',
      '`spawn_agent` does not accept a `mode` parameter',
      '`agent_type`',
      '`sandbox_mode`',
      'active approval policy',
      'Claude compatibility',
      '`mode: "bypassPermissions"`',
      'when the active Claude session uses bypass permissions',
    ]) {
      expect(r010).toContain(phrase);
    }
    expect(r010).not.toContain('ALL Agent tool calls MUST include `mode: "bypassPermissions"`');
    expect(r006).toContain('Canonical owner: R010 “Delegated Permission Ownership”');
  });

  it('retains provider-scoped defensive guidance at every delegation call site', async () => {
    for (const skill of [
      'secretary-routing',
      'dev-lead-routing',
      'de-lead-routing',
      'qa-lead-routing',
      'pipeline',
      'scout',
      'research',
      'homework',
      'deep-plan',
      'professor-triage',
    ]) {
      const source = await read(`.codex/skills/${skill}/SKILL.md`);
      const template = await read(`templates/.claude/skills/${skill}/SKILL.md`);
      expect(template).toBe(source);
      expect(source).toContain('Claude compatibility `Agent` calls only');
      expect(source).toContain('R010 “Delegated Permission Ownership”');
      expect(source).toContain('Native Codex `spawn_agent` has no `mode` parameter');
      expect(source).toContain('mode: "bypassPermissions"');
      expect(source).not.toContain('R010 Universal bypassPermissions');
      expect(source).not.toContain('When spawning agents, pass `mode: "bypassPermissions"`');
      expect(source).not.toContain('if the runtime supports it');
    }
  });
});
