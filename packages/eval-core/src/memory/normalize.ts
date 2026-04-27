import { createHash } from 'node:crypto';
import type { MemoryKind, MemoryRecordInput, MemoryScope, MemorySensitivity, NormalizedMemoryRecord } from './types.js';

const VALID_SCOPES = new Set<MemoryScope>(['user', 'project', 'local']);
const VALID_KINDS = new Set<MemoryKind>(['behavior', 'decision', 'fact', 'summary', 'task', 'artifact']);
const VALID_SENSITIVITY = new Set<MemorySensitivity>(['public', 'project', 'sensitive', 'secret']);

export function stableMemoryHash(record: Pick<NormalizedMemoryRecord, 'source' | 'scope' | 'kind' | 'content' | 'sensitivity'>): string {
  const normalized = [
    record.source.trim(),
    record.scope,
    record.kind,
    record.sensitivity,
    normalizeContent(record.content),
  ].join('\n');
  return createHash('sha256').update(normalized).digest('hex');
}

export function normalizeMemoryRecord(input: MemoryRecordInput): NormalizedMemoryRecord | null {
  const content = normalizeContent(input.content);
  if (!content) return null;

  const scope = VALID_SCOPES.has(input.scope ?? 'project') ? input.scope ?? 'project' : 'project';
  const kind = VALID_KINDS.has(input.kind ?? 'fact') ? input.kind ?? 'fact' : 'fact';
  const sensitivity = VALID_SENSITIVITY.has(input.sensitivity ?? 'project')
    ? input.sensitivity ?? 'project'
    : 'project';

  if (sensitivity === 'secret') return null;

  const base = {
    source: input.source,
    sourceId: input.sourceId,
    scope,
    kind,
    content,
    sensitivity,
    project: input.project,
    sessionId: input.sessionId,
    tags: input.tags ?? [],
    metadata: input.metadata ?? {},
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: input.updatedAt,
  };

  return {
    ...base,
    contentHash: stableMemoryHash(base),
  };
}

export function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

