export type MemorySource = 'native' | 'searchable-memory' | 'omx-memory' | 'episodic-memory' | (string & {});
export type MemoryScope = 'user' | 'project' | 'local';
export type MemoryKind = 'behavior' | 'decision' | 'fact' | 'summary' | 'task' | 'artifact';
export type MemorySensitivity = 'public' | 'project' | 'sensitive' | 'secret';

export interface MemoryRecordInput {
  source: MemorySource;
  sourceId?: string;
  scope?: MemoryScope;
  kind?: MemoryKind;
  content: string;
  sensitivity?: MemorySensitivity;
  project?: string;
  sessionId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface NormalizedMemoryRecord extends Required<Pick<MemoryRecordInput,
  'source' | 'scope' | 'kind' | 'content' | 'sensitivity' | 'tags' | 'metadata' | 'createdAt'
>> {
  sourceId?: string;
  project?: string;
  sessionId?: string;
  updatedAt?: string;
  contentHash: string;
}

export interface PersistMemoryResult {
  inserted: number;
  skipped: number;
  rejected: number;
}

