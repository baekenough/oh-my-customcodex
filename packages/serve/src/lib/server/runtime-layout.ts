import { access } from 'fs/promises';
import { dirname, join } from 'path';

export type ServeProjectSurface = 'codex-installed' | 'codex-source' | 'claude-legacy';

export interface ServeProjectLayout {
	surface: ServeProjectSurface;
	entryFile: 'AGENTS.md' | 'CLAUDE.md';
	agentsDir: string;
	skillsDir: string;
	rulesDir: string;
	memoryDir: string;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function detectServeProjectLayout(root: string): Promise<ServeProjectLayout> {
	const [
		hasAgentsMd,
		hasClaudeMd,
		hasCodexAgents,
		hasCodexRules,
		hasCodexMemory,
		hasInstalledSkills,
		hasSourceSkills,
		hasClaudeAgents,
		hasClaudeSkills,
		hasClaudeRules,
		hasClaudeMemory,
	] = await Promise.all([
		pathExists(join(root, 'AGENTS.md')),
		pathExists(join(root, 'CLAUDE.md')),
		pathExists(join(root, '.codex', 'agents')),
		pathExists(join(root, '.codex', 'rules')),
		pathExists(join(root, '.codex', 'agent-memory')),
		pathExists(join(root, '.agents', 'skills')),
		pathExists(join(root, '.codex', 'skills')),
		pathExists(join(root, '.claude', 'agents')),
		pathExists(join(root, '.claude', 'skills')),
		pathExists(join(root, '.claude', 'rules')),
		pathExists(join(root, '.claude', 'agent-memory')),
	]);

	if (
		hasAgentsMd ||
		hasCodexAgents ||
		hasInstalledSkills ||
		hasSourceSkills ||
		hasCodexRules ||
		hasCodexMemory
	) {
		return {
			surface: hasInstalledSkills ? 'codex-installed' : 'codex-source',
			entryFile: 'AGENTS.md',
			agentsDir: '.codex/agents',
			skillsDir: hasInstalledSkills ? '.agents/skills' : '.codex/skills',
			rulesDir: '.codex/rules',
			memoryDir: '.codex/agent-memory',
		};
	}

	if (hasClaudeMd || hasClaudeAgents || hasClaudeSkills || hasClaudeRules || hasClaudeMemory) {
		return {
			surface: 'claude-legacy',
			entryFile: 'CLAUDE.md',
			agentsDir: '.claude/agents',
			skillsDir: '.claude/skills',
			rulesDir: '.claude/rules',
			memoryDir: '.claude/agent-memory',
		};
	}

	return {
		surface: 'codex-installed',
		entryFile: 'AGENTS.md',
		agentsDir: '.codex/agents',
		skillsDir: '.agents/skills',
		rulesDir: '.codex/rules',
		memoryDir: '.codex/agent-memory',
	};
}

export async function findServeProjectRoot(startDir: string): Promise<string> {
	let dir = startDir;

	for (let i = 0; i < 20; i++) {
		const [hasAgentsMd, hasClaudeMd] = await Promise.all([
			pathExists(join(dir, 'AGENTS.md')),
			pathExists(join(dir, 'CLAUDE.md')),
		]);

		if (hasAgentsMd || hasClaudeMd) {
			return dir;
		}

		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return startDir;
}
