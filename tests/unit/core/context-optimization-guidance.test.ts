import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../../..');

interface CompatibilityDetail {
  marker: string;
  phrases: string[];
  hiddenPhrases: string[];
}

interface RuleContract {
  source: string;
  template: string;
  visibleLimit: number;
  detailMarkers: string[];
  visiblePhrases?: string[];
  compatibilityDetails?: CompatibilityDetail[];
}

const RULES: RuleContract[] = [
  {
    source: '.codex/rules/MUST-agent-identification.md',
    template: 'templates/.claude/rules/MUST-agent-identification.md',
    visibleLimit: 2_500,
    detailMarkers: ['DETAIL: Skill Invocation Violation Examples'],
    visiblePhrases: [
      'Every response MUST start with agent identification',
      'Short answers, diagnostics, status pings, and corrections are not exempt',
      'When the orchestrator invokes a skill via the Skill tool',
    ],
    compatibilityDetails: [
      {
        marker: 'DETAIL: Skill Invocation Violation Examples',
        phrases: ['Incorrect: Skill as separate display', 'Correct: With sub-skill'],
        hiddenPhrases: ['Incorrect: Skill as separate display', 'Correct: With sub-skill'],
      },
    ],
  },
  {
    source: '.codex/rules/MUST-tool-identification.md',
    template: 'templates/.claude/rules/MUST-tool-identification.md',
    visibleLimit: 5_600,
    detailMarkers: [
      'DETAIL: Full violation examples',
      'DETAIL: Consolidated Tool Identification Examples',
    ],
    visiblePhrases: [
      'Every tool call MUST be prefixed with agent and model identification',
      'Required-Parameter Completeness Check',
      'Parallel Spawn Prefix Rule',
      'Multi-Turn Self-Check',
    ],
    compatibilityDetails: [
      {
        marker: 'DETAIL: Consolidated Tool Identification Examples',
        phrases: [
          '[mgr-creator][frontier/medium] → Write:',
          'Parallel spawn description parameter:',
        ],
        hiddenPhrases: [
          '[mgr-creator][frontier/medium] → Write:',
          'Parallel spawn description parameter:',
        ],
      },
    ],
  },
  {
    source: '.codex/rules/MUST-agent-design.md',
    template: 'templates/.claude/rules/MUST-agent-design.md',
    visibleLimit: 7_000,
    detailMarkers: [
      'DETAIL: Optional Frontmatter',
      'DETAIL: Sensitive Path Behavior',
      'DETAIL: Fast Mode Activation',
      'DETAIL: Skill Optional Fields',
      'DETAIL: Claude Code v2.1.204 Headless SessionStart Compatibility',
      'DETAIL: Claude Code v2.1.208 Agent Tool Validation Compatibility',
    ],
    compatibilityDetails: [
      {
        marker: 'DETAIL: Claude Code v2.1.204 Headless SessionStart Compatibility',
        phrases: [
          'Claude Code v2.1.204',
          'SessionStart',
          'headless',
          'Claude Code v2.1.204 fixes SessionStart hook output streaming in headless sessions',
        ],
        hiddenPhrases: [
          'Claude Code v2.1.204',
          'Claude Code v2.1.204 fixes SessionStart hook output streaming in headless sessions',
        ],
      },
      {
        marker: 'DETAIL: Claude Code v2.1.208 Agent Tool Validation Compatibility',
        phrases: [
          'Claude Code v2.1.208',
          'tools:',
          'unrecognized',
          'Claude Code v2.1.208 reports an Agent tool configuration error when `tools:` resolves to an empty set',
        ],
        hiddenPhrases: [
          'Claude Code v2.1.208',
          'Claude Code v2.1.208 reports an Agent tool configuration error when `tools:` resolves to an empty set',
        ],
      },
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
      'DETAIL: Claude Code v2.1.202 Dynamic Workflow Size Compatibility',
    ],
    compatibilityDetails: [
      {
        marker: 'DETAIL: Claude Code v2.1.202 Dynamic Workflow Size Compatibility',
        phrases: ['Claude Code v2.1.202', 'Dynamic workflow size', 'advisory'],
        hiddenPhrases: ['Claude Code v2.1.202', 'Dynamic workflow size'],
      },
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
    detailMarkers: [
      'DETAIL: Lifecycle diagram',
      'DETAIL: Claude Code v2.1.202 Agent Teams Sizing Compatibility',
    ],
    compatibilityDetails: [
      {
        marker: 'DETAIL: Claude Code v2.1.202 Agent Teams Sizing Compatibility',
        phrases: ['Claude Code v2.1.202', 'Dynamic workflow size', 'advisory'],
        hiddenPhrases: ['Claude Code v2.1.202', 'Dynamic workflow size'],
      },
    ],
  },
];

function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, '');
}

function extractHtmlComment(content: string, marker: string): string {
  const matchingComments = [...content.matchAll(/<!--[\s\S]*?-->/g)]
    .map((match) => match[0])
    .filter((comment) => comment.includes(marker));

  expect(matchingComments).toHaveLength(1);
  return matchingComments[0];
}

function expectCompatibilityDetailsToBeHidden(
  source: string,
  details: CompatibilityDetail[]
): void {
  const visibleText = stripHtmlComments(source);
  for (const detail of details) {
    const detailBlock = extractHtmlComment(source, detail.marker);
    for (const phrase of detail.phrases) {
      expect(detailBlock).toContain(phrase);
    }
    for (const phrase of detail.hiddenPhrases) {
      expect(visibleText).not.toContain(phrase);
    }
  }
}

describe('context optimization guidance', () => {
  it('does not join adjacent HTML comments around a visible marker', () => {
    const marker = 'DETAIL: visible marker';
    const content = `<!-- first comment -->\n${marker}\n<!-- second comment -->`;

    expect(() => extractHtmlComment(content, marker)).toThrow();
  });

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

      for (const phrase of rule.visiblePhrases ?? []) {
        expect(stripHtmlComments(source)).toContain(phrase);
      }

      expectCompatibilityDetailsToBeHidden(source, rule.compatibilityDetails ?? []);
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
