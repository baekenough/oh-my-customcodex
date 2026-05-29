import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { aggregateMemoryRecords, fromSearchableMemory, fromNativeMemoryMarkdown, persistMemoryRecords } from '../memory/index.js';

function createMemoryDb(): Database {
  const db = new Database(':memory:');
  db.run(`CREATE TABLE memory_records (
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
  )`);
  return db;
}

describe('memory unification', () => {
  it('deduplicates records by normalized content hash', () => {
    const records = aggregateMemoryRecords([
      { source: 'native', content: 'Use Korean for release reports.', kind: 'behavior' },
      { source: 'native', content: 'Use   Korean for release reports.', kind: 'behavior' },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0].content).toBe('Use Korean for release reports.');
  });

  it('rejects secret records before persistence', () => {
    const records = aggregateMemoryRecords([
      { source: 'native', content: 'token=secret', sensitivity: 'secret' },
      { source: 'native', content: 'Keep release evidence concise.', sensitivity: 'project' },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0].content).toBe('Keep release evidence concise.');
  });

  it('normalizes searchable backend and native markdown records', () => {
    const external = fromSearchableMemory([
      {
        id: 'mem-1',
        content: 'Prefer isolated worktrees for dirty release runs.',
        metadata: { scope: 'project', kind: 'decision', tags: ['release'], project: 'oh-my-customcodex' },
      },
    ]);
    const native = fromNativeMemoryMarkdown('- Keep Template Sync and Wiki Sync in release gates.', {
      project: 'oh-my-customcodex',
      path: 'MEMORY.md',
    });

    const records = aggregateMemoryRecords([...external, ...native]);

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.source).sort()).toEqual(['native', 'searchable-memory']);
  });

  it('persists unique memory records and skips duplicates', () => {
    const db = createMemoryDb();

    const result = persistMemoryRecords(db, [
      { source: 'native', content: 'Run public release verification before completion.' },
      { source: 'native', content: 'Run public release verification before completion.' },
    ]);

    const count = db.prepare<{ count: number }, []>('SELECT count(*) as count FROM memory_records').get();
    expect(result).toEqual({ inserted: 1, skipped: 0, rejected: 0 });
    expect(count?.count).toBe(1);

    const second = persistMemoryRecords(db, [
      { source: 'native', content: 'Run public release verification before completion.' },
    ]);
    expect(second).toEqual({ inserted: 0, skipped: 1, rejected: 0 });
    db.close();
  });
});
