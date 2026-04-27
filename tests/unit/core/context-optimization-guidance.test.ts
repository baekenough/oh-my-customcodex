import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../../..');

const RULES = [
  {
    source: '.codex/rules/MUST-agent-design.md',
    template: 'templates/.claude/rules/MUST-agent-design.md',
    visibleLimit: 7_000,
    detailMarkers: [
      'DETAIL: Optional Frontmatter',
      'DETAIL: Sensitive Path Behavior',
      'DETAIL: Fast Mode Activation',
      'DETAIL: Skill Optional Fields',
    ],
  },
  {
    source: '.codex/rules/MUST-parallel-execution.md',
    template: 'templates/.claude/rules/MUST-parallel-execution.md',
    visibleLimit: 4_500,
    detailMarkers: [
      'DETAIL: Adaptive Parallel Splitting',
      'DETAIL: Stability Testing Protocol',
      'DETAIL: Narrative Announcement Format',
    ],
  },
  {
    source: '.codex/rules/SHOULD-memory-integration.md',
    template: 'templates/.claude/rules/SHOULD-memory-integration.md',
    visibleLimit: 3_000,
    detailMarkers: [
      'DETAIL: Why Immediate',
      'DETAIL: Session-End Flow',
      'DETAIL: Session-End Self-Check',
    ],
  },
  {
    source: '.codex/rules/MUST-agent-teams.md',
    template: 'templates/.claude/rules/MUST-agent-teams.md',
    visibleLimit: 4_500,
    detailMarkers: ['DETAIL: Lifecycle diagram'],
  },
];

function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, '');
}

describe('context optimization guidance', () => {
  it('keeps high-volume rule detail hidden behind HTML comments in source and template mirrors', async () => {
    for (const rule of RULES) {
      const source = await readFile(join(ROOT, rule.source), 'utf-8');
      const template = await readFile(join(ROOT, rule.template), 'utf-8');
      const visibleBytes = Buffer.byteLength(stripHtmlComments(source), 'utf-8');

      expect(template).toBe(source);
      expect(visibleBytes).toBeLessThanOrEqual(rule.visibleLimit);

      for (const marker of rule.detailMarkers) {
        expect(source).toContain(marker);
      }
    }
  });

  it('documents native MEMORY.md compaction as index-plus-archive workflow', async () => {
    const source = await readFile(join(ROOT, '.codex/agents/sys-memory-keeper.md'), 'utf-8');
    const wiki = await readFile(join(ROOT, 'wiki/agents/sys-memory-keeper.md'), 'utf-8');

    for (const phrase of [
      'Treat native auto-memory as an index, not a transcript',
      'Target roughly 100 active index lines',
      'archive it and keep a searchable pointer',
    ]) {
      expect(source).toContain(phrase);
    }

    expect(wiki).toContain('Native MEMORY.md should remain an index');
    expect(wiki).toContain('avoid deleting detail solely for line count');
  });
});
