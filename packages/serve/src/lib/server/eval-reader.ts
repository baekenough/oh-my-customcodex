import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Evaluation {
	id: string;
	sessionId: string;
	turnId?: string;
	score: number; // 1-5
	verdict: string; // pass | fail | needs_refinement
	tags: string[];
	comment: string;
	evaluatedAt: string;
}

export interface SessionSummary {
	sessionId: string;
	startedAt: string;
	agentCount: number;
	evaluationCount: number;
	avgScore: number | null;
}

export interface TaskOutcome {
	agent_type?: string;
	outcome?: string;
	model?: string;
	timestamp?: string;
	session_id?: string;
	session_ppid?: string;
}

export interface EvalReaderDiagnostic {
	code: 'eval_db_read_failed' | 'eval_db_adapter_unavailable';
	severity: 'warning' | 'error';
	message: string;
	source?: string;
}

export interface SessionSummaryResult {
	sessions: SessionSummary[];
	diagnostics: EvalReaderDiagnostic[];
}

export interface EvaluationDashboardData extends SessionSummaryResult {
	evaluations: Evaluation[];
}

interface NodeSqliteStatement {
	all: () => unknown[];
}

interface NodeSqliteDatabase {
	prepare: (sql: string) => NodeSqliteStatement;
	close: () => void;
}

interface NodeSqliteModule {
	DatabaseSync: new (
		path: string,
		options?: { readOnly?: boolean; allowExtension?: boolean }
	) => NodeSqliteDatabase;
}

interface DatabaseReadError {
	path: string;
}

interface DatabaseReadResult {
	outcomes: TaskOutcome[];
	errors: DatabaseReadError[];
}

export interface BunSqliteExecOptions {
	encoding: 'utf8';
	env: NodeJS.ProcessEnv;
	killSignal: 'SIGKILL';
	maxBuffer: number;
	shell: false;
	timeout: number;
	windowsHide: true;
}

export type BunSqliteExecFile = (
	file: string,
	args: string[],
	options: BunSqliteExecOptions,
	callback: (error: Error | null, stdout: string) => void
) => void;

