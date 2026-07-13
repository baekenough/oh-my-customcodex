import { existsSync, readFileSync } from 'node:fs';
import type { RawOutcomeRecord } from '../types/session.js';

export type OutcomeSource = 'codex' | 'claude';

export interface OutcomeParseDiagnostic {
  code: 'outcome_file_missing' | 'legacy_fallback' | 'malformed_records' | 'duplicate_records';
  count: number;
}

export interface OutcomeParseResult {
  records: RawOutcomeRecord[];
  source: OutcomeSource | null;
  diagnostics: OutcomeParseDiagnostic[];
}

export function parseOutcomeFile(ppid: string): RawOutcomeRecord[] {
  return parseOutcomeFileWithDiagnostics(ppid).records;
}

export function parseOutcomeFileWithDiagnostics(ppid: string): OutcomeParseResult {
  const codexPath = `/tmp/.codex-task-outcomes-${ppid}`;
  const claudePath = `/tmp/.claude-task-outcomes-${ppid}`;
  const source: OutcomeSource | null = existsSync(codexPath)
    ? 'codex'
    : existsSync(claudePath)
      ? 'claude'
      : null;

  if (!source) {
    return {
      records: [],
      source: null,
      diagnostics: [{ code: 'outcome_file_missing', count: 1 }],
    };
  }

  const diagnostics: OutcomeParseDiagnostic[] = [];
  if (source === 'claude') diagnostics.push({ code: 'legacy_fallback', count: 1 });

  const filePath = source === 'codex' ? codexPath : claudePath;
  const content = readFileSync(filePath, 'utf-8');
  if (!content.trim()) return { records: [], source, diagnostics };

  const records: RawOutcomeRecord[] = [];
  const seen = new Set<string>();
  let malformedCount = 0;
  let duplicateCount = 0;

  for (const logicalRecord of splitOutcomeRecords(content)) {
    const parsed = parseLogicalOutcomeRecord(logicalRecord);
    if (!parsed) {
      malformedCount++;
      continue;
    }
    const key = outcomeKey(parsed);
    if (seen.has(key)) {
      duplicateCount++;
      continue;
    }
    seen.add(key);
    records.push(parsed);
  }

  if (malformedCount > 0) {
    diagnostics.push({ code: 'malformed_records', count: malformedCount });
  }
  if (duplicateCount > 0) {
    diagnostics.push({ code: 'duplicate_records', count: duplicateCount });
  }

  return { records, source, diagnostics };
}

function parseLogicalOutcomeRecord(logicalRecord: string): RawOutcomeRecord | null {
  try {
    const parsed = JSON.parse(logicalRecord) as unknown;
    return isRawOutcomeRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function splitOutcomeRecords(content: string): string[] {
  const records: string[] = [];
  let index = 0;

  while (index < content.length) {
    index = skipWhitespace(content, index);
    if (index >= content.length) break;

    if (content[index] !== '{') {
      const nextIndex = nextLineStart(content, index);
      records.push(content.slice(index, nextIndex).trimEnd());
      index = nextIndex;
      continue;
    }

    const objectEnd = findJsonObjectEnd(content, index);
    if (objectEnd === -1) {
      records.push(content.slice(index).trimEnd());
      break;
    }

    records.push(content.slice(index, objectEnd));
    index = objectEnd;
  }

  return records;
}

function skipWhitespace(content: string, index: number): number {
  let cursor = index;
  while (cursor < content.length && /\s/.test(content[cursor])) cursor++;
  return cursor;
}

function nextLineStart(content: string, index: number): number {
  const newlineIndex = content.indexOf('\n', index);
  return newlineIndex === -1 ? content.length : newlineIndex + 1;
}

interface JsonScanState {
  depth: number;
  inString: boolean;
  escaped: boolean;
}

function scanStringChar(char: string, state: JsonScanState): void {
  if (state.escaped) {
    state.escaped = false;
  } else if (char === '\\') {
    state.escaped = true;
  } else if (char === '"') {
    state.inString = false;
  }
}

function scanJsonChar(char: string, state: JsonScanState): boolean {
  if (state.inString) {
    scanStringChar(char, state);
    return false;
  }
  if (char === '"') state.inString = true;
  if (char === '{') state.depth++;
  if (char === '}') state.depth--;
  return state.depth === 0;
}

function findJsonObjectEnd(content: string, start: number): number {
  const state: JsonScanState = { depth: 0, inString: false, escaped: false };

  for (let index = start; index < content.length; index++) {
    if (scanJsonChar(content[index], state)) return index + 1;
  }

  return -1;
}

function isRawOutcomeRecord(value: unknown): value is RawOutcomeRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.timestamp === 'string' &&
    typeof record.agent_type === 'string' &&
    typeof record.model === 'string' &&
    (record.outcome === 'success' || record.outcome === 'failure') &&
    isOptionalFiniteNumber(record.duration_seconds)
  );
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function outcomeKey(record: RawOutcomeRecord): string {
  return JSON.stringify(canonicalize(record));
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
