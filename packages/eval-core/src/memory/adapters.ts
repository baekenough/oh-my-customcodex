import type { MemoryKind, MemoryRecordInput, MemoryScope, MemorySensitivity } from './types.js';

interface RawExternalMemory {
  id?: string;
  content?: string;
  text?: string;
  document?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export function fromSearchableMemory(records: RawExternalMemory[], source = 'searchable-memory'): MemoryRecordInput[] {
  return records.map((record) => ({
    source,
    sourceId: record.id,
    content: record.content ?? record.text ?? record.document ?? '',
    scope: readScope(record.metadata),
    kind: readKind(record.metadata),
    sensitivity: readSensitivity(record.metadata),
    project: readString(record.metadata, 'project'),
    sessionId: readString(record.metadata, 'sessionId') ?? readString(record.metadata, 'session_id'),
    tags: readTags(record.metadata),
    metadata: record.metadata ?? {},
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }));
}

export function fromEpisodicMemory(records: RawExternalMemory[]): MemoryRecordInput[] {
  return records.map((record) => ({
    source: 'episodic-memory',
    sourceId: record.id,
    content: record.content ?? record.text ?? record.document ?? '',
    scope: readScope(record.metadata),
    kind: readKind(record.metadata) ?? 'summary',
    sensitivity: readSensitivity(record.metadata),
    project: readString(record.metadata, 'project'),
    sessionId: readString(record.metadata, 'sessionId') ?? readString(record.metadata, 'session_id'),
    tags: readTags(record.metadata),
    metadata: record.metadata ?? {},
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }));
}

export function fromNativeMemoryMarkdown(markdown: string, options: {
  project?: string;
  path?: string;
  scope?: MemoryScope;
  sensitivity?: MemorySensitivity;
} = {}): MemoryRecordInput[] {
  const lines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') || line.match(/^#{1,3}\s+/));

  return lines.map((line, index) => ({
    source: 'native',
    sourceId: options.path ? `${options.path}:${index + 1}` : String(index + 1),
    content: line.replace(/^-\s+/, '').replace(/^#{1,3}\s+/, ''),
    scope: options.scope ?? 'project',
    kind: line.startsWith('#') ? 'summary' : 'fact',
    sensitivity: options.sensitivity ?? 'project',
    project: options.project,
    tags: ['native-memory'],
    metadata: { path: options.path, line: index + 1 },
  }));
}

function readString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

function readScope(metadata: Record<string, unknown> | undefined): MemoryScope {
  const value = readString(metadata, 'scope');
  return value === 'user' || value === 'local' || value === 'project' ? value : 'project';
}

function readKind(metadata: Record<string, unknown> | undefined): MemoryKind {
  const value = readString(metadata, 'kind') ?? readString(metadata, 'type');
  return value === 'behavior' || value === 'decision' || value === 'summary' || value === 'task' || value === 'artifact'
    ? value
    : 'fact';
}

function readSensitivity(metadata: Record<string, unknown> | undefined): MemorySensitivity {
  const value = readString(metadata, 'sensitivity');
  return value === 'public' || value === 'sensitive' || value === 'secret' || value === 'project'
    ? value
    : 'project';
}

function readTags(metadata: Record<string, unknown> | undefined): string[] {
  const value = metadata?.tags;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

