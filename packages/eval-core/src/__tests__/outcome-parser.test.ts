import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectCommand, formatCollectDiagnostics } from '../cli/collect.cmd.js';
import { collect } from '../collect/index.js';
import { parseOutcomeFile, parseOutcomeFileWithDiagnostics } from '../collect/outcome-parser.js';
import { runMigrations } from '../db/migrate.js';
import type { OutcomeParseDiagnostic as PublicOutcomeParseDiagnostic } from '../index.js';

const paths: string[] = [];

function outcome(agentType: string) {
  return {
    timestamp: '2026-07-13T00:00:00Z',
    agent_type: agentType,
    model: 'gpt-runtime-frontier',
    outcome: 'success' as const,
  };
}

function hookOutcome(agentType: string, overrides: Record<string, unknown> = {}) {
  return {
    ...outcome(agentType),
    pattern_used: 'sequential',
    skill: '',
    description: `Run ${agentType} with braces {kept} and escaped quote "inside"`,
    error_summary: '',
    duration_seconds: 0,
    ...overrides,
  };
}

function prettyHookRecord(agentType: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(hookOutcome(agentType, overrides), null, 2);
}

function pathFor(prefix: 'codex' | 'claude', ppid: string): string {
  const path = `/tmp/.${prefix}-task-outcomes-${ppid}`;
  paths.push(path);
  return path;
}

