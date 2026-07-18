#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_FIELDS = [
  'schemaVersion',
  'skill',
  'date',
  'query',
  'repository',
  'releaseVersion',
  'verifiedSha',
  'executionMode',
  'verdict',
  'findings',
  'verificationEvidence',
];
const FINDING_BUCKETS = ['initial', 'falsePositives', 'fixed', 'unresolved'];
const TERMINAL_BUCKETS = ['falsePositives', 'fixed', 'unresolved'];
const EXECUTION_MODES = new Set([
  'standard',
  'docs-only-self-review',
  'lite-deterministic',
  'converged-substitution',
]);
const VERDICTS = new Set(['READY', 'NEEDS REVIEW', 'BLOCKED']);
const SEVERITIES = new Set(['HIGH', 'MEDIUM', 'LOW']);
const EVIDENCE_OUTCOMES = new Set(['pass', 'fail', 'not-run']);
const ARTIFACT_NAME = /^deep-verify-\d{6}\.md$/;
const SESSION_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
const FINDING_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COUNTS_MARKER = /<!-- deep-verify-counts:(\{[^\r\n]*\}) -->/g;
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const SENSITIVE_PATTERNS = [
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*["']?(?!<redacted>|\[redacted\])[A-Za-z0-9_./+=-]{8,}/i,
];

export class ArtifactContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArtifactContractError';
  }
}

function contractError(message) {
  return new ArtifactContractError(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  if (!isObject(value)) {
    throw contractError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw contractError(`${label} has invalid fields`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw contractError(`${label} must be a non-empty string`);
  }
}

function assertSafeContent(value) {
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(value))) {
    throw contractError('artifact contains sensitive evidence');
  }
}

function isValidIsoDate(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(ISO_DATE);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) return false;
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    return false;
  }
  if (zone !== 'Z') {
    const [zoneHour, zoneMinute] = zone.slice(1).split(':').map(Number);
    if (zoneHour > 14 || zoneMinute > 59 || (zoneHour === 14 && zoneMinute !== 0)) return false;
  }
  return Number.isFinite(Date.parse(value));
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: A bounded JSON string scanner is required to detect duplicate top-level keys before JSON.parse discards them.
function topLevelKeyCounts(jsonText) {
  const counts = new Map();
  let depth = 0;
  let index = 0;

  while (index < jsonText.length) {
    const character = jsonText[index];
    if (character === '{' || character === '[') {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === '}' || character === ']') {
      depth -= 1;
      index += 1;
      continue;
    }
    if (character !== '"') {
      index += 1;
      continue;
    }

    const start = index;
    index += 1;
    let escaped = false;
    while (index < jsonText.length) {
      const current = jsonText[index];
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === '"') {
        break;
      }
      index += 1;
    }
    if (index >= jsonText.length) break;
    const end = index;
    index += 1;
    let lookahead = index;
    while (/\s/.test(jsonText[lookahead] ?? '')) lookahead += 1;
    if (depth === 1 && jsonText[lookahead] === ':') {
      try {
        const key = JSON.parse(jsonText.slice(start, end + 1));
        counts.set(key, (counts.get(key) ?? 0) + 1);
      } catch {
        // JSON.parse below emits the canonical malformed-frontmatter error.
      }
    }
  }

  return counts;
}

function parseFrontmatter(content) {
  if (typeof content !== 'string' || !content.startsWith('---\n')) {
    throw contractError('artifact frontmatter is malformed');
  }
  const closingIndex = content.indexOf('\n---\n', 4);
  if (closingIndex < 0) {
    throw contractError('artifact frontmatter is malformed');
  }
  const jsonText = content.slice(4, closingIndex).trim();
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw contractError('artifact frontmatter is malformed');
  }
  if (!isObject(data)) {
    throw contractError('artifact frontmatter must contain one JSON object');
  }
  const counts = topLevelKeyCounts(jsonText);
  for (const field of REQUIRED_FIELDS) {
    if ((counts.get(field) ?? 0) > 1) {
      throw contractError('artifact has a duplicate required field');
    }
  }
  return { data, body: content.slice(closingIndex + 5), jsonText };
}

