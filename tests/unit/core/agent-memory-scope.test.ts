import { describe, expect, it } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { compileMarkdownAgent } from '../../../src/core/agent-compiler.js';

const ROOT = join(import.meta.dir, '../../..');
const SOURCE_AGENTS = join(ROOT, '.codex/agents');
const TEMPLATE_AGENTS = join(ROOT, 'templates/.claude/agents');

type MemoryScope = 'project' | 'local' | 'user' | null;

interface OntologyAgent {
  memory?: string;
}

interface OntologyDocument {
  agents: Record<string, OntologyAgent>;
}

function memoryScope(markdown: string): MemoryScope {
  const match = markdown.match(/^memory:\s*(project|local|user)\s*$/m);
  return (match?.[1] as Exclude<MemoryScope, null> | undefined) ?? null;
}

async function readAgentScopes(root: string): Promise<Map<string, MemoryScope>> {
  const filenames = (await readdir(root)).filter((name) => name.endsWith('.md')).sort();
  const entries = await Promise.all(
    filenames.map(async (filename) => [
      filename.slice(0, -'.md'.length),
      memoryScope(await readFile(join(root, filename), 'utf-8')),
    ])
  );
  return new Map(entries as [string, MemoryScope][]);
}

function distribution(scopes: Iterable<MemoryScope>): Record<string, number> {
  const result = { project: 0, local: 0, user: 0, absent: 0 };
  for (const scope of scopes) result[scope ?? 'absent'] += 1;
  return result;
}

describe('managed agent memory scope policy', () => {
  it('keeps every managed package agent session-local while preserving user and absent scopes', async () => {
    const source = await readAgentScopes(SOURCE_AGENTS);
    const template = await readAgentScopes(TEMPLATE_AGENTS);

    expect(source.size).toBe(50);
    expect(template).toEqual(source);
    expect(distribution(source.values())).toEqual({
      project: 0,
      local: 44,
      user: 5,
      absent: 1,
    });
    expect([...source.entries()].filter(([, scope]) => scope === null)).toEqual([
      ['slack-cli-expert', null],
    ]);
  });

  it('keeps ontology memory metadata aligned without expanding its existing inventory', async () => {
    const sourceAgents = await readAgentScopes(SOURCE_AGENTS);
    const sourceText = await readFile(join(ROOT, '.codex/ontology/agents.yaml'), 'utf-8');
    const templateText = await readFile(
      join(ROOT, 'templates/.claude/ontology/agents.yaml'),
      'utf-8'
    );
    const ontology = parseYaml(sourceText) as OntologyDocument;
    const ontologyScopes = Object.values(ontology.agents).map(
      ({ memory }) => (memory ?? null) as MemoryScope
    );

    expect(templateText).toBe(sourceText);
    expect(Object.keys(ontology.agents)).toHaveLength(44);
    expect(distribution(ontologyScopes)).toEqual({
      project: 0,
      local: 39,
      user: 5,
      absent: 0,
    });
    for (const [name, metadata] of Object.entries(ontology.agents)) {
      expect(metadata.memory).toBe(sourceAgents.get(name));
    }
  });

  it('ignores local memory at project roots and nested worker roots', async () => {
    const gitignore = await readFile(join(ROOT, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('**/agent-memory-local/');

    for (const path of [
      '.codex/agent-memory-local/example/MEMORY.md',
      'src/package/.codex/agent-memory-local/example/MEMORY.md',
      'templates/.claude/agent-memory-local/example/MEMORY.md',
    ]) {
      const result = Bun.spawnSync(['git', 'check-ignore', '--no-index', '-q', path], {
        cwd: ROOT,
      });
      expect(result.exitCode).toBe(0);
    }

    const tracked = Bun.spawnSync(['git', 'ls-files'], { cwd: ROOT });
    expect(tracked.exitCode).toBe(0);
    expect(tracked.stdout.toString()).not.toMatch(/(^|\/)agent-memory(?:-local)?\//m);
  });

  it('does not leak compatibility memory metadata into native Codex TOML', () => {
    const compiled = compileMarkdownAgent(
      `---
name: memory-boundary
description: Memory provider boundary fixture
model: inherit
domain: universal
memory: local
tools: [Read]
permissionMode: default
---

Keep memory metadata at the compatibility source boundary.
`,
      { modelLanes: {} }
    );

    expect(Bun.TOML.parse(compiled.toml)).not.toHaveProperty('memory');
    expect(compiled.config).not.toHaveProperty('memory');
  });

  it('documents the compiler boundary and keeps managed defaults local', async () => {
    const r006 = await readFile(join(ROOT, '.codex/rules/MUST-agent-design.md'), 'utf-8');
    const templateR006 = await readFile(
      join(ROOT, 'templates/.claude/rules/MUST-agent-design.md'),
      'utf-8'
    );
    const r011 = await readFile(join(ROOT, '.codex/rules/SHOULD-memory-integration.md'), 'utf-8');
    const templateR011 = await readFile(
      join(ROOT, 'templates/.claude/rules/SHOULD-memory-integration.md'),
      'utf-8'
    );
    const creator = await readFile(join(ROOT, '.codex/agents/mgr-creator.md'), 'utf-8');
    const templateCreator = await readFile(
      join(ROOT, 'templates/.claude/agents/mgr-creator.md'),
      'utf-8'
    );
    const adaptiveHarness = await readFile(
      join(ROOT, '.codex/skills/adaptive-harness/SKILL.md'),
      'utf-8'
    );
    const templateAdaptiveHarness = await readFile(
      join(ROOT, 'templates/.claude/skills/adaptive-harness/SKILL.md'),
      'utf-8'
    );

    expect(templateR006).toBe(r006);
    expect(templateR011).toBe(r011);
    expect(templateAdaptiveHarness).toBe(adaptiveHarness);
    for (const rule of [r006, r011]) {
      expect(rule).toContain('does not emit `memory` into native Codex TOML or compiled config');
      expect(rule).toContain('Managed packaged agents default to `local`');
      expect(rule).toContain('| `project` | `.codex/agent-memory/<name>/` | Yes |');
    }
    for (const agent of [creator, templateCreator]) {
      expect(agent).toContain('- `local` memory scope');
      expect(agent).not.toContain('- `project` memory scope');
    }
    expect(r006).toContain('memory: local');
    expect(r006).not.toContain('memory: project            # user | project | local');
    expect(adaptiveHarness).toContain('`.codex/agent-memory-local/`');
    expect(adaptiveHarness).not.toContain('`.codex/agent-memory/` — agent memory files');
  });
});
