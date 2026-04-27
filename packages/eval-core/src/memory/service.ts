import { Database } from 'bun:sqlite';
import { aggregateMemoryRecords } from './aggregator.js';
import { normalizeMemoryRecord } from './normalize.js';
import type { MemoryRecordInput, NormalizedMemoryRecord, PersistMemoryResult } from './types.js';

export class MemoryPersistenceService {
  constructor(private readonly db: Database) {}

  persist(inputs: MemoryRecordInput[]): PersistMemoryResult {
    const candidates = aggregateMemoryRecords(inputs);
    const rejected = inputs.filter((input) => normalizeMemoryRecord(input) === null).length;
    let inserted = 0;
    let skipped = 0;

    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO memory_records (
        source, source_id, scope, kind, content, content_hash, sensitivity,
        project, session_id, tags, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const run = this.db.transaction((records: NormalizedMemoryRecord[]) => {
      for (const record of records) {
        const result = insert.run(
          record.source,
          record.sourceId ?? null,
          record.scope,
          record.kind,
          record.content,
          record.contentHash,
          record.sensitivity,
          record.project ?? null,
          record.sessionId ?? null,
          JSON.stringify(record.tags),
          JSON.stringify(record.metadata),
          record.createdAt,
          record.updatedAt ?? null
        );
        if (result.changes > 0) inserted += 1;
        else skipped += 1;
      }
    });

    run(candidates);

    return {
      inserted,
      skipped,
      rejected,
    };
  }
}

export function persistMemoryRecords(db: Database, inputs: MemoryRecordInput[]): PersistMemoryResult {
  return new MemoryPersistenceService(db).persist(inputs);
}
