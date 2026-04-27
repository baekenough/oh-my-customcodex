import { normalizeMemoryRecord } from './normalize.js';
import type { MemoryRecordInput, NormalizedMemoryRecord } from './types.js';

export function aggregateMemoryRecords(inputs: MemoryRecordInput[]): NormalizedMemoryRecord[] {
  const byHash = new Map<string, NormalizedMemoryRecord>();

  for (const input of inputs) {
    const normalized = normalizeMemoryRecord(input);
    if (!normalized) continue;
    if (!byHash.has(normalized.contentHash)) {
      byHash.set(normalized.contentHash, normalized);
    }
  }

  return [...byHash.values()];
}

