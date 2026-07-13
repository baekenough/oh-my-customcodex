import { constants } from 'node:fs';
import { access, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawn } from 'node:child_process';
import {
	getConfiguredModelLanes,
	NATIVE_REASONING_EFFORTS
} from '../../../../../src/core/agent-compiler.js';

export type GenerationArtifact = 'agent' | 'skill' | 'guide';
export type GenerationMode = 'codex' | 'claude-compat' | 'keyword' | 'keyword-fallback';

export interface GenerationProviderStatus {
	codexAvailable: boolean;
	claudeCompatibilityAvailable: boolean;
	preferredMode: 'codex' | 'claude-compat' | 'keyword';
}

export interface GenerationResult {
	mode: GenerationMode;
	provider: 'codex' | 'claude' | null;
	content: string;
	diagnostics: string[];
}

export interface GenerationOptions {
	env?: NodeJS.ProcessEnv;
	keywordFallback: () => string;
	validateContent?: (content: string) => void;
	timeoutMs?: number;
}

interface ProcessResult {
	stdout: string;
	stderr: string;
}

const MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export async function getGenerationProviderStatus(
	options: { env?: NodeJS.ProcessEnv } = {}
): Promise<GenerationProviderStatus> {
	const env = options.env ?? process.env;
	const [codex, claude] = await Promise.all([
		resolveExecutable('codex', env),
		resolveExecutable('claude', env)
	]);

	return {
		codexAvailable: codex !== null,
		claudeCompatibilityAvailable: claude !== null,
		preferredMode: codex ? 'codex' : claude ? 'claude-compat' : 'keyword'
	};
}

export async function generateArtifact(
	type: GenerationArtifact,
	input: string,
	projectRoot: string,
	options: GenerationOptions
): Promise<GenerationResult> {
	const env = options.env ?? process.env;
	const prompt = buildGenerationPrompt(type, input, env);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const diagnostics: string[] = [];
	let attemptedProvider = false;

	const codex = await resolveExecutable('codex', env);
	if (codex) {
		attemptedProvider = true;
		try {
			const content = await runCodex(codex, prompt, projectRoot, env, timeoutMs);
			options.validateContent?.(content);
			return {
				mode: 'codex',
				provider: 'codex',
				content,
				diagnostics
			};
		} catch (error) {
			diagnostics.push(`Codex CLI failed: ${errorMessage(error)}`);
		}
	} else {
		diagnostics.push('Codex CLI not found');
	}

	const claude = await resolveExecutable('claude', env);
	if (claude) {
		attemptedProvider = true;
		try {
			const content = await runClaudeCompatibility(claude, prompt, projectRoot, env, timeoutMs);
			options.validateContent?.(content);
			return {
				mode: 'claude-compat',
				provider: 'claude',
				content,
				diagnostics
			};
		} catch (error) {
			diagnostics.push(`Claude compatibility CLI failed: ${errorMessage(error)}`);
		}
	} else {
		diagnostics.push('Claude compatibility CLI not found');
	}

	return {
		mode: attemptedProvider ? 'keyword-fallback' : 'keyword',
		provider: null,
		content: options.keywordFallback(),
		diagnostics
	};
}

async function runCodex(
	executable: string,
	prompt: string,
	_projectRoot: string,
	env: NodeJS.ProcessEnv,
	timeoutMs: number
): Promise<string> {
	const outputDirectory = await mkdtemp(join(tmpdir(), 'omcodex-serve-generation-'));
	const outputFile = join(outputDirectory, 'last-message.md');

	try {
		const result = await runProcess(
			executable,
			[
				'exec',
				'--ephemeral',
				'--sandbox',
				'read-only',
				'--skip-git-repo-check',
				'--color',
				'never',
				'--output-last-message',
				outputFile,
				'-'
			],
			{ cwd: outputDirectory, env, stdin: prompt, timeoutMs }
		);
		const content = (await readBoundedOutputFile(outputFile)).trim();
		if (!content) {
			throw new Error(result.stderr.trim() || 'Codex returned an empty response');
		}
		return stripCodeBlock(content);
	} finally {
		await rm(outputDirectory, { recursive: true, force: true });
	}
}

async function readBoundedOutputFile(path: string): Promise<string> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stats = await handle.stat();
		if (!stats.isFile()) throw new Error('Codex output is not a regular file');
		if (stats.size > MAX_OUTPUT_BYTES) {
			throw new Error(`Codex output file exceeded ${MAX_OUTPUT_BYTES} bytes`);
		}

		const chunks: Buffer[] = [];
		let totalBytes = 0;
		while (true) {
			const remainingWithSentinel = MAX_OUTPUT_BYTES - totalBytes + 1;
			const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remainingWithSentinel));
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
			if (bytesRead === 0) break;
			totalBytes += bytesRead;
			if (totalBytes > MAX_OUTPUT_BYTES) {
				throw new Error(`Codex output file exceeded ${MAX_OUTPUT_BYTES} bytes`);
			}
			chunks.push(buffer.subarray(0, bytesRead));
		}
		return Buffer.concat(chunks, totalBytes).toString('utf8');
	} finally {
		await handle.close();
	}
}

