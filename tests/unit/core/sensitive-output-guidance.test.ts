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
      'Bash writes, Write, Edit',
      'allow rules do not override the sensitive-path check',
      'do not rely on them to suppress sensitive-path prompts',
      'update `.codex/...` source files and their `templates/.claude/...` mirrors deliberately',
    ];

    for (const phrase of required) {
      expect(source).toContain(phrase);
      expect(wiki).toContain(phrase);
    }

    expect(wiki).toContain('.codex/rules/MUST-agent-design.md');
    expect(wiki).not.toContain('.claude/rules/MUST-agent-design.md');
  });
});
