import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Database } from 'bun:sqlite';
import { eq } from 'drizzle-orm';
import { createDb, type EvalDb } from '../db/client.js';
import { agentInvocations, projects, sessions, turns } from '../db/schema.js';
import type { RawOutcomeRecord, RawSessionRecord } from '../types/session.js';
import { type OutcomeParseDiagnostic, parseOutcomeFileWithDiagnostics } from './outcome-parser.js';
import { parseSessionHistory } from './session-parser.js';
import { estimateTokens } from './token-estimator.js';
import { parseTurnFiles } from './turn-parser.js';

export interface CollectOptions {
  dbPath: string;
  omxLogsDir: string;
  since?: string;
  ppid?: string;
  dryRun?: boolean;
}

export interface CollectResult {
  sessions: number;
  turns: number;
  invocations: number;
  /** Additive diagnostics; optional for source compatibility with existing consumers. */
  diagnostics?: OutcomeParseDiagnostic[];
}

export async function collect(options: CollectOptions): Promise<CollectResult> {
  if (options.dryRun) {
    return collectDryRun(options);
  }

  const db = createDb(options.dbPath);
  let sessionCount = 0;
  let turnCount = 0;
  let invocationCount = 0;
  let diagnostics: OutcomeParseDiagnostic[] = [];

  sessionCount = collectSessions(db, options);
  turnCount = collectTurns(db, options);
  if (options.ppid) {
    const invocations = collectInvocations(db, options.ppid, options.dryRun);
    invocationCount = invocations.count;
    diagnostics = invocations.diagnostics;
  }

  return { sessions: sessionCount, turns: turnCount, invocations: invocationCount, diagnostics };
}

function collectDryRun(options: CollectOptions): CollectResult {
  const existing = readExistingCollection(options.dbPath);
  const rawSessions = parseSessionHistory(`${options.omxLogsDir}/session-history.jsonl`).filter(
    (raw) => !options.since || raw.started_at >= options.since
  );
  const newSessions = rawSessions.filter((raw) => !existing.sessionIds.has(raw.session_id));
  const sessionWindows = [...existing.sessions, ...rawSessions.map(rawSessionToWindow)];

  const sinceDate = options.since?.split('T')[0];
  const rawTurns = parseTurnFiles(options.omxLogsDir, sinceDate);
  const turnCount = rawTurns.filter((raw) => {
    if (existing.turnIds.has(raw.turn_id)) return false;
    const turnTime = new Date(raw.timestamp).getTime();
    return sessionWindows.some((session) => {
      const sessionStart = new Date(session.startedAt).getTime();
      const sessionEnd = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
      return turnTime >= sessionStart && turnTime <= sessionEnd;
    });
  }).length;

  let invocationCount = 0;
  let diagnostics: OutcomeParseDiagnostic[] = [];
  if (options.ppid) {
    const parsed = parseOutcomeFileWithDiagnostics(options.ppid);
    invocationCount = parsed.records.length;
    diagnostics = parsed.diagnostics;
  }

  return { sessions: newSessions.length, turns: turnCount, invocations: invocationCount, diagnostics };
}

interface ExistingCollection {
  sessionIds: Set<string>;
  turnIds: Set<string>;
  sessions: Array<{ sessionId: string; startedAt: string; endedAt: string | null }>;
}

function readExistingCollection(dbPath: string): ExistingCollection {
  if (!existsSync(dbPath)) {
    return { sessionIds: new Set(), turnIds: new Set(), sessions: [] };
  }

  const snapshot = snapshotSqliteFiles(dbPath);
  try {
    return readExistingCollectionWithSqliteCli(dbPath) ?? readExistingCollectionWithBun(dbPath);
  } finally {
    restoreSqliteFiles(snapshot);
  }
}

function snapshotSqliteFiles(dbPath: string): Map<string, Buffer | null> {
  return new Map(
    [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].map((path) => [
      path,
      existsSync(path) ? readFileSync(path) : null,
    ])
  );
}

function restoreSqliteFiles(snapshot: Map<string, Buffer | null>): void {
  for (const [path, content] of snapshot) {
    if (content) {
      writeFileSync(path, content);
    } else {
      rmSync(path, { force: true });
    }
  }
}

function readExistingCollectionWithSqliteCli(dbPath: string): ExistingCollection | null {
  try {
    const sessionRows = readJsonRows<{
      session_id: string;
      started_at: string;
      ended_at: string | null;
    }>(dbPath, 'SELECT session_id, started_at, ended_at FROM sessions');
    const turnRows = readJsonRows<{ turn_id: string }>(dbPath, 'SELECT turn_id FROM turns');
    return existingCollectionFromRows(sessionRows, turnRows);
  } catch {
    return null;
  }
}

function readJsonRows<T>(dbPath: string, sql: string): T[] {
  const stdout = execFileSync('sqlite3', ['-readonly', '-json', dbPath, sql], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  return stdout ? (JSON.parse(stdout) as T[]) : [];
}

function readExistingCollectionWithBun(dbPath: string): ExistingCollection {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    const sessionRows = sqlite
      .query<{ session_id: string; started_at: string; ended_at: string | null }, []>(
        'SELECT session_id, started_at, ended_at FROM sessions'
      )
      .all();
    const turnRows = sqlite.query<{ turn_id: string }, []>('SELECT turn_id FROM turns').all();
    return existingCollectionFromRows(sessionRows, turnRows);
  } finally {
    sqlite.close();
  }
}

