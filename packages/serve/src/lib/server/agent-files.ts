import { constants, type Dirent } from 'node:fs';
import { open, readdir, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
	compileMarkdownAgent,
	parseNativeAgentDetailMetadata
} from '../../../../../src/core/agent-compiler.js';
import { writeTextFileExclusive } from '../../../../../src/utils/fs.js';
import { parseFrontmatter } from './frontmatter.js';
import { detectServeProjectLayout, type ServeProjectLayout } from './runtime-layout.js';

const WEB_AGENT_NAME_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;

export interface ServeAgentInfo {
	name: string;
	description: string;
	model: string;
	domain: string;
	tools: string[];
	skills: string[];
	frontmatter: Record<string, unknown>;
	body: string;
}

export interface SavedServeAgent {
	name: string;
	relativePath: string;
}

export class AgentFileConflictError extends Error {
	constructor(name: string) {
		super(`Agent "${name}" already exists. Choose a different name.`);
		this.name = 'AgentFileConflictError';
	}
}

function arrayField(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String);
	if (typeof value === 'string') return [value];
	return [];
}

function isLegacyLayout(layout: ServeProjectLayout): boolean {
	return layout.surface === 'claude-legacy';
}

function isWithinRoot(root: string, candidate: string): boolean {
	const pathFromRoot = relative(root, candidate);
	return (
		pathFromRoot === '' ||
		(pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
	);
}

async function resolveConfinedAgentsDir(
	root: string,
	dir: string
): Promise<{ boundary: string; dir: string } | null> {
	try {
		const [boundary, resolvedDir] = await Promise.all([realpath(root), realpath(dir)]);
		return isWithinRoot(boundary, resolvedDir) ? { boundary, dir: resolvedDir } : null;
	} catch {
		return null;
	}
}

async function readConfinedRegularFile(
	boundary: string,
	dir: string,
	entry: Dirent
): Promise<string | null> {
	if (!entry.isFile()) return null;

	try {
		const resolvedFile = await realpath(join(dir, entry.name));
		if (!isWithinRoot(boundary, resolvedFile)) return null;

		const handle = await open(resolvedFile, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const stats = await handle.stat();
			return stats.isFile() ? await handle.readFile('utf8') : null;
		} finally {
			await handle.close();
		}
	} catch {
		return null;
	}
}

function assertWebAgentName(name: string): void {
	if (!WEB_AGENT_NAME_PATTERN.test(name)) {
		throw new Error(`Invalid agent name: "${name}". Use kebab-case (e.g., my-agent-expert)`);
	}
}

async function assertNoCaseFoldedConflict(dir: string, filename: string, name: string): Promise<void> {
	try {
		const entries = await readdir(dir);
		if (entries.some((entry) => entry.toLowerCase() === filename.toLowerCase())) {
			throw new AgentFileConflictError(name);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
}

function nativeAgentInfo(content: string): ServeAgentInfo {
	const metadata = parseNativeAgentDetailMetadata(content);
	const frontmatter: Record<string, unknown> = {
		name: metadata.name,
		description: metadata.description
	};
	if (metadata.model) frontmatter.model = metadata.model;
	if (metadata.modelReasoningEffort) {
		frontmatter.model_reasoning_effort = metadata.modelReasoningEffort;
	}
	if (metadata.sandboxMode) frontmatter.sandbox_mode = metadata.sandboxMode;
	if (metadata.skills.length > 0) frontmatter.skills = metadata.skills;

	return {
		name: metadata.name,
		description: metadata.description,
		model: metadata.model ?? 'default',
		domain: '',
		tools: [],
		skills: metadata.skills,
		frontmatter,
		body: metadata.developerInstructions
	};
}

function legacyAgentInfo(name: string, content: string): ServeAgentInfo {
	const { frontmatter, body } = parseFrontmatter(content);
	return {
		name,
		description: String(frontmatter.description ?? ''),
		model: String(frontmatter.model ?? 'sonnet'),
		domain: String(frontmatter.domain ?? ''),
		tools: arrayField(frontmatter.tools),
		skills: arrayField(frontmatter.skills),
		frontmatter,
		body
	};
}

export async function saveAgentMarkdown(
	root: string,
	name: string,
	markdown: string
): Promise<SavedServeAgent> {
	assertWebAgentName(name);
	const layout = await detectServeProjectLayout(root);
	const legacy = isLegacyLayout(layout);
	const compiled = legacy ? null : compileMarkdownAgent(markdown, { sourceFilename: `${name}.md` });
	const filename = compiled?.filename ?? `${name}.md`;
	const content = compiled?.toml ?? `${markdown.trimEnd()}\n`;

	const destinationDir = resolve(root, layout.agentsDir);
	const destination = join(destinationDir, filename);
	await assertNoCaseFoldedConflict(destinationDir, filename, name);

	try {
		await writeTextFileExclusive(destination, content, { trustedWriteRoot: root });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			throw new AgentFileConflictError(name);
		}
		throw error;
	}

	return {
		name,
		relativePath: relative(root, destination).replaceAll('\\', '/')
	};
}

export async function getServeAgents(root: string): Promise<ServeAgentInfo[]> {
	const layout = await detectServeProjectLayout(root);
	const legacy = isLegacyLayout(layout);
	const confined = await resolveConfinedAgentsDir(root, join(root, layout.agentsDir));
	if (!confined) return [];

	let entries: Dirent[];
	try {
		entries = await readdir(confined.dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const extension = legacy ? '.md' : '.toml';
	const agents: ServeAgentInfo[] = [];
	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		if (!entry.name.endsWith(extension)) continue;
		try {
			const content = await readConfinedRegularFile(confined.boundary, confined.dir, entry);
			if (content === null) continue;
			agents.push(
				legacy ? legacyAgentInfo(basename(entry.name, extension), content) : nativeAgentInfo(content)
			);
		} catch {
			// Invalid or unreadable role files are not discoverable native agents.
		}
	}
	return agents.sort((left, right) => left.name.localeCompare(right.name));
}

export async function getServeAgent(root: string, name: string): Promise<ServeAgentInfo | null> {
	return (await getServeAgents(root)).find((agent) => agent.name === name) ?? null;
}

export async function countServeAgents(root: string): Promise<number> {
	return (await getServeAgents(root)).length;
}