export interface EvalReaderOptions {
	home?: string;
	tmpDir?: string;
	databasePaths?: string[];
	loadNodeSqlite?: () => Promise<NodeSqliteModule>;
	readWithBun?: (databasePaths: string[]) => Promise<DatabaseReadResult>;
	execFileImpl?: BunSqliteExecFile;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getHome(options: EvalReaderOptions): string {
	return options.home ?? process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

function getEvaluationDirectories(options: EvalReaderOptions): string[] {
	const home = getHome(options);
	return [
		join(home, '.oh-my-customcodex', 'evaluations'),
		join(home, '.omcustom', 'evaluations')
	];
}

function getEvalCoreDatabasePaths(options: EvalReaderOptions): string[] {
	if (options.databasePaths) return options.databasePaths;

	const home = getHome(options);
	return [
		join(home, '.oh-my-customcodex', 'eval-core.sqlite'),
		join(home, '.omcustom', 'eval.db'),
		join(home, '.config', 'oh-my-customcode', 'eval-core.sqlite')
	];
}

function getDisplayPath(path: string, options: EvalReaderOptions): string {
	const home = getHome(options);
	return path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

// ---------------------------------------------------------------------------
// Evaluations — canonical writes, compatibility reads
// ---------------------------------------------------------------------------

async function readEvaluationDirectory(directory: string): Promise<Evaluation[]> {
	let files: string[];
	try {
		files = await readdir(directory);
	} catch {
		return [];
	}

	const evaluations: Evaluation[] = [];
	for (const file of files) {
		if (!file.endsWith('.json')) continue;
		try {
			const content = await readFile(join(directory, file), 'utf-8');
			const parsed = JSON.parse(content) as Evaluation;
			if (parsed && typeof parsed.id === 'string') evaluations.push(parsed);
		} catch {
			// Skip malformed compatibility files without hiding the remaining history.
		}
	}

	return evaluations;
}

export async function getEvaluations(options: EvalReaderOptions = {}): Promise<Evaluation[]> {
	const directories = getEvaluationDirectories(options);
	const batches = await Promise.all(directories.map(readEvaluationDirectory));
	const seen = new Set<string>();
	const evaluations: Evaluation[] = [];

	// Canonical data is first and therefore wins if a legacy copy has the same id.
	for (const evaluation of batches.flat()) {
		if (seen.has(evaluation.id)) continue;
		seen.add(evaluation.id);
		evaluations.push(evaluation);
	}

	return evaluations.sort(
		(a, b) => new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime()
	);
}

export async function getEvaluation(
	id: string,
	options: EvalReaderOptions = {}
): Promise<Evaluation | null> {
	const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '');
	for (const directory of getEvaluationDirectories(options)) {
		try {
			const content = await readFile(join(directory, `${safeId}.json`), 'utf-8');
			return JSON.parse(content) as Evaluation;
		} catch {
			// Try the next read-only compatibility directory.
		}
	}
	return null;
}

export async function saveEvaluation(
	data: Omit<Evaluation, 'id'>,
	options: EvalReaderOptions = {}
): Promise<Evaluation> {
	const canonicalDirectory = getEvaluationDirectories(options)[0];
	await mkdir(canonicalDirectory, { recursive: true });

	const id = randomUUID();
	const evaluation: Evaluation = { id, ...data };
	await writeFile(
		join(canonicalDirectory, `${id}.json`),
		JSON.stringify(evaluation, null, 2),
		'utf-8'
	);
	return evaluation;
}

// ---------------------------------------------------------------------------
// Session outcomes — live JSONL plus persistent eval-core SQLite
// ---------------------------------------------------------------------------

function optionalString(value: unknown): string | undefined {
	if (typeof value === 'string') return value.length > 0 ? value : undefined;
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	return undefined;
}

function normalizeTaskOutcome(value: unknown): TaskOutcome | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const outcome: TaskOutcome = {
		agent_type: optionalString(record.agent_type),
		outcome: optionalString(record.outcome),
		model: optionalString(record.model),
		timestamp: optionalString(record.timestamp),
		session_id: optionalString(record.session_id),
		session_ppid: optionalString(record.session_ppid)
	};

	return Object.values(outcome).some(Boolean) ? outcome : null;
}

function readTaskOutcomesSync(options: EvalReaderOptions): TaskOutcome[] {
	const outcomes: TaskOutcome[] = [];
	const tmpDir = options.tmpDir ?? '/tmp';
	let tmpFiles: string[];
	try {
		tmpFiles = readdirSync(tmpDir);
	} catch {
		return outcomes;
	}

	const prefixes = ['.codex-task-outcomes-', '.claude-task-outcomes-'];
	for (const file of tmpFiles) {
		const prefix = prefixes.find((candidate) => file.startsWith(candidate));
		if (!prefix) continue;
		const filenamePpid = file.slice(prefix.length);

		try {
			const content = readFileSync(join(tmpDir, file), 'utf-8');
			for (const line of content.split('\n')) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					const outcome = normalizeTaskOutcome(JSON.parse(trimmed));
					if (!outcome) continue;
					outcome.session_ppid ??= filenamePpid || undefined;
					outcomes.push(outcome);
				} catch {
					// Skip malformed live records while preserving valid records in the file.
				}
			}
		} catch {
			// Skip an unreadable live-session file.
		}
	}

	return outcomes;
}

const SESSION_QUERY = `
	SELECT agent_type, outcome, model, timestamp, session_id, session_ppid
	FROM agent_invocations
	ORDER BY timestamp DESC
	LIMIT 1000
`;

let nodeSqliteCapability: Promise<NodeSqliteModule> | undefined;

function defaultNodeSqliteLoader(): Promise<NodeSqliteModule> {
	// Keep this as a runtime capability probe: Node 20 and installations started
	// with --no-experimental-sqlite do not expose the module.
	nodeSqliteCapability ??= (async () => {
		const specifier = 'node:sqlite';
		const module = await import(/* @vite-ignore */ specifier);
		return module as unknown as NodeSqliteModule;
	})();
	return nodeSqliteCapability;
}

