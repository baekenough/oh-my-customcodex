import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectServeProjectLayout,
  findServeProjectRoot,
} from '../../../packages/serve/src/lib/server/runtime-layout.js';

describe('serve runtime layout detection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-serve-layout-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('prefers installed codex projects with .agents/skills', async () => {
    await writeFile(join(tempDir, 'AGENTS.md'), '# Test\n');
    await mkdir(join(tempDir, '.codex', 'agents'), { recursive: true });
    await mkdir(join(tempDir, '.agents', 'skills'), { recursive: true });
    await mkdir(join(tempDir, '.codex', 'rules'), { recursive: true });

    const layout = await detectServeProjectLayout(tempDir);

    expect(layout.surface).toBe('codex-installed');
    expect(layout.entryFile).toBe('AGENTS.md');
    expect(layout.agentsDir).toBe('.codex/agents');
    expect(layout.skillsDir).toBe('.agents/skills');
    expect(layout.rulesDir).toBe('.codex/rules');
  });

  it('falls back to source-repo codex skills when .agents/skills is absent', async () => {
    await writeFile(join(tempDir, 'AGENTS.md'), '# Test\n');
    await mkdir(join(tempDir, '.codex', 'agents'), { recursive: true });
    await mkdir(join(tempDir, '.codex', 'skills'), { recursive: true });
    await mkdir(join(tempDir, '.codex', 'rules'), { recursive: true });

    const layout = await detectServeProjectLayout(tempDir);

    expect(layout.surface).toBe('codex-source');
    expect(layout.skillsDir).toBe('.codex/skills');
  });

  it('supports legacy Claude-root projects as a compatibility fallback', async () => {
    await writeFile(join(tempDir, 'CLAUDE.md'), '# Legacy\n');
    await mkdir(join(tempDir, '.claude', 'agents'), { recursive: true });
    await mkdir(join(tempDir, '.claude', 'skills'), { recursive: true });
    await mkdir(join(tempDir, '.claude', 'rules'), { recursive: true });

    const layout = await detectServeProjectLayout(tempDir);

    expect(layout.surface).toBe('claude-legacy');
    expect(layout.entryFile).toBe('CLAUDE.md');
    expect(layout.agentsDir).toBe('.claude/agents');
    expect(layout.skillsDir).toBe('.claude/skills');
    expect(layout.rulesDir).toBe('.claude/rules');
  });

  it('finds a project root through AGENTS.md discovery', async () => {
    const root = join(tempDir, 'project');
    const nested = join(root, 'packages', 'serve');
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, 'AGENTS.md'), '# Root\n');

    const discovered = await findServeProjectRoot(nested);

    expect(discovered).toBe(root);
  });

  it('finds a legacy project root through CLAUDE.md discovery', async () => {
    const root = join(tempDir, 'legacy-project');
    const nested = join(root, 'src', 'nested');
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, 'CLAUDE.md'), '# Legacy Root\n');

    const discovered = await findServeProjectRoot(nested);

    expect(discovered).toBe(root);
  });
});
