import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect } from '../collect/index.js';
import { runMigrations } from '../db/migrate.js';

function withTempRoot(): string {
  const root = join(tmpdir(), `eval-collect-dry-run-${randomUUID()}`);
  mkdirSync(join(root, 'logs'), { recursive: true });
  return root;
}

function writeLogFixtures(root: string, suffix = 'one'): void {
  const logs = join(root, 'logs');
  writeFileSync(
    join(logs, 'session-history.jsonl'),
    `${JSON.stringify({
      session_id: `session-${suffix}`,
      started_at: '2026-07-14T00:00:00.000Z',
      ended_at: '2026-07-14T00:10:00.000Z',
      cwd: root,
      pid: 1234,
    })}\n`
  );
  writeFileSync(
    join(logs, 'turns-2026-07-14.jsonl'),
    `${JSON.stringify({
      timestamp: '2026-07-14T00:05:00.000Z',
      type: 'assistant',
      thread_id: `thread-${suffix}`,
      turn_id: `turn-${suffix}`,
      input_preview: 'hello',
      output_preview: 'world',
    })}\n`
  );
}

function readSidecars(dbPath: string): Map<string, Buffer | null> {
  return new Map(
    [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].map((path) => [
      path,
      existsSync(path) ? readFileSync(path) : null,
    ])
  );
}

describe('collect dry-run', () => {
  it('succeeds on a fresh db path without creating persistent sqlite files', async () => {
    const root = withTempRoot();
    try {
      writeLogFixtures(root);
      const dbPath = join(root, 'nested', 'new.sqlite');

      const result = await collect({ dbPath, omxLogsDir: join(root, 'logs'), dryRun: true });

      expect(result).toMatchObject({ sessions: 1, turns: 1, invocations: 0 });
      expect(existsSync(dbPath)).toBe(false);
      expect(existsSync(`${dbPath}-wal`)).toBe(false);
      expect(existsSync(`${dbPath}-shm`)).toBe(false);
      expect(existsSync(join(root, 'nested'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not mutate an existing database or sqlite sidecars', async () => {
    const root = withTempRoot();
    try {
      writeLogFixtures(root, 'existing');
      const dbPath = join(root, 'eval.sqlite');
      runMigrations(dbPath);
      const sqlite = new Database(dbPath);
      sqlite.run(
        `INSERT INTO projects (name, cwd, last_seen_at, created_at) VALUES ('project', ?, '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z')`,
        [root]
      );
      sqlite.run(
        `INSERT INTO sessions (session_id, project_id, started_at, ended_at, cwd, pid, token_source, created_at) VALUES ('session-existing', 1, '2026-07-14T00:00:00.000Z', '2026-07-14T00:10:00.000Z', ?, 1234, 'estimated', '2026-07-14T00:00:00.000Z')`,
        [root]
      );
      sqlite.run(
        `INSERT INTO turns (session_id, thread_id, turn_id, input_preview, output_preview, input_chars, output_chars, estimated_input_tokens, estimated_output_tokens, timestamp, created_at) VALUES ('session-existing', 'thread-existing', 'turn-existing', 'hello', 'world', 5, 5, 1, 1, '2026-07-14T00:05:00.000Z', '2026-07-14T00:00:00.000Z')`
      );
      sqlite.close();
      const before = readSidecars(dbPath);

      const result = await collect({ dbPath, omxLogsDir: join(root, 'logs'), dryRun: true });
      const after = readSidecars(dbPath);

      expect(result).toMatchObject({ sessions: 0, turns: 0, invocations: 0 });
      expect(after).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
