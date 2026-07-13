import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentFileConflictError,
  countServeAgents,
  getServeAgent,
  getServeAgents,
  saveAgentMarkdown,
} from '../../../packages/serve/src/lib/server/agent-files.js';
import { parseNativeAgentListMetadata } from '../../../src/core/agent-compiler.js';

function agentMarkdown(name = 'web-native-agent'): string {
  return [
    '---',
    `name: ${name}`,
    'description: Native Web agent',
    'model: sonnet',
    'domain: backend',
    'tools:',
    '  - Read',
    '  - Write',
    'skills:',
    '  - openai-docs',
    '---',
    '',
    '# Native instructions',
    '',
    'Verify every change.',
  ].join('\n');
}

describe('serve agent files', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-serve-agent-files-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function makeCodexProject(): Promise<string> {
    await writeFile(join(tempDir, 'AGENTS.md'), '# Codex project\n');
    const agentsDir = join(tempDir, '.codex', 'agents');
    await mkdir(agentsDir, { recursive: true });
    await mkdir(join(tempDir, '.agents', 'skills'), { recursive: true });
    return agentsDir;
  }

  it('creates, lists, reads, and counts native TOML agents on Codex surfaces', async () => {
    const agentsDir = await makeCodexProject();

    const saved = await saveAgentMarkdown(tempDir, 'web-native-agent', agentMarkdown());

    expect(saved.relativePath).toBe('.codex/agents/web-native-agent.toml');
    const toml = await readFile(join(agentsDir, 'web-native-agent.toml'), 'utf8');
    expect(parseNativeAgentListMetadata(toml)).toEqual({
      name: 'web-native-agent',
      description: 'Native Web agent',
    });
    expect(await readdir(agentsDir)).not.toContain('web-native-agent.md');

    const agents = await getServeAgents(tempDir);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: 'web-native-agent',
      description: 'Native Web agent',
      domain: '',
      skills: ['openai-docs'],
    });
    expect(agents[0].model).not.toBe('sonnet');
    expect(agents[0].body).toContain('# Native instructions');
    expect(await getServeAgent(tempDir, 'web-native-agent')).toEqual(agents[0]);
    expect(await countServeAgents(tempDir)).toBe(1);
  });

  it('does not write when compiler validation rejects submitted Markdown', async () => {
    const agentsDir = await makeCodexProject();
    const invalid = '---\nname: invalid-agent\nmodel: sonnet\n---\n\nMissing description';

    await expect(saveAgentMarkdown(tempDir, 'invalid-agent', invalid)).rejects.toThrow(
      'description'
    );

    expect(await readdir(agentsDir)).toEqual([]);
  });

  it('reports an existing native TOML conflict without changing its bytes', async () => {
    const agentsDir = await makeCodexProject();
    const existingPath = join(agentsDir, 'web-native-agent.toml');
    const sentinel =
      'name = "web-native-agent"\ndescription = "custom"\ndeveloper_instructions = "custom"\n';
    await writeFile(existingPath, sentinel);

    await expect(
      saveAgentMarkdown(tempDir, 'web-native-agent', agentMarkdown())
    ).rejects.toBeInstanceOf(AgentFileConflictError);

    expect(await readFile(existingPath, 'utf8')).toBe(sentinel);
  });

  it('does not read a native TOML agent through an external file symlink', async () => {
    const agentsDir = await makeCodexProject();
    const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-serve-agent-outside-'));
    try {
      const outsideAgent = join(outsideDir, 'outside-agent.toml');
      await writeFile(
        outsideAgent,
        'name = "outside-agent"\ndescription = "outside secret"\ndeveloper_instructions = "TOP_SECRET_OUTSIDE_CONTENT"\n'
      );
      await symlink(outsideAgent, join(agentsDir, 'outside-agent.toml'));

      expect(await getServeAgents(tempDir)).toEqual([]);
      expect(await getServeAgent(tempDir, 'outside-agent')).toBeNull();
      expect(await countServeAgents(tempDir)).toBe(0);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('does not read native agents through an external agents-directory symlink', async () => {
    await writeFile(join(tempDir, 'AGENTS.md'), '# Codex project\n');
    await mkdir(join(tempDir, '.codex'), { recursive: true });
    const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-serve-agents-outside-'));
    try {
      await writeFile(
        join(outsideDir, 'outside-agent.toml'),
        'name = "outside-agent"\ndescription = "outside secret"\ndeveloper_instructions = "TOP_SECRET_OUTSIDE_CONTENT"\n'
      );
      await symlink(outsideDir, join(tempDir, '.codex', 'agents'), 'dir');

      expect(await getServeAgents(tempDir)).toEqual([]);
      expect(await getServeAgent(tempDir, 'outside-agent')).toBeNull();
      expect(await countServeAgents(tempDir)).toBe(0);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('lists and reads real OMX-style multiline roles with custom skill paths', async () => {
    const agentsDir = await makeCodexProject();
    const executorToml = [
      '# oh-my-codex agent: executor',
      'name = "executor"',
      'description = "Code implementation, refactoring, feature work"',
      'model = "gpt-5.6-sol"',
      'model_reasoning_effort = "medium"',
      'developer_instructions = """',
      '<identity>',
      'You are Executor. Convert a scoped task into a working, verified outcome.',
      '</identity>',
      '',
      'Keep going until the task is fully resolved.\\',
      '  Verify with fresh evidence.',
      '"""',
      '',
      '[[skills.config]]',
      'path = "../../../custom-skills/release-review/SKILL.md"',
      'enabled = true',
      '',
    ].join('\n');
    const literalToml = [
      "name = 'literal-reviewer'",
      "description = 'Literal multiline role'",
      "developer_instructions = '''",
      "Preserve 'literal' text exactly.",
      'Do not interpret \\n as an escape.',
      "'''",
      '',
    ].join('\n');
    await writeFile(join(agentsDir, 'executor.toml'), executorToml);
    await writeFile(join(agentsDir, 'literal-reviewer.toml'), literalToml);

    const agents = await getServeAgents(tempDir);
    expect(agents.map((agent) => agent.name)).toEqual(['executor', 'literal-reviewer']);
    expect(agents.find((agent) => agent.name === 'executor')).toMatchObject({
      model: 'gpt-5.6-sol',
      skills: ['release-review'],
      body: '<identity>\nYou are Executor. Convert a scoped task into a working, verified outcome.\n</identity>\n\nKeep going until the task is fully resolved.Verify with fresh evidence.\n',
    });
    expect(await getServeAgent(tempDir, 'literal-reviewer')).toMatchObject({
      body: "Preserve 'literal' text exactly.\nDo not interpret \\n as an escape.\n",
    });
    expect(await countServeAgents(tempDir)).toBe(2);
  });

  it('keeps Markdown create/read/list behavior only for claude-legacy layouts', async () => {
    await writeFile(join(tempDir, 'CLAUDE.md'), '# Legacy project\n');
    const agentsDir = join(tempDir, '.claude', 'agents');
    await mkdir(agentsDir, { recursive: true });

    const saved = await saveAgentMarkdown(tempDir, 'web-native-agent', agentMarkdown());

    expect(saved.relativePath).toBe('.claude/agents/web-native-agent.md');
    expect(await readFile(join(agentsDir, 'web-native-agent.md'), 'utf8')).toBe(
      `${agentMarkdown()}\n`
    );
    expect(await readdir(agentsDir)).not.toContain('web-native-agent.toml');

    const agents = await getServeAgents(tempDir);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: 'web-native-agent',
      description: 'Native Web agent',
      model: 'sonnet',
      domain: 'backend',
      skills: ['openai-docs'],
    });
    expect(await getServeAgent(tempDir, 'web-native-agent')).toEqual(agents[0]);
    expect(await countServeAgents(tempDir)).toBe(1);
  });

  it('does not read a legacy Markdown agent through an external file symlink', async () => {
    await writeFile(join(tempDir, 'CLAUDE.md'), '# Legacy project\n');
    const agentsDir = join(tempDir, '.claude', 'agents');
    await mkdir(agentsDir, { recursive: true });
    const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-serve-legacy-outside-'));
    try {
      const outsideAgent = join(outsideDir, 'outside-agent.md');
      await writeFile(
        outsideAgent,
        '---\nname: outside-agent\ndescription: outside secret\n---\n\nTOP_SECRET_OUTSIDE_CONTENT\n'
      );
      await symlink(outsideAgent, join(agentsDir, 'outside-agent.md'));

      expect(await getServeAgents(tempDir)).toEqual([]);
      expect(await getServeAgent(tempDir, 'outside-agent')).toBeNull();
      expect(await countServeAgents(tempDir)).toBe(0);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});