function validateFinding(finding) {
  assertExactKeys(
    finding,
    ['id', 'severity', 'file', 'line', 'summary', 'evidence'],
    'initial finding'
  );
  if (!FINDING_ID.test(finding.id ?? '')) {
    throw contractError('initial finding has an invalid id');
  }
  if (!SEVERITIES.has(finding.severity)) {
    throw contractError('initial finding has an invalid severity');
  }
  if (finding.file !== null) assertNonEmptyString(finding.file, 'initial finding file');
  if (finding.line !== null && (!Number.isInteger(finding.line) || finding.line < 1)) {
    throw contractError('initial finding line must be null or a positive integer');
  }
  if (finding.line !== null && finding.file === null) {
    throw contractError('initial finding line requires a file');
  }
  assertNonEmptyString(finding.summary, 'initial finding summary');
  assertNonEmptyString(finding.evidence, 'initial finding evidence');
}

function validateOutcome(outcome) {
  assertExactKeys(outcome, ['findingId', 'reason', 'evidence'], 'terminal finding outcome');
  if (!FINDING_ID.test(outcome.findingId ?? '')) {
    throw contractError('terminal finding outcome has an invalid finding id');
  }
  assertNonEmptyString(outcome.reason, 'terminal finding outcome reason');
  assertNonEmptyString(outcome.evidence, 'terminal finding outcome evidence');
}

function requireFindingBuckets(findings) {
  assertExactKeys(findings, FINDING_BUCKETS, 'findings');
  for (const bucket of FINDING_BUCKETS) {
    if (!Array.isArray(findings[bucket])) {
      throw contractError(`findings.${bucket} must be an array`);
    }
  }
}

function collectInitialIds(findings) {
  const initialIds = new Set();
  for (const finding of findings.initial) {
    validateFinding(finding);
    if (initialIds.has(finding.id)) {
      throw contractError('finding lifecycle contains a duplicate initial id');
    }
    initialIds.add(finding.id);
  }
  return initialIds;
}

function collectTerminalIds(findings, initialIds) {
  const terminalIds = new Set();
  for (const bucket of TERMINAL_BUCKETS) {
    const bucketIds = new Set();
    for (const outcome of findings[bucket]) {
      validateOutcome(outcome);
      if (bucketIds.has(outcome.findingId) || terminalIds.has(outcome.findingId)) {
        throw contractError('finding lifecycle contains a duplicate terminal id');
      }
      if (!initialIds.has(outcome.findingId)) {
        throw contractError('finding lifecycle contains an orphan terminal id');
      }
      bucketIds.add(outcome.findingId);
      terminalIds.add(outcome.findingId);
    }
  }
  return terminalIds;
}

function validateFindings(findings) {
  requireFindingBuckets(findings);
  const initialIds = collectInitialIds(findings);
  const terminalIds = collectTerminalIds(findings, initialIds);
  if (initialIds.size !== terminalIds.size) {
    throw contractError('finding lifecycle requires exactly one terminal outcome per initial id');
  }
}

function validateVerificationEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw contractError('verification evidence must be a non-empty array');
  }
  for (const entry of evidence) {
    assertExactKeys(entry, ['gate', 'outcome', 'reference'], 'verification evidence entry');
    assertNonEmptyString(entry.gate, 'verification evidence gate');
    if (!EVIDENCE_OUTCOMES.has(entry.outcome)) {
      throw contractError('verification evidence has an invalid outcome');
    }
    assertNonEmptyString(entry.reference, 'verification evidence reference');
  }
}

