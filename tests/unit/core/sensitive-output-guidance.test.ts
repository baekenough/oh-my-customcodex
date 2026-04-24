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
});