async function runClaudeCompatibility(
	executable: string,
	prompt: string,
	_projectRoot: string,
	env: NodeJS.ProcessEnv,
	timeoutMs: number
): Promise<string> {
	const workingDirectory = await mkdtemp(join(tmpdir(), 'omcodex-serve-generation-compat-'));
	try {
		const result = await runProcess(executable, ['-p', prompt, '--no-input'], {
			cwd: workingDirectory,
			env,
			timeoutMs
		});
		const content = result.stdout.trim();
		if (!content) throw new Error(result.stderr.trim() || 'Claude returned an empty response');
		return stripCodeBlock(content);
	} finally {
		await rm(workingDirectory, { recursive: true, force: true });
	}
}

async function runProcess(
	executable: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; stdin?: string; timeoutMs: number }
): Promise<ProcessResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, {
			cwd: options.cwd,
			env: options.env,
			shell: false,
			stdio: ['pipe', 'pipe', 'pipe']
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let settled = false;

		const finish = (callback: () => void): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			callback();
		};

		const failForSize = (): void => {
			child.kill('SIGKILL');
			finish(() => reject(new Error(`CLI output exceeded ${MAX_OUTPUT_BYTES} bytes`)));
		};

		child.stdout.on('data', (chunk: Buffer) => {
			stdoutBytes += chunk.length;
			if (stdoutBytes > MAX_OUTPUT_BYTES) return failForSize();
			stdout.push(chunk);
		});
		child.stderr.on('data', (chunk: Buffer) => {
			stderrBytes += chunk.length;
			if (stderrBytes > MAX_OUTPUT_BYTES) return failForSize();
			stderr.push(chunk);
		});

		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			finish(() => reject(new Error(`CLI timed out after ${options.timeoutMs}ms`)));
		}, options.timeoutMs);

		child.once('error', (error) => finish(() => reject(error)));
		child.once('close', (code, signal) => {
			const result = {
				stdout: Buffer.concat(stdout).toString('utf8'),
				stderr: Buffer.concat(stderr).toString('utf8')
			};
			if (code === 0) return finish(() => resolve(result));
			const detail = result.stderr.trim() || result.stdout.trim() || `signal ${signal ?? 'unknown'}`;
			finish(() => reject(new Error(`exit ${code ?? 'unknown'}: ${detail}`)));
		});

		if (options.stdin !== undefined) child.stdin.end(options.stdin);
		else child.stdin.end();
	});
}

async function resolveExecutable(
	command: 'codex' | 'claude',
	env: NodeJS.ProcessEnv
): Promise<string | null> {
	const path = env.PATH ?? env.Path ?? env.path ?? '';
	for (const directory of path.split(delimiter).filter(Boolean)) {
		const candidate = join(directory, command);
		try {
			await access(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Continue through PATH without invoking a shell or `which`.
		}
	}
	return null;
}

function stripCodeBlock(raw: string): string {
	const fenced = raw.match(/^```[a-z0-9_-]*\n([\s\S]*?)\n```$/i);
	return fenced ? fenced[1].trim() : raw;
}

function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const compact = message.replace(/\s+/g, ' ').trim();
	return compact.length > 500 ? `${compact.slice(0, 497)}...` : compact;
}

function buildGenerationPrompt(
	type: GenerationArtifact,
	input: string,
	env: NodeJS.ProcessEnv
): string {
	if (type === 'agent') return buildAgentPrompt(input, env);
	if (type === 'skill') return buildSkillPrompt(input);
	return buildGuidePrompt(input);
}

function buildAgentPrompt(input: string, env: NodeJS.ProcessEnv): string {
	const lanes = getConfiguredModelLanes(env);
	const models = [...new Set([lanes.frontier, lanes.spark].filter(Boolean))] as string[];
	const modelSchema =
		models.length > 0
			? `model: {${models.join(' | ')}}\n`
			: '# Omit model so Codex inherits the active runtime model.\n';
	const effortSchema = NATIVE_REASONING_EFFORTS.join(' | ');
	return `You are an agent markdown file generator for oh-my-customcodex, a GPT Codex + OMX harness.

Generate a complete managed agent source file for this request:
${input}

Use this YAML frontmatter schema:
---
name: {kebab-case-name}
description: {one-line English description}
${modelSchema}model_reasoning_effort: {${effortSchema}}
domain: {backend | frontend | data-engineering | devops | universal}
tools:
  - Read
  - Grep
  - Glob
---

Then include Role, Capabilities, and Workflow sections. Prefer the frontier model with medium/high
effort for normal or complex work and the spark model with low effort only for simple, fast lookup.
Never emit provider-specific legacy model aliases; use only the inventory above. Output only the markdown file.`;
}

function buildSkillPrompt(input: string): string {
	return `You are a skill SKILL.md file generator for oh-my-customcodex, a GPT Codex + OMX harness.

Generate a complete skill for this request:
${input}

Use YAML frontmatter with name, one-line English description, and scope (core, harness, or package).
Add context: fork only for routing or orchestration skills. Include When to Use, Instructions, and
Checklist sections. Output only the markdown file.`;
}

function buildGuidePrompt(input: string): string {
	return `You are a guide README.md file generator for oh-my-customcodex, a GPT Codex + OMX harness.

Generate a complete guide for this request:
${input}

Guides have no frontmatter. Include Overview, Key Concepts, Best Practices, Examples, and References.
Use practical examples and link official sources when applicable. Output only the markdown file.`;
}