function validateArtifactObject(data) {
  assertExactKeys(data, REQUIRED_FIELDS, 'artifact');
  if (data.schemaVersion !== 1) throw contractError('unsupported artifact schema version');
  if (data.skill !== 'deep-verify') throw contractError('artifact skill must be deep-verify');
  if (!isValidIsoDate(data.date)) throw contractError('artifact date must be ISO-8601');
  assertNonEmptyString(data.query, 'artifact query');
  if (!REPOSITORY.test(data.repository ?? '')) {
    throw contractError('artifact repository must be owner/name');
  }
  if (!SEMVER.test(data.releaseVersion ?? '')) {
    throw contractError('artifact release version must be semver');
  }
  if (!SHA.test(data.verifiedSha ?? '')) {
    throw contractError('artifact verified SHA must be 40 lowercase hex characters');
  }
  if (!EXECUTION_MODES.has(data.executionMode)) {
    throw contractError('artifact execution mode is invalid');
  }
  if (!VERDICTS.has(data.verdict)) throw contractError('artifact verdict is invalid');
  validateFindings(data.findings);
  validateVerificationEvidence(data.verificationEvidence);
  assertSafeContent(JSON.stringify(data));
  return data;
}

function findingCounts(findings) {
  return Object.fromEntries(FINDING_BUCKETS.map((bucket) => [bucket, findings[bucket].length]));
}

function validateBody(body, findings) {
  if (typeof body !== 'string' || body.trim().length === 0) {
    throw contractError('artifact body must contain a human report');
  }
  const markerStarts = body.match(/<!--\s*deep-verify-counts:/g) ?? [];
  const matches = [...body.matchAll(COUNTS_MARKER)];
  if (markerStarts.length !== 1 || matches.length !== 1) {
    throw contractError('artifact body must contain exactly one structured count marker');
  }
  let bodyCounts;
  try {
    bodyCounts = JSON.parse(matches[0][1]);
  } catch {
    throw contractError('artifact body count marker is malformed');
  }
  assertExactKeys(bodyCounts, FINDING_BUCKETS, 'artifact body counts');
  const expected = findingCounts(findings);
  for (const bucket of FINDING_BUCKETS) {
    if (!Number.isInteger(bodyCounts[bucket]) || bodyCounts[bucket] < 0) {
      throw contractError('artifact body count marker is malformed');
    }
    if (bodyCounts[bucket] !== expected[bucket]) {
      throw contractError('artifact body count mismatch');
    }
  }
  assertSafeContent(body);
}

export function validateArtifactContent(content) {
  if (Buffer.byteLength(content, 'utf8') > MAX_ARTIFACT_BYTES) {
    throw contractError('artifact exceeds the size limit');
  }
  const { data, body } = parseFrontmatter(content);
  validateArtifactObject(data);
  validateBody(body, data.findings);
  return data;
}

export function serializeArtifact(artifact, body) {
  const data = validateArtifactObject(structuredClone(artifact));
  if (typeof body !== 'string' || body.trim().length === 0) {
    throw contractError('artifact body must contain a human report');
  }
  COUNTS_MARKER.lastIndex = 0;
  if (COUNTS_MARKER.test(body)) {
    COUNTS_MARKER.lastIndex = 0;
    throw contractError('artifact body already contains a structured count marker');
  }
  COUNTS_MARKER.lastIndex = 0;
  assertSafeContent(body);
  const counts = JSON.stringify(findingCounts(data.findings));
  const normalizedBody = body.trimEnd();
  const content = `---\n${JSON.stringify(data, null, 2)}\n---\n${normalizedBody}\n\n<!-- deep-verify-counts:${counts} -->\n`;
  validateArtifactContent(content);
  return content;
}

function sameFileFingerprint(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameDirectoryIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid
  );
}