function readWithNodeSqlite(
	databasePaths: string[],
	nodeSqlite: NodeSqliteModule
): DatabaseReadResult {
	const outcomes: TaskOutcome[] = [];
	const errors: DatabaseReadError[] = [];

	for (const path of databasePaths) {
		let database: NodeSqliteDatabase | undefined;
		try {
			database = new nodeSqlite.DatabaseSync(path, {
				readOnly: true,
				allowExtension: false
			});
			const rows = database.prepare(SESSION_QUERY).all();
			for (const row of rows) {
				const outcome = normalizeTaskOutcome(row);
				if (outcome) outcomes.push(outcome);
			}
		} catch {
			errors.push({ path });
		} finally {
			try {
				database?.close();
			} catch {
				// A failed close must not discard rows already read from other databases.
			}
		}
	}

	return { outcomes, errors };
}

const BUN_SQLITE_READER_SCRIPT = String.raw`
import { Database } from 'bun:sqlite';

const paths = process.argv.slice(1);
const query = ${JSON.stringify(SESSION_QUERY)};
const outcomes = [];
const errors = [];

for (const path of paths) {
	let database;
	try {
		database = new Database(path, { readonly: true });
		outcomes.push(...database.query(query).all());
	} catch {
		errors.push({ path });
	} finally {
		try { database?.close(); } catch {}
	}
}

process.stdout.write(JSON.stringify({ outcomes, errors }));
`;

function defaultBunSqliteReader(
	databasePaths: string[],
	execFileImpl: BunSqliteExecFile = execFile as unknown as BunSqliteExecFile
): Promise<DatabaseReadResult> {
	return new Promise((resolve, reject) => {
		const env: NodeJS.ProcessEnv = {};
		for (const name of [
			'PATH',
			'SystemRoot',
			'SYSTEMROOT',
			'PATHEXT',
			'TEMP',
			'TMP',
			'TMPDIR',
			'HOME',
			'USERPROFILE'
		]) {
			if (process.env[name] !== undefined) env[name] = process.env[name];
		}

		const bunExecutable = process.versions.bun ? process.execPath : 'bun';
		execFileImpl(
			bunExecutable,
			['-e', BUN_SQLITE_READER_SCRIPT, ...databasePaths],
			{
				encoding: 'utf8',
				env,
				killSignal: 'SIGKILL',
				maxBuffer: 4 * 1024 * 1024,
				shell: false,
				timeout: 5_000,
				windowsHide: true
			},
			(error, stdout) => {
				if (error) {
					reject(new Error('Bun SQLite compatibility reader failed'));
					return;
				}

				try {
					const parsed = JSON.parse(stdout) as {
						outcomes?: unknown[];
						errors?: Array<{ path?: unknown }>;
					};
					if (!Array.isArray(parsed.outcomes) || !Array.isArray(parsed.errors)) {
						throw new Error('Invalid Bun SQLite result shape');
					}
					const normalizedOutcomes = parsed.outcomes.map(normalizeTaskOutcome);
					if (normalizedOutcomes.some((outcome) => outcome === null)) {
						throw new Error('Invalid Bun SQLite result row');
					}
					const outcomes = normalizedOutcomes.filter(
						(outcome): outcome is TaskOutcome => outcome !== null
					);
					const errors = parsed.errors
						.map((databaseError) => optionalString(databaseError.path))
						.filter(
							(path): path is string => Boolean(path) && databasePaths.includes(path as string)
						)
						.map((path) => ({ path }));
					resolve({ outcomes, errors });
				} catch {
					reject(new Error('Bun SQLite compatibility reader returned invalid output'));
				}
			}
		);
	});
}

async function existingDatabasePaths(paths: string[]): Promise<string[]> {
	const entries = await Promise.all(
		paths.map(async (path) => {
			try {
				return (await stat(path)).isFile() ? path : null;
			} catch {
				return null;
			}
		})
	);
	return entries.filter((path): path is string => path !== null);
}

