import { describe, expect, it } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../../..');
const GUIDANCE_DIRS = [
  '.codex/skills',
  'templates/.claude/skills',
  '.codex/rules',
  'templates/.claude/rules',
  'docs',
];
const SOURCE_R006 = join(ROOT, '.codex/rules/MUST-agent-design.md');
const TEMPLATE_R006 = join(ROOT, 'templates/.claude/rules/MUST-agent-design.md');
const WIKI_R006 = join(ROOT, 'wiki/rules/r006.md');
const PACKAGE_JSON = join(ROOT, 'package.json');
const TEMPLATE_MANIFEST = join(ROOT, 'templates/manifest.json');
const VERSION_AWARE_COMPATIBILITY_FILES = [
  '.codex/agents/mgr-creator.md',
  '.codex/agents/mgr-updater.md',
  '.codex/skills/roundtable-debate/SKILL.md',
  '.codex/skills/pipeline/workflows/auto-dev.yaml',
  'workflows/auto-dev.yaml',
  'templates/workflows/auto-dev.yaml',
];

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('sensitive output guidance', () => {
  it('does not instruct agents to pre-create session output directories with Bash mkdir', async () => {
    const files = (
      await Promise.all(GUIDANCE_DIRS.map((dir) => collectMarkdownFiles(join(ROOT, dir))))
    ).flat();
    const offenders: string[] = [];
    const prohibited = [
      /mkdir\s+-p[^\n]*(?:\.claude\/outputs|\.codex\/outputs|outputs\/sessions|session outputs?|output directories?)/,
      /creates the directory \(`mkdir -p`\) before writing/,
      /Skills create the directory \(`mkdir -p`\) before writing/,
      /Skills create directory \(mkdir -p\)/,
    ];

    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      if (prohibited.some((pattern) => pattern.test(content))) {
        offenders.push(file.replace(`${ROOT}/`, ''));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps R006 source and template sensitive-path guidance in sync', async () => {
    const source = await readFile(SOURCE_R006, 'utf-8');
    const template = await readFile(TEMPLATE_R006, 'utf-8');

    const sourceSection = source.match(
      /## Sensitive Path Handling\n[\s\S]*?(?=\n## Separation of Concerns)/
    );
    const templateSection = template.match(
      /## Sensitive Path Handling\n[\s\S]*?(?=\n## Separation of Concerns)/
    );

    expect(sourceSection?.[0]).toBeTruthy();
    expect(templateSection?.[0]).toBe(sourceSection?.[0]);
  });

  it('keeps R006 rule and wiki guidance aligned for sensitive .claude writes', async () => {
    const source = await readFile(SOURCE_R006, 'utf-8');
    const wiki = await readFile(WIKI_R006, 'utf-8');
    const required = [
      'templates/.claude/**',
      'Codex edit/patch flow',
      'CC v2.1.121+',
      'CC v2.1.126+',
      'Historical fallback only',
      'update `.codex/...` source files and their `templates/.claude/...` mirrors deliberately',
      'Sensitive-path compatibility note',
    ];

    for (const phrase of required) {
      expect(source).toContain(phrase);
      expect(wiki).toContain(phrase);
    }

    expect(wiki).toContain('.codex/rules/MUST-agent-design.md');
    expect(wiki).not.toContain('.claude/rules/MUST-agent-design.md');
  });

  it('keeps high-traffic compatibility surfaces on version-aware .claude guidance', async () => {
    for (const relativePath of VERSION_AWARE_COMPATIBILITY_FILES) {
      const content = await readFile(join(ROOT, relativePath), 'utf-8');
      expect(content).toContain('v2.1.121+');
      expect(content).toContain('v2.1.126+');
      expect(/(?:historical|legacy) fallback/.test(content)).toBe(true);
      expect(content).not.toContain('Sensitive-path artifact protocol (mandatory)');
    }
  });

  it('tracks minimum Claude Code compatibility metadata in package and manifest', async () => {
    const packageJson = JSON.parse(await readFile(PACKAGE_JSON, 'utf-8')) as {
      version: string;
      requiresCC?: string;
      claudeCode?: {
        minimumVersion?: string;
        protectedPathBypassVersion?: string;
      };
    };
    const manifest = JSON.parse(await readFile(TEMPLATE_MANIFEST, 'utf-8')) as {
      version: string;
      requiresCC?: string;
      claudeCode?: {
        minimumVersion?: string;
        protectedPathBypassVersion?: string;
      };
    };

    expect(packageJson.version).toBe(manifest.version);
    expect(packageJson.requiresCC).toBe('>=2.1.121');
    expect(manifest.requiresCC).toBe('>=2.1.121');
    expect(packageJson.claudeCode?.minimumVersion).toBe('2.1.121');
    expect(manifest.claudeCode?.minimumVersion).toBe('2.1.121');
    expect(packageJson.claudeCode?.protectedPathBypassVersion).toBe('2.1.126');
    expect(manifest.claudeCode?.protectedPathBypassVersion).toBe('2.1.126');
  });
});