function requireRegularSingletonInfo(info, label) {
  if (info.isSymbolicLink() || !info.isFile()) {
    throw contractError(`${label} is not a regular file`);
  }
  if (info.nlink !== 1n) throw contractError(`${label} is hard-linked`);
  if (info.size > BigInt(MAX_ARTIFACT_BYTES)) {
    throw contractError(`${label} exceeds the size limit`);
  }
}

async function readBounded(handle, label) {
  const chunks = [];
  let total = 0;
  while (true) {
    const remaining = MAX_ARTIFACT_BYTES + 1 - total;
    if (remaining <= 0) throw contractError(`${label} exceeds the size limit`);
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    chunks.push(buffer.subarray(0, bytesRead));
  }
  if (total > MAX_ARTIFACT_BYTES) throw contractError(`${label} exceeds the size limit`);
  return Buffer.concat(chunks, total);
}

async function readRegularSingleton(path, label, options = {}) {
  let before;
  try {
    before = await lstat(path, { bigint: true });
  } catch {
    throw contractError(`${label} is not a readable regular file`);
  }
  requireRegularSingletonInfo(before, label);
  if (options.expectedIdentity && !sameFileIdentity(before, options.expectedIdentity)) {
    throw contractError(`${label} inode does not match the staged artifact`);
  }

  let handle;
  try {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    const nonBlock = constants.O_NONBLOCK ?? 0;
    handle = await open(path, constants.O_RDONLY | noFollow | nonBlock);
  } catch {
    throw contractError(`${label} is not a readable regular file`);
  }
  try {
    const opened = await handle.stat({ bigint: true });
    requireRegularSingletonInfo(opened, label);
    if (!sameFileFingerprint(before, opened)) {
      throw contractError(`${label} changed before readback`);
    }
    await options.afterOpen?.({ path });
    const bytes = await readBounded(handle, label);
    await options.afterRead?.({ path, bytes });
    const after = await handle.stat({ bigint: true });
    let pathAfter;
    try {
      pathAfter = await lstat(path, { bigint: true });
    } catch {
      throw contractError(`${label} path changed during readback`);
    }
    requireRegularSingletonInfo(after, label);
    requireRegularSingletonInfo(pathAfter, label);
    if (!sameFileFingerprint(opened, after) || !sameFileFingerprint(after, pathAfter)) {
      throw contractError(`${label} fingerprint changed during readback`);
    }
    if (options.expectedContent !== undefined) {
      const expected = Buffer.from(options.expectedContent, 'utf8');
      if (!bytes.equals(expected)) {
        throw contractError(`${label} bytes do not exactly match the serialized artifact`);
      }
    }
    return bytes.toString('utf8');
  } finally {
    await handle.close();
  }
}

export async function validateArtifactFile(path, dependencies = {}) {
  const content = await readRegularSingleton(path, 'artifact', dependencies);
  return validateArtifactContent(content);
}

async function requireDirectoryInfo(path, label) {
  let info;
  try {
    info = await lstat(path, { bigint: true });
  } catch {
    throw contractError(`${label} is not a directory`);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw contractError(`${label} is a symlink or not a directory`);
  }
  return info;
}

function assertDirectoryIdentity(expected, actual, label) {
  if (!sameDirectoryIdentity(expected, actual)) {
    throw contractError(`${label} directory identity changed`);
  }
}

function safePathComponent(component) {
  return (
    typeof component === 'string' &&
    component.length > 0 &&
    component !== '.' &&
    component !== '..' &&
    !component.includes('/') &&
    !component.includes('\\')
  );
}

let cwdCriticalTail = Promise.resolve();

