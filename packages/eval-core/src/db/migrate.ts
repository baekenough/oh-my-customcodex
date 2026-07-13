import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function runMigrations(dbPath: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    runMigrationsOnDb(db);
  } catch (err) {
    db.close();
    throw err;
  }
  db.close();
}

function runMigrationsOnDb(db: InstanceType<typeof Database>): void {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA busy_timeout = 5000');

  // Create tables using bun:sqlite (SQL DDL, not shell)
  runStatements(db, [
    `CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cwd TEXT NOT NULL UNIQUE,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      project_id INTEGER REFERENCES projects(id),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      cwd TEXT,
      pid INTEGER,
      duration_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      estimated_cost_usd REAL,
      token_source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL UNIQUE,
      input_preview TEXT,
      output_preview TEXT,
      input_chars INTEGER,
      output_chars INTEGER,
      estimated_input_tokens INTEGER,
      estimated_output_tokens INTEGER,
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS eval_baselines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      capability TEXT NOT NULL,
      ideal_steps INTEGER,
      ideal_tool_calls INTEGER,
      ideal_latency_ms INTEGER,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS agent_invocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_ppid TEXT NOT NULL,
      session_id TEXT,
      baseline_id INTEGER REFERENCES eval_baselines(id),
      timestamp TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      agent_name TEXT,
      model TEXT NOT NULL,
      outcome TEXT NOT NULL,
      observed_steps INTEGER,
      observed_tool_calls INTEGER,
      observed_latency_ms INTEGER,
      duration_seconds INTEGER,
      correctness REAL,
      step_ratio REAL,
      tool_call_ratio REAL,
      latency_ratio REAL,
      started_at TEXT,
      completed_at TEXT,
      invocation_fingerprint TEXT,
      pattern_used TEXT,
      skill_name TEXT,
      description TEXT,
      error_summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turn_id TEXT REFERENCES turns(turn_id),
      session_id TEXT REFERENCES sessions(session_id),
      score INTEGER,
      verdict TEXT,
      tags TEXT,
      comment TEXT,
      evaluated_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS session_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      rating INTEGER,
      tags TEXT,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS improvement_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feedback_source TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_name TEXT NOT NULL,
      action_type TEXT NOT NULL,
      description TEXT NOT NULL,
      confidence TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      evidence TEXT,
      priority INTEGER DEFAULT 0,
      cooldown_days INTEGER DEFAULT 7,
      conflict_resolved_by TEXT,
      applied_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS memory_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_id TEXT,
      scope TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL UNIQUE,
      sensitivity TEXT NOT NULL DEFAULT 'project',
      project TEXT,
      session_id TEXT,
      tags TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    )`,
    'CREATE INDEX IF NOT EXISTS idx_projects_cwd ON projects(cwd)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id)',
    'CREATE INDEX IF NOT EXISTS idx_eval_baselines_task_capability ON eval_baselines(task_id, capability)',
    'CREATE INDEX IF NOT EXISTS idx_turns_session_id ON turns(session_id)',
    'CREATE INDEX IF NOT EXISTS idx_invocations_ppid ON agent_invocations(session_ppid)',
    'CREATE INDEX IF NOT EXISTS idx_invocations_agent_type ON agent_invocations(agent_type)',
    'CREATE INDEX IF NOT EXISTS idx_invocations_agent_model ON agent_invocations(agent_type, model)',
    'CREATE INDEX IF NOT EXISTS idx_invocations_type_outcome_ts ON agent_invocations(agent_type, outcome, timestamp)',
    'CREATE INDEX IF NOT EXISTS idx_evaluations_session_id ON evaluations(session_id)',
    'CREATE INDEX IF NOT EXISTS idx_evaluations_turn_id ON evaluations(turn_id)',
    'CREATE INDEX IF NOT EXISTS idx_feedback_session_id ON session_feedback(session_id)',
    'CREATE INDEX IF NOT EXISTS idx_improvement_actions_target ON improvement_actions(target_name)',
    'CREATE INDEX IF NOT EXISTS idx_improvement_actions_status ON improvement_actions(status)',
    'CREATE INDEX IF NOT EXISTS idx_memory_records_hash ON memory_records(content_hash)',
    'CREATE INDEX IF NOT EXISTS idx_memory_records_source ON memory_records(source, source_id)',
    'CREATE INDEX IF NOT EXISTS idx_memory_records_project ON memory_records(project)',
    'CREATE INDEX IF NOT EXISTS idx_memory_records_scope_kind ON memory_records(scope, kind)',
  ]);

  // Migrations: add project_id column to existing sessions table (idempotent)
  runOptionalStatement(
    db,
    'ALTER TABLE sessions ADD COLUMN project_id INTEGER REFERENCES projects(id)',
    ['duplicate column', 'already exists']
  );

  // Migration: add conflict resolution columns to improvement_actions (idempotent)
  addColumns(db, [
    'ALTER TABLE improvement_actions ADD COLUMN priority INTEGER DEFAULT 0',
    'ALTER TABLE improvement_actions ADD COLUMN cooldown_days INTEGER DEFAULT 7',
    'ALTER TABLE improvement_actions ADD COLUMN conflict_resolved_by TEXT',
  ]);

  // Migration: expand agent_invocations for optional trajectory analysis fields (idempotent)
  addColumns(db, [
    'ALTER TABLE agent_invocations ADD COLUMN baseline_id INTEGER REFERENCES eval_baselines(id)',
    'ALTER TABLE agent_invocations ADD COLUMN agent_name TEXT',
    'ALTER TABLE agent_invocations ADD COLUMN observed_steps INTEGER',
    'ALTER TABLE agent_invocations ADD COLUMN observed_tool_calls INTEGER',
    'ALTER TABLE agent_invocations ADD COLUMN observed_latency_ms INTEGER',
    'ALTER TABLE agent_invocations ADD COLUMN duration_seconds INTEGER',
    'ALTER TABLE agent_invocations ADD COLUMN correctness REAL',
    'ALTER TABLE agent_invocations ADD COLUMN step_ratio REAL',
    'ALTER TABLE agent_invocations ADD COLUMN tool_call_ratio REAL',
    'ALTER TABLE agent_invocations ADD COLUMN latency_ratio REAL',
    'ALTER TABLE agent_invocations ADD COLUMN started_at TEXT',
    'ALTER TABLE agent_invocations ADD COLUMN completed_at TEXT',
    'ALTER TABLE agent_invocations ADD COLUMN invocation_fingerprint TEXT',
  ]);

  // Add project_id index after the ALTER TABLE migration (column may not exist on legacy DBs)
  createOptionalIndexes(db, [
    'CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_invocations_baseline_id ON agent_invocations(baseline_id)',
    'CREATE INDEX IF NOT EXISTS idx_invocations_agent_model ON agent_invocations(agent_type, model)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_invocations_fingerprint_unique ON agent_invocations(invocation_fingerprint)',
  ]);
}

function runStatements(db: InstanceType<typeof Database>, statements: string[]): void {
  db.transaction(() => {
    for (const sql of statements) {
      db.run(sql);
    }
  })();
}

function addColumns(db: InstanceType<typeof Database>, statements: string[]): void {
  for (const sql of statements) {
    runOptionalStatement(db, sql, ['duplicate column', 'already exists']);
  }
}

function createOptionalIndexes(db: InstanceType<typeof Database>, statements: string[]): void {
  for (const sql of statements) {
    runOptionalStatement(db, sql, ['already exists', 'no such column']);
  }
}

function runOptionalStatement(
  db: InstanceType<typeof Database>,
  sql: string,
  ignoredMessages: string[]
): void {
  try {
    db.run(sql);
  } catch (err: unknown) {
    if (!isIgnoredMigrationError(err, ignoredMessages)) throw err;
  }
}

function isIgnoredMigrationError(err: unknown, ignoredMessages: string[]): boolean {
  const msg = err instanceof Error ? err.message : '';
  return ignoredMessages.some((ignored) => msg.includes(ignored));
}