async function readEvalCoreSessions(options: EvalReaderOptions): Promise<{
	outcomes: TaskOutcome[];
	diagnostics: EvalReaderDiagnostic[];
}> {
	const databasePaths = await existingDatabasePaths(getEvalCoreDatabasePaths(options));
	if (databasePaths.length === 0) return { outcomes: [], diagnostics: [] };

	let result: DatabaseReadResult;
	try {
		const nodeSqlite = await (options.loadNodeSqlite ?? defaultNodeSqliteLoader)();
		if (typeof nodeSqlite.DatabaseSync !== 'function') throw new Error('DatabaseSync unavailable');
		result = readWithNodeSqlite(databasePaths, nodeSqlite);
	} catch {
		try {
			result = await (
				options.readWithBun ??
				((paths) => defaultBunSqliteReader(paths, options.execFileImpl))
			)(databasePaths);
		} catch {
			return {
				outcomes: [],
				diagnostics: [
					{
						code: 'eval_db_adapter_unavailable',
						severity: 'error',
						message:
							'Persistent evaluation history is unavailable. Use Node 22.13+ with node:sqlite enabled, or install Bun for the compatibility reader.'
					}
				]
			};
		}
	}

	return {
		outcomes: result.outcomes,
		diagnostics: result.errors.map(({ path }) => ({
			code: 'eval_db_read_failed',
			severity: 'warning',
			message: `Could not read evaluation history from ${getDisplayPath(path, options)}.`,
			source: getDisplayPath(path, options)
		}))
	};
}

function getSessionIdentity(outcome: TaskOutcome): string {
	return outcome.session_id || outcome.session_ppid || 'unknown';
}

function getOutcomeKey(outcome: TaskOutcome): string {
	return JSON.stringify([
		getSessionIdentity(outcome),
		outcome.timestamp ?? '',
		outcome.agent_type ?? '',
		outcome.model ?? '',
		outcome.outcome ?? ''
	]);
}

function buildSessionSummaries(
	outcomes: TaskOutcome[],
	evaluations: Evaluation[]
): SessionSummary[] {
	const seen = new Set<string>();
	const deduplicated = outcomes.filter((outcome) => {
		const key = getOutcomeKey(outcome);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	const sessionMap = new Map<string, TaskOutcome[]>();
	for (const outcome of deduplicated) {
		const sessionId = getSessionIdentity(outcome);
		const sessionOutcomes = sessionMap.get(sessionId) ?? [];
		sessionOutcomes.push(outcome);
		sessionMap.set(sessionId, sessionOutcomes);
	}

	const evaluationsBySession = new Map<string, Evaluation[]>();
	for (const evaluation of evaluations) {
		const sessionEvaluations = evaluationsBySession.get(evaluation.sessionId) ?? [];
		sessionEvaluations.push(evaluation);
		evaluationsBySession.set(evaluation.sessionId, sessionEvaluations);
		if (!sessionMap.has(evaluation.sessionId)) sessionMap.set(evaluation.sessionId, []);
	}

	const summaries: SessionSummary[] = [];
	for (const [sessionId, sessionOutcomes] of sessionMap) {
		const timestamps = sessionOutcomes
			.map((outcome) => outcome.timestamp)
			.filter((timestamp): timestamp is string => Boolean(timestamp))
			.sort();
		const sessionEvaluations = evaluationsBySession.get(sessionId) ?? [];
		const scores = sessionEvaluations
			.map((evaluation) => evaluation.score)
			.filter((score) => score >= 1 && score <= 5);

		summaries.push({
			sessionId,
			startedAt: timestamps[0] ?? new Date().toISOString(),
			agentCount: sessionOutcomes.length,
			evaluationCount: sessionEvaluations.length,
			avgScore:
				scores.length > 0 ? scores.reduce((total, score) => total + score, 0) / scores.length : null
		});
	}

	return summaries
		.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
		.slice(0, 20);
}

export async function getEvaluationDashboardData(
	options: EvalReaderOptions = {}
): Promise<EvaluationDashboardData> {
	const liveOutcomes = readTaskOutcomesSync(options);
	const [evaluations, persistent] = await Promise.all([
		getEvaluations(options),
		readEvalCoreSessions(options)
	]);

	return {
		evaluations,
		sessions: buildSessionSummaries([...liveOutcomes, ...persistent.outcomes], evaluations),
		diagnostics: persistent.diagnostics
	};
}

export async function getSessionSummariesWithDiagnostics(
	options: EvalReaderOptions = {}
): Promise<SessionSummaryResult> {
	const { sessions, diagnostics } = await getEvaluationDashboardData(options);
	return { sessions, diagnostics };
}

export async function getSessionSummaries(
	options: EvalReaderOptions = {}
): Promise<SessionSummary[]> {
	return (await getSessionSummariesWithDiagnostics(options)).sessions;
}