async function withCwdCriticalSection(action) {
  const previous = cwdCriticalTail;
  let release;
  cwdCriticalTail = new Promise((resolveLock) => {
    release = resolveLock;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

async function createRelativeDirectory(component) {
  try {
    await mkdir(component, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw contractError('artifact output directory creation failed');
    }
  }
}

async function inspectRelativeDirectory(component, options) {
  let info;
  try {
    info = await lstat(component, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT' && options.allowMissing) return null;
    throw contractError('artifact path component is not a directory');
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw contractError('artifact path component is a symlink or not a directory');
  }
  return info;
}

async function unwindPinnedFrames(frames) {
  let failure;
  for (let index = frames.length - 1; index > 0; index -= 1) {
    const child = frames[index];
    const parent = frames[index - 1];
    try {
      assertDirectoryIdentity(child.info, await lstat('.', { bigint: true }), 'pinned child');
      process.chdir('..');
      assertDirectoryIdentity(parent.info, await lstat('.', { bigint: true }), 'pinned parent');
      const childAfter = await requireDirectoryInfo(child.component, 'pinned child path');
      assertDirectoryIdentity(child.info, childAfter, 'pinned child path');
    } catch (error) {
      failure ??= error;
      break;
    }
  }
  return failure;
}

async function verifyAbsoluteFrames(frames) {
  for (const frame of frames) {
    const after = await requireDirectoryInfo(frame.absolutePath, 'artifact absolute path');
    assertDirectoryIdentity(frame.info, after, 'artifact absolute path');
  }
}

async function verifyPinnedAncestry(frames) {
  let cursor = '.';
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const actual = await requireDirectoryInfo(cursor, 'pinned artifact ancestry');
    assertDirectoryIdentity(frames[index].info, actual, 'pinned artifact ancestry');
    cursor = join(cursor, '..');
  }
}

const PINNED_PATH_MISSING = Symbol('pinned-path-missing');

async function enterPinnedProjectPath(rootPath, rootInfo, components, options, frames) {
  process.chdir(rootPath);
  assertDirectoryIdentity(rootInfo, await lstat('.', { bigint: true }), 'project root');
  for (const component of components) {
    if (!safePathComponent(component)) {
      throw contractError('artifact path component is invalid');
    }
    if (options.create) await createRelativeDirectory(component);
    const info = await inspectRelativeDirectory(component, options);
    if (info === null) return false;
    const absolutePath = join(frames.at(-1).absolutePath, component);
    process.chdir(component);
    frames.push({ component, absolutePath, info });
    assertDirectoryIdentity(info, await lstat('.', { bigint: true }), 'entered artifact path');
  }
  return true;
}

async function restorePinnedContext(originalCwd, originalInfo, frames) {
  let failure = await unwindPinnedFrames(frames);
  try {
    process.chdir(originalCwd);
    assertDirectoryIdentity(originalInfo, await lstat('.', { bigint: true }), 'restored cwd');
    await verifyAbsoluteFrames(frames);
  } catch (error) {
    failure ??= error;
  }
  return failure;
}

async function runPinnedProjectPath(projectRoot, components, options, action) {
  const originalCwd = process.cwd();
  const originalInfo = await requireDirectoryInfo(originalCwd, 'original cwd');
  const rootPath = resolve(projectRoot);
  const rootInfo = await requireDirectoryInfo(rootPath, 'project root');
  const frames = [{ component: null, absolutePath: rootPath, info: rootInfo }];
  let result;
  let failure;

  try {
    const complete = await enterPinnedProjectPath(rootPath, rootInfo, components, options, frames);
    result = complete
      ? await action({
          absolutePath: frames.at(-1).absolutePath,
          verifyPinnedPath: () => verifyPinnedAncestry(frames),
        })
      : PINNED_PATH_MISSING;
  } catch (error) {
    failure = error;
  }

  const restoreFailure = await restorePinnedContext(originalCwd, originalInfo, frames);
  failure ??= restoreFailure;
  if (failure) throw failure;
  return result;
}

async function withPinnedProjectPath(projectRoot, components, options, action) {
  return withCwdCriticalSection(() =>
    runPinnedProjectPath(projectRoot, components, options, action)
  );
}

async function withPinnedChildDirectory(component, action) {
  if (!safePathComponent(component)) throw contractError('session date component is invalid');
  const parentInfo = await requireDirectoryInfo('.', 'pinned session parent');
  const childInfo = await requireDirectoryInfo(component, 'canonical session date entry');
  let result;
  let failure;
  process.chdir(component);
  try {
    assertDirectoryIdentity(childInfo, await lstat('.', { bigint: true }), 'session date');
    result = await action();
    assertDirectoryIdentity(childInfo, await lstat('.', { bigint: true }), 'session date');
  } catch (error) {
    failure = error;
  }
  try {
    process.chdir('..');
    assertDirectoryIdentity(parentInfo, await lstat('.', { bigint: true }), 'session parent');
    const childAfter = await requireDirectoryInfo(component, 'canonical session date entry');
    assertDirectoryIdentity(childInfo, childAfter, 'canonical session date entry');
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
  return result;
}

async function relativePathExists(path) {
  try {
    await lstat(path, { bigint: true });
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw contractError('artifact collision check failed');
  }
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY);
    await handle.sync();
  } catch {
    // Some supported platforms do not permit directory fsync. File fsync and
    // atomic no-replace publication remain mandatory and already completed.
  } finally {
    await handle?.close();
  }
}

async function unlinkExactIdentity(path, identity) {
  if (!identity) return false;
  try {
    const current = await lstat(path, { bigint: true });
    if (!sameFileIdentity(current, identity)) return false;
    await unlink(path);
    return true;
  } catch {
    // Missing paths and unknown replacements are preserved for manual inspection.
    return false;
  }
}

async function writePinnedArtifact(content, time, dependencies, verifyPinnedPath) {
  const finalName = `deep-verify-${time}.md`;
  if (await relativePathExists(finalName))
    throw contractError('deep-verify artifact already exists');
  const temporaryName = `.deep-verify-${time}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let handle;
  let finalCreated = false;
  let completed = false;
  let stagedIdentity;
  try {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    handle = await open(
      temporaryName,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600
    );
    const info = await handle.stat({ bigint: true });
    requireRegularSingletonInfo(info, 'artifact temporary file');
    stagedIdentity = info;
    await handle.writeFile(content, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = undefined;

    await dependencies.afterStageSync?.({ temporaryPath: temporaryName });
    await readRegularSingleton(temporaryName, 'artifact temporary file', {
      expectedContent: content,
      expectedIdentity: stagedIdentity,
    });
    try {
      await link(temporaryName, finalName);
    } catch (error) {
      if (error?.code === 'EEXIST') throw contractError('deep-verify artifact already exists');
      throw contractError('artifact atomic publication failed');
    }
    finalCreated = true;
    if (!(await unlinkExactIdentity(temporaryName, stagedIdentity))) {
      throw contractError('artifact temporary file identity changed before publication');
    }
    await dependencies.afterPublish?.({ finalPath: finalName });
    await syncDirectory('.');
    const finalContent = await readRegularSingleton(finalName, 'published artifact', {
      expectedContent: content,
      expectedIdentity: stagedIdentity,
    });
    const artifact = validateArtifactContent(finalContent);
    await verifyPinnedPath();
    completed = true;
    return { finalName, artifact };
  } finally {
    await handle?.close();
    await unlinkExactIdentity(temporaryName, stagedIdentity);
    if (finalCreated && !completed) {
      await unlinkExactIdentity(finalName, stagedIdentity);
    }
  }
}

export async function writeArtifact({ projectRoot, artifact, body, dependencies = {} }) {
  const content = serializeArtifact(artifact, body);
  const validated = validateArtifactContent(content);
  const day = validated.date.slice(0, 10);
  const time = validated.date.slice(11, 19).replaceAll(':', '');
  if (!SESSION_DATE.test(day) || !/^\d{6}$/.test(time)) {
    throw contractError('artifact date cannot form the canonical path');
  }
  const result = await withPinnedProjectPath(
    projectRoot,
    ['.codex', 'outputs', 'sessions', day],
    { create: true, allowMissing: false },
    async ({ absolutePath, verifyPinnedPath }) => {
      const written = await writePinnedArtifact(content, time, dependencies, verifyPinnedPath);
      return { path: join(absolutePath, written.finalName), artifact: written.artifact };
    }
  );
  return result;
}

async function readPinnedDayCandidates(sessionPath, day) {
  const candidates = [];
  const entries = await readdir('.', { withFileTypes: true });
  for (const entry of entries) {
    if (!ARTIFACT_NAME.test(entry.name)) continue;
    const content = await readRegularSingleton(entry.name, 'artifact candidate');
    candidates.push({ path: join(sessionPath, day, entry.name), content });
  }
  return candidates;
}

async function discoverCandidates(projectRoot) {
  const result = await withPinnedProjectPath(
    projectRoot,
    ['.codex', 'outputs', 'sessions'],
    { create: false, allowMissing: true },
    async ({ absolutePath }) => {
      const candidates = [];
      const days = await readdir('.', { withFileTypes: true });
      for (const day of days) {
        if (!SESSION_DATE.test(day.name)) continue;
        candidates.push(
          ...(await withPinnedChildDirectory(day.name, () =>
            readPinnedDayCandidates(absolutePath, day.name)
          ))
        );
      }
      return candidates.sort((left, right) => left.path.localeCompare(right.path));
    }
  );
  return result === PINNED_PATH_MISSING ? [] : result;
}

function rawFrontmatterForMetadata(content) {
  if (typeof content === 'string' && content.startsWith('---\n')) {
    const closingIndex = content.indexOf('\n---\n', 4);
    return closingIndex < 0 ? content.slice(4, 64 * 1024) : content.slice(4, closingIndex);
  }
  return '';
}

function decodeCandidateMetadata(content) {
  const raw = rawFrontmatterForMetadata(content);
  try {
    const parsed = JSON.parse(raw);
    if (isObject(parsed)) {
      return {
        decoded: true,
        metadata: {
          repository: typeof parsed.repository === 'string' ? parsed.repository : null,
          releaseVersion: typeof parsed.releaseVersion === 'string' ? parsed.releaseVersion : null,
          verifiedSha: typeof parsed.verifiedSha === 'string' ? parsed.verifiedSha : null,
          date: typeof parsed.date === 'string' && isValidIsoDate(parsed.date) ? parsed.date : null,
        },
      };
    }
  } catch {
    return { decoded: false, metadata: null };
  }
  return {
    decoded: true,
    metadata: { repository: null, releaseVersion: null, verifiedSha: null, date: null },
  };
}

function compareCandidate(left, right) {
  const dateOrder = Date.parse(right.date) - Date.parse(left.date);
  if (dateOrder !== 0) return dateOrder;
  return left.lexicalPath.localeCompare(right.lexicalPath);
}

function malformedCouldMatch(metadata, expected) {
  for (const key of ['repository', 'releaseVersion', 'verifiedSha']) {
    if (metadata[key] !== null && metadata[key] !== expected[key]) return false;
  }
  return true;
}

function validateSelectorArguments(repository, releaseVersion, verifiedSha) {
  if (
    !REPOSITORY.test(repository ?? '') ||
    !SEMVER.test(releaseVersion ?? '') ||
    !SHA.test(verifiedSha ?? '')
  ) {
    throw contractError('deep-verify selector arguments are invalid');
  }
}

function classifyCandidate(candidate, projectRoot, expected) {
  const { path, content } = candidate;
  const lexicalPath = relative(resolve(projectRoot), path).split(sep).join('/');
  try {
    const artifact = validateArtifactContent(content);
    const exact =
      artifact.repository === expected.repository &&
      artifact.releaseVersion === expected.releaseVersion &&
      artifact.verifiedSha === expected.verifiedSha;
    return exact
      ? { kind: 'valid', path, lexicalPath, date: artifact.date, artifact }
      : { kind: 'irrelevant' };
  } catch {
    const decoded = decodeCandidateMetadata(content);
    if (!decoded.decoded) return { kind: 'undecodable' };
    const metadata = decoded.metadata;
    return malformedCouldMatch(metadata, expected)
      ? { kind: 'malformed', path, lexicalPath, date: metadata.date }
      : { kind: 'irrelevant' };
  }
}

function assertMalformedDoesNotSupersede(malformed, selected) {
  if (malformed.length === 0) return;
  if (selected === undefined) throw contractError('newest relevant artifact is malformed');
  for (const candidate of malformed) {
    if (candidate.date === null || compareCandidate(candidate, selected) < 0) {
      throw contractError('newest relevant artifact is malformed');
    }
  }
}

export async function selectArtifact({ projectRoot, repository, releaseVersion, verifiedSha }) {
  validateSelectorArguments(repository, releaseVersion, verifiedSha);
  const expected = { repository, releaseVersion, verifiedSha };
  const valid = [];
  const malformed = [];
  let hasUndecodableCandidate = false;
  for (const path of await discoverCandidates(projectRoot)) {
    const candidate = await classifyCandidate(path, projectRoot, expected);
    if (candidate.kind === 'valid') valid.push(candidate);
    if (candidate.kind === 'malformed') malformed.push(candidate);
    if (candidate.kind === 'undecodable') hasUndecodableCandidate = true;
  }

  if (hasUndecodableCandidate) {
    throw contractError('canonical artifact JSON cannot be decoded');
  }
  valid.sort(compareCandidate);
  const selected = valid[0];
  assertMalformedDoesNotSupersede(malformed, selected);
  if (selected === undefined) throw contractError('no matching deep-verify artifact');
  return { path: selected.path, artifact: selected.artifact };
}

function parseOptions(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw contractError('artifact command arguments are invalid');
    }
    if (options.has(name)) throw contractError('artifact command argument is duplicated');
    options.set(name, value);
  }
  return options;
}

function requireOptions(options, expected) {
  if (options.size !== expected.length || expected.some((name) => !options.has(name))) {
    throw contractError('artifact command arguments are invalid');
  }
}

async function readInput(path) {
  const content = await readRegularSingleton(path, 'artifact command input');
  let input;
  try {
    input = JSON.parse(content);
  } catch {
    throw contractError('artifact command input is malformed');
  }
  assertExactKeys(input, ['artifact', 'body'], 'artifact command input');
  return input;
}

async function runCli() {
  const [command, ...args] = process.argv.slice(2);
  const options = parseOptions(args);
  let projection;
  if (command === 'write') {
    requireOptions(options, ['--project-root', '--input']);
    const input = await readInput(options.get('--input'));
    projection = await writeArtifact({
      projectRoot: options.get('--project-root'),
      artifact: input.artifact,
      body: input.body,
    });
  } else if (command === 'validate') {
    requireOptions(options, ['--file']);
    const path = resolve(options.get('--file'));
    projection = { path, artifact: await validateArtifactFile(path) };
  } else if (command === 'select') {
    requireOptions(options, [
      '--project-root',
      '--repository',
      '--release-version',
      '--verified-sha',
    ]);
    projection = await selectArtifact({
      projectRoot: options.get('--project-root'),
      repository: options.get('--repository'),
      releaseVersion: options.get('--release-version'),
      verifiedSha: options.get('--verified-sha'),
    });
  } else {
    throw contractError('expected write, validate, or select command');
  }
  process.stdout.write(`${JSON.stringify(projection)}\n`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  runCli().catch((error) => {
    const message =
      error instanceof ArtifactContractError ? error.message : 'artifact command failed';
    process.stderr.write(`artifact-contract: ${message}\n`);
    process.exitCode = 1;
  });
}