function existingCollectionFromRows(
  sessionRows: Array<{ session_id: string; started_at: string; ended_at: string | null }>,
  turnRows: Array<{ turn_id: string }>
): ExistingCollection {
  return {
    sessionIds: new Set(sessionRows.map((row) => row.session_id)),
    turnIds: new Set(turnRows.map((row) => row.turn_id)),
    sessions: sessionRows.map((row) => ({
      sessionId: row.session_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
    })),
  };
}

function rawSessionToWindow(raw: RawSessionRecord): {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
} {
  return { sessionId: raw.session_id, startedAt: raw.started_at, endedAt: raw.ended_at ?? null };
}

function upsertProject(db: EvalDb, cwd: string, now: string): number {
  const name = basename(cwd) || cwd;
  const existing = db.select().from(projects).where(eq(projects.cwd, cwd)).get();

  if (existing) {
    db.update(projects).set({ lastSeenAt: now }).where(eq(projects.cwd, cwd)).run();
    return existing.id;
  }

  const result = db
    .insert(projects)
    .values({ name, cwd, lastSeenAt: now })
    .returning({ id: projects.id })
    .get();

  return result.id;
}

function collectSessions(db: EvalDb, options: CollectOptions): number {
  const sessionFile = `${options.omxLogsDir}/session-history.jsonl`;
  const rawSessions = parseSessionHistory(sessionFile);
  let count = 0;

  for (const raw of rawSessions) {
    if (options.since && raw.started_at < options.since) continue;

    const existing = db.select().from(sessions).where(eq(sessions.sessionId, raw.session_id)).get();
    if (existing) continue;

    const durationMs = raw.ended_at
      ? new Date(raw.ended_at).getTime() - new Date(raw.started_at).getTime()
      : null;

    if (!options.dryRun) {
      const now = new Date().toISOString();
      let projectId: number | null = null;

      if (raw.cwd) {
        projectId = upsertProject(db, raw.cwd, now);
      }

      db.insert(sessions)
        .values({
          sessionId: raw.session_id,
          projectId,
          startedAt: raw.started_at,
          endedAt: raw.ended_at ?? null,
          cwd: raw.cwd,
          pid: raw.pid,
          durationMs,
          tokenSource: 'estimated',
        })
        .run();
    }
    count++;
  }

  return count;
}

function collectTurns(db: EvalDb, options: CollectOptions): number {
  const sinceDate = options.since?.split('T')[0];
  const rawTurns = parseTurnFiles(options.omxLogsDir, sinceDate);
  let count = 0;

  const allSessions = db.select().from(sessions).all();

  for (const raw of rawTurns) {
    const existing = db.select().from(turns).where(eq(turns.turnId, raw.turn_id)).get();
    if (existing) continue;

    const inputChars = raw.input_preview?.length ?? 0;
    const outputChars = raw.output_preview?.length ?? 0;
    const estInput = estimateTokens(raw.input_preview);
    const estOutput = estimateTokens(raw.output_preview);

    // Match session by time window
    const turnTime = new Date(raw.timestamp).getTime();
    const matchingSession = allSessions.find((s) => {
      const sessionStart = new Date(s.startedAt).getTime();
      const sessionEnd = s.endedAt ? new Date(s.endedAt).getTime() : Date.now();
      return turnTime >= sessionStart && turnTime <= sessionEnd;
    });

    if (!matchingSession) continue;

    if (!options.dryRun) {
      db.insert(turns)
        .values({
          sessionId: matchingSession.sessionId,
          threadId: raw.thread_id,
          turnId: raw.turn_id,
          inputPreview: raw.input_preview,
          outputPreview: raw.output_preview,
          inputChars,
          outputChars,
          estimatedInputTokens: estInput,
          estimatedOutputTokens: estOutput,
          timestamp: raw.timestamp,
        })
        .run();
    }
    count++;
  }

  return count;
}

function collectInvocations(
  db: EvalDb,
  ppid: string,
  dryRun?: boolean
): { count: number; diagnostics: OutcomeParseDiagnostic[] } {
  const parsed = parseOutcomeFileWithDiagnostics(ppid);
  let count = 0;

  for (const raw of parsed.records) {
    if (!dryRun) {
      const inserted = db
        .insert(agentInvocations)
        .values({
          sessionPpid: ppid,
          invocationFingerprint: outcomeFingerprint(ppid, raw),
          timestamp: raw.timestamp,
          agentType: raw.agent_type,
          model: raw.model,
          outcome: raw.outcome,
          durationSeconds: raw.duration_seconds ?? null,
          observedLatencyMs:
            raw.duration_seconds === undefined ? null : Math.round(raw.duration_seconds * 1000),
          patternUsed: raw.pattern_used ?? null,
          skillName: raw.skill ?? null,
          description: raw.description ?? null,
          errorSummary: raw.error_summary ?? null,
        })
        .onConflictDoNothing({ target: agentInvocations.invocationFingerprint })
        .returning({ id: agentInvocations.id })
        .get();
      if (!inserted) continue;
    }
    count++;
  }

  return { count, diagnostics: parsed.diagnostics };
}

function outcomeFingerprint(ppid: string, record: RawOutcomeRecord): string {
  return createHash('sha256')
    .update(ppid)
    .update('\0')
    .update(JSON.stringify(canonicalize(record)))
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])])
  );
}