function readAgentInvocations(dbPath: string): unknown[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .query(
        'SELECT session_ppid, agent_type, duration_seconds, observed_latency_ms, invocation_fingerprint FROM agent_invocations ORDER BY id'
      )
      .all();
  } finally {
    db.close();
  }
}

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('parseOutcomeFile', () => {
  it('reads the Codex outcome file as the primary source', () => {
    const ppid = randomUUID();
    writeFileSync(pathFor('codex', ppid), `${JSON.stringify(outcome('executor'))}\n`);

    expect(parseOutcomeFile(ppid)).toEqual([outcome('executor')]);
  });

  it('falls back to the legacy Claude file only when the Codex file is absent', () => {
    const ppid = randomUUID();
    writeFileSync(pathFor('claude', ppid), `${JSON.stringify(outcome('legacy'))}\n`);

    const result = parseOutcomeFileWithDiagnostics(ppid);
    expect(result.records).toEqual([outcome('legacy')]);
    expect(result.source).toBe('claude');
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('legacy_fallback');
  });

  it('uses only Codex records when both files exist', () => {
    const ppid = randomUUID();
    writeFileSync(pathFor('codex', ppid), `${JSON.stringify(outcome('codex'))}\n`);
    writeFileSync(pathFor('claude', ppid), `${JSON.stringify(outcome('legacy'))}\n`);

    const result = parseOutcomeFileWithDiagnostics(ppid);
    expect(result.records).toEqual([outcome('codex')]);
    expect(result.source).toBe('codex');
  });

  it('skips malformed JSON and invalid record shapes with a diagnostic', () => {
    const ppid = randomUUID();
    writeFileSync(
      pathFor('codex', ppid),
      `not-json\n${JSON.stringify({ timestamp: 'missing-required-fields' })}\n${JSON.stringify({ ...outcome('bad-duration'), duration_seconds: '1' })}\n${JSON.stringify(outcome('valid'))}\n`
    );

    const result = parseOutcomeFileWithDiagnostics(ppid);
    expect(result.records).toEqual([outcome('valid')]);
    expect(result.diagnostics).toContainEqual({ code: 'malformed_records', count: 3 });
  });

  it('reads legacy pretty multi-line hook-shaped records as logical records', () => {
    const ppid = randomUUID();
    writeFileSync(
      pathFor('codex', ppid),
      `${prettyHookRecord('executor')}\n${prettyHookRecord('verifier', { outcome: 'failure' })}\n`
    );

    const result = parseOutcomeFileWithDiagnostics(ppid);
    expect(result.records).toEqual([
      hookOutcome('executor'),
      hookOutcome('verifier', { outcome: 'failure' }),
    ]);
    expect(result.diagnostics).not.toContainEqual({ code: 'malformed_records', count: 1 });
  });

  it('reads mixed compact JSONL and pretty records with braces and escaped strings', () => {
    const ppid = randomUUID();
    const compact = hookOutcome('compact', {
      description: 'one-line {json} with escaped quote " and slash \\\\',
    });
    const pretty = hookOutcome('pretty', {
      description: 'multi-line logical record with } in string and nested-ish {"x":1}',
      error_summary: 'escaped newline\\ntext',
    });
    writeFileSync(
      pathFor('codex', ppid),
      `${JSON.stringify(compact)}\n${JSON.stringify(pretty, null, 2)}\n`
    );

    const result = parseOutcomeFileWithDiagnostics(ppid);
    expect(result.records).toEqual([compact, pretty]);
    expect(result.diagnostics).toEqual([]);
  });

  it('counts truncated and malformed logical records while preserving valid records', () => {
    const ppid = randomUUID();
    writeFileSync(
      pathFor('codex', ppid),
      `${prettyHookRecord('valid')}\n{"timestamp":"2026-07-13T00:00:00Z","agent_type":"truncated"\nnot-json\n`
    );

    const result = parseOutcomeFileWithDiagnostics(ppid);
    expect(result.records).toEqual([hookOutcome('valid')]);
    expect(result.diagnostics).toContainEqual({ code: 'malformed_records', count: 1 });
  });

  it('deduplicates logically identical records', () => {
    const ppid = randomUUID();
    const record = outcome('duplicate');
    writeFileSync(pathFor('codex', ppid), `${JSON.stringify(record)}\n${JSON.stringify(record)}\n`);

    const result = parseOutcomeFileWithDiagnostics(ppid);
    expect(result.records).toEqual([record]);
    expect(result.diagnostics).toContainEqual({ code: 'duplicate_records', count: 1 });
  });

  it('preserves records that differ in additional hook fields', () => {
    const ppid = randomUUID();
    const record = outcome('duration');
    writeFileSync(
      pathFor('codex', ppid),
      `${JSON.stringify({ ...record, duration_seconds: 1 })}\n${JSON.stringify({ ...record, duration_seconds: 2 })}\n`
    );

    const result = parseOutcomeFileWithDiagnostics(ppid);
    expect(result.records).toHaveLength(2);
    expect(result.diagnostics).not.toContainEqual({ code: 'duplicate_records', count: 1 });
  });

  it('deduplicates identical full records regardless of JSON key order', () => {
    const ppid = randomUUID();
    const first = { ...outcome('key-order'), duration_seconds: 3 };
    const second = {
      duration_seconds: 3,
      outcome: first.outcome,
      model: first.model,
      agent_type: first.agent_type,
      timestamp: first.timestamp,
    };
    writeFileSync(pathFor('codex', ppid), `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`);

    const result = parseOutcomeFileWithDiagnostics(ppid);
    expect(result.records).toHaveLength(1);
    expect(result.diagnostics).toContainEqual({ code: 'duplicate_records', count: 1 });
  });

  it('returns an explicit diagnostic when neither outcome file exists', () => {
    const result = parseOutcomeFileWithDiagnostics(randomUUID());

    expect(result.records).toEqual([]);
    expect(result.source).toBeNull();
    expect(result.diagnostics ?? []).toContainEqual({ code: 'outcome_file_missing', count: 1 });
  });

  it('includes a missing outcome diagnostic in the collector summary', async () => {
    const root = join(tmpdir(), `eval-outcome-test-${randomUUID()}`);
    paths.push(root);
    mkdirSync(join(root, 'logs'), { recursive: true });
    const dbPath = join(root, 'eval.sqlite');
    runMigrations(dbPath);

    const result = await collect({
      dbPath,
      omxLogsDir: join(root, 'logs'),
      ppid: randomUUID(),
      dryRun: true,
    });

    expect(result.diagnostics).toContainEqual({ code: 'outcome_file_missing', count: 1 });
  });

  it('collects the same PPID outcome file idempotently', async () => {
    const root = join(tmpdir(), `eval-outcome-idempotent-test-${randomUUID()}`);
    paths.push(root);
    mkdirSync(join(root, 'logs'), { recursive: true });
    const dbPath = join(root, 'eval.sqlite');
    const ppid = randomUUID();
    runMigrations(dbPath);
    writeFileSync(pathFor('codex', ppid), `${JSON.stringify(hookOutcome('executor'))}\n`);

    const first = await collect({ dbPath, omxLogsDir: join(root, 'logs'), ppid });
    const second = await collect({ dbPath, omxLogsDir: join(root, 'logs'), ppid });

    expect(first.invocations).toBe(1);
    expect(second.invocations).toBe(0);
    const rows = readAgentInvocations(dbPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      session_ppid: ppid,
      agent_type: 'executor',
      duration_seconds: 0,
      observed_latency_ms: 0,
    });
  });

  it('preserves same-PPID records that differ by duration_seconds', async () => {
    const root = join(tmpdir(), `eval-outcome-duration-test-${randomUUID()}`);
    paths.push(root);
    mkdirSync(join(root, 'logs'), { recursive: true });
    const dbPath = join(root, 'eval.sqlite');
    const ppid = randomUUID();
    runMigrations(dbPath);
    writeFileSync(
      pathFor('codex', ppid),
      `${JSON.stringify(hookOutcome('executor', { duration_seconds: 1 }))}\n${JSON.stringify(hookOutcome('executor', { duration_seconds: 2 }))}\n`
    );

    const result = await collect({ dbPath, omxLogsDir: join(root, 'logs'), ppid });

    expect(result.invocations).toBe(2);
    expect(readAgentInvocations(dbPath)).toMatchObject([
      { duration_seconds: 1, observed_latency_ms: 1000 },
      { duration_seconds: 2, observed_latency_ms: 2000 },
    ]);
  });

  it('reruns migrations idempotently with invocation fingerprint support', () => {
    const root = join(tmpdir(), `eval-outcome-migration-test-${randomUUID()}`);
    paths.push(root);
    const dbPath = join(root, 'eval.sqlite');

    runMigrations(dbPath);
    runMigrations(dbPath);

    const db = new Database(dbPath, { readonly: true });
    try {
      const columns = db.query('PRAGMA table_info(agent_invocations)').all() as {
        name: string;
      }[];
      const indexes = db.query('PRAGMA index_list(agent_invocations)').all() as {
        name: string;
        unique: number;
      }[];
      expect(columns.map((column) => column.name)).toContain('invocation_fingerprint');
      expect(columns.map((column) => column.name)).toContain('duration_seconds');
      expect(indexes).toContainEqual(
        expect.objectContaining({ name: 'idx_invocations_fingerprint_unique', unique: 1 })
      );
    } finally {
      db.close();
    }
  });

  it('migrates legacy agent_invocations tables without fingerprint columns', () => {
    const root = join(tmpdir(), `eval-outcome-legacy-migration-test-${randomUUID()}`);
    paths.push(root);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'eval.sqlite');
    const db = new Database(dbPath);
    db.run(`CREATE TABLE agent_invocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_ppid TEXT NOT NULL,
      session_id TEXT,
      timestamp TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      model TEXT NOT NULL,
      outcome TEXT NOT NULL,
      pattern_used TEXT,
      skill_name TEXT,
      description TEXT,
      error_summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.close();

    runMigrations(dbPath);
    runMigrations(dbPath);

    const migrated = new Database(dbPath, { readonly: true });
    try {
      const columns = migrated.query('PRAGMA table_info(agent_invocations)').all() as {
        name: string;
      }[];
      const indexes = migrated.query('PRAGMA index_list(agent_invocations)').all() as {
        name: string;
        unique: number;
      }[];
      expect(columns.map((column) => column.name)).toContain('invocation_fingerprint');
      expect(columns.map((column) => column.name)).toContain('duration_seconds');
      expect(indexes).toContainEqual(
        expect.objectContaining({ name: 'idx_invocations_fingerprint_unique', unique: 1 })
      );
    } finally {
      migrated.close();
    }
  });

  it('formats collector diagnostics for user-facing CLI output', () => {
    const diagnostics: PublicOutcomeParseDiagnostic[] = [
      { code: 'outcome_file_missing', count: 1 },
      { code: 'malformed_records', count: 2 },
    ];

    expect(formatCollectDiagnostics(diagnostics, '123')).toEqual([
      'No task outcome file found for PPID 123 (expected /tmp/.codex-task-outcomes-123)',
      'Skipped 2 malformed task outcome records',
    ]);
  });

  it('prints collector diagnostics in the CLI summary', async () => {
    const root = join(tmpdir(), `eval-outcome-cli-test-${randomUUID()}`);
    paths.push(root);
    mkdirSync(join(root, 'logs'), { recursive: true });
    const dbPath = join(root, 'eval.sqlite');
    const ppid = randomUUID();
    runMigrations(dbPath);
    const warnings: string[] = [];
    const originalWarn = console.warn;
    const originalLog = console.log;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
    console.log = () => undefined;

    try {
      await collectCommand.parseAsync([
        'bun',
        'collect',
        '--db-path',
        dbPath,
        '--omx-dir',
        join(root, 'logs'),
        '--ppid',
        ppid,
        '--dry-run',
      ]);
    } finally {
      console.warn = originalWarn;
      console.log = originalLog;
    }

    expect(warnings.join('\n')).toContain(`No task outcome file found for PPID ${ppid}`);
  });
});
