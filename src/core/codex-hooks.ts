/**
 * Codex-native hook registry compilation and installation.
 *
 * The packaged Claude registry remains an upstream compatibility source. This
 * module emits a separate project registry that only claims behavior Codex can
 * currently discover and execute.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  copyFile,
  deleteFile,
  fileExists,
  prevalidateSafeWritePath,
  readJsonFile,
  resolveTemplatePath,
  writeJsonFile,
} from '../utils/fs.js';

const DEFAULT_TIMEOUT_SECONDS = 30;

const NATIVE_EVENTS = new Set([
  'SessionStart',
  'SubagentStart',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'UserPromptSubmit',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
]);

const TOOL_MATCHER_EVENTS = new Set(['PreToolUse', 'PermissionRequest', 'PostToolUse']);
const MATCHER_IGNORED_EVENTS = new Set(['UserPromptSubmit', 'Stop']);
const SELF_FILTERING_PREDICATE_SCRIPTS = new Set(['destructive-git-guard.sh']);
const NATIVE_VALIDATED_SCRIPT_NAMES = [
  'destructive-git-guard.sh',
  'file-change-validator.sh',
  'schema-validator.sh',
  'secret-filter.sh',
] as const;
const NATIVE_VALIDATED_SCRIPTS = new Set<string>(NATIVE_VALIDATED_SCRIPT_NAMES);
export const CODEX_NATIVE_HOOK_WRAPPER_SCRIPT = 'codex-native-advisory.sh';

const NATIVE_TOOL_NAMES: Record<string, string> = {
  Bash: 'Bash',
  Edit: 'apply_patch',
  Write: 'apply_patch',
  apply_patch: 'apply_patch',
};

export interface CodexHookCommandHandler {
  type: 'command';
  command: string;
  timeout?: number;
  [key: string]: unknown;
}

export interface CodexHookMatcherGroup {
  matcher?: string;
  hooks: CodexHookCommandHandler[];
  [key: string]: unknown;
}

export interface CodexHookRegistry {
  hooks: Record<string, CodexHookMatcherGroup[]>;
  [key: string]: unknown;
}

export interface HookCompatibilityEntry {
  event: string;
  reason:
    | 'unsupported_event'
    | 'unsupported_handler_type'
    | 'unsupported_match_predicate'
    | 'unsupported_tool_name'
    | 'unvalidated_native_handler'
    | 'invalid_handler';
  matcher?: string;
  command?: string;
  detail?: string;
}

export interface HookMigrationEntry {
  sourceEvent: string;
  targetEvent: string;
  reason: string;
  command: string;
}

export interface HookCompatibilityGroup {
  sourceEvent: string;
  sourceGroupIndex: number;
  disposition: 'native' | 'migrated' | 'excluded';
  targetEvent?: string;
}

export interface CodexHookCompatibilityRecord {
  version: 1;
  source: 'templates/.claude/hooks/hooks.json';
  registrySha256: string;
  groups: HookCompatibilityGroup[];
  excluded: HookCompatibilityEntry[];
  migrated: HookMigrationEntry[];
}

export interface CodexHooksCompilation {
  registry: CodexHookRegistry;
  compatibility: CodexHookCompatibilityRecord;
}

export interface CompileCodexHooksOptions {
  /** Canonical checkout that owns the emitted registry and managed scripts. */
  authoritativeRoot?: string;
}

interface SourceHandler {
  type?: unknown;
  command?: unknown;
  timeout?: unknown;
  statusMessage?: unknown;
  commandWindows?: unknown;
}

interface SourceMatcherGroup {
  matcher?: unknown;
  hooks?: unknown;
}

interface SourceRegistry {
  hooks?: unknown;
}

export interface InstallNativeCodexHooksOptions {
  /** Replace managed script files while preserving pre-existing registry handlers. */
  overwrite?: boolean;
  /** @deprecated Registry installation always merges; retained for caller compatibility. */
  forceRegistry?: boolean;
  /** Test/integration override for the packaged Claude compatibility source. */
  sourceRoot?: string;
}

export interface InstallNativeCodexHooksResult {
  installed: boolean;
  registryPath: string;
  scriptsPath: string;
  compatibilityPath: string;
  registryPreserved: boolean;
  activeScriptPaths: string[];
  removedStaleManagedPaths: string[];
  preservedCustomPaths: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sourceHooks(source: unknown): Record<string, SourceMatcherGroup[]> {
  if (!isRecord(source) || !isRecord((source as SourceRegistry).hooks)) {
    throw new Error('Invalid Claude hook registry: expected a hooks object');
  }

  const sourceHookMap = (source as { hooks: Record<string, unknown> }).hooks;
  const hooks: Record<string, SourceMatcherGroup[]> = {};
  for (const [event, groups] of Object.entries(sourceHookMap)) {
    if (!Array.isArray(groups)) {
      throw new Error(`Invalid Claude hook registry: ${event} must be an array`);
    }
    hooks[event] = groups.filter(isRecord) as SourceMatcherGroup[];
  }
  return hooks;
}

function sourceHandlers(group: SourceMatcherGroup): SourceHandler[] {
  return Array.isArray(group.hooks) ? (group.hooks.filter(isRecord) as SourceHandler[]) : [];
}

function finiteTimeout(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_TIMEOUT_SECONDS;
}

function shellQuoteDouble(value: string): string {
  return value.replace(/["\\$`]/g, '\\$&');
}

function managedRootPrelude(authoritativeRoot?: string): string {
  const rootAssignment = authoritativeRoot
    ? `repo_root="${shellQuoteDouble(resolve(authoritativeRoot))}"`
    : 'repo_root="$(git rev-parse --show-toplevel)"';
  return `${rootAssignment} && cd "$repo_root"`;
}

function rewriteManagedHookCommand(command: string, authoritativeRoot?: string): string {
  const match = command.match(/^(?:(bash)\s+)?\.codex\/hooks\/([^\s"';&|]+)([\s\S]*)$/);
  if (!match) return command;

  const [, interpreter, relativePath, suffix] = match;
  const invocation = interpreter
    ? `${interpreter} "$repo_root/.codex/hooks/${shellQuoteDouble(relativePath)}"`
    : `"$repo_root/.codex/hooks/${shellQuoteDouble(relativePath)}"`;
  return `${managedRootPrelude(authoritativeRoot)} && ${invocation}${suffix}`;
}

function commandScriptName(command: string): string | null {
  const managed = command.match(/# omcustomcodex-hook:([^\s#]+\.sh)\s*$/);
  if (managed) return managed[1];
  const match = command.match(/\.codex\/hooks\/(?:scripts\/)?([^\s"';&|/]+\.sh)/);
  return match?.[1] ?? null;
}

function nativeWrapperCommand(scriptName: string, authoritativeRoot?: string): string {
  const escaped = shellQuoteDouble(scriptName);
  return `${managedRootPrelude(authoritativeRoot)} && bash "$repo_root/.codex/hooks/scripts/codex-native-advisory.sh" "${escaped}" # omcustomcodex-hook:${escaped}`;
}

function convertHandler(
  handler: SourceHandler,
  authoritativeRoot?: string
): CodexHookCommandHandler | null {
  if (handler.type !== undefined && handler.type !== 'command') return null;
  if (typeof handler.command !== 'string' || handler.command.trim() === '') return null;

  return {
    type: 'command',
    command: rewriteManagedHookCommand(handler.command, authoritativeRoot),
    timeout: finiteTimeout(handler.timeout),
  };
}

function validatedNativeHandler(
  handler: SourceHandler,
  authoritativeRoot?: string
): CodexHookCommandHandler | null {
  const converted = convertHandler(handler, authoritativeRoot);
  if (!converted) return null;
  const scriptName = commandScriptName(converted.command);
  if (!scriptName || !NATIVE_VALIDATED_SCRIPTS.has(scriptName)) return null;

  return { ...converted, command: nativeWrapperCommand(scriptName, authoritativeRoot) };
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nativeToolMatcher(toolNames: string[]): string | null {
  const nativeNames = [
    ...new Set(toolNames.map((name) => NATIVE_TOOL_NAMES[name]).filter(Boolean)),
  ].sort();
  if (nativeNames.length === 0) return null;
  if (nativeNames.length === 1) return `^${regexEscape(nativeNames[0])}$`;
  return `^(?:${nativeNames.map(regexEscape).join('|')})$`;
}

function extractToolNames(matcher: string): string[] {
  return [...matcher.matchAll(/tool\s*==\s*"([^"]+)"/g)].map((match) => match[1]);
}

function isPlainToolExpression(matcher: string): boolean {
  const remainder = matcher.replace(/tool\s*==\s*"[^"]+"/g, '').replace(/\|\||&&|[()\s]/g, '');
  return remainder.length === 0;
}

function convertToolMatcher(matcher: string): { matcher: string | null; unsupported: string[] } {
  const regexMatch = matcher.match(/^tool\s+matches\s+"([^"]+)"$/);
  if (regexMatch) {
    const regex = regexMatch[1];
    if (!regex.startsWith('^mcp__') && !regex.startsWith('mcp__')) {
      return { matcher: null, unsupported: [regex] };
    }
    try {
      new RegExp(regex);
      return { matcher: regex, unsupported: [] };
    } catch {
      return { matcher: null, unsupported: [regex] };
    }
  }

  if (!isPlainToolExpression(matcher)) return { matcher: null, unsupported: [] };
  const toolNames = extractToolNames(matcher);
  return {
    matcher: nativeToolMatcher(toolNames),
    unsupported: toolNames.filter((name) => !NATIVE_TOOL_NAMES[name]),
  };
}

function addGroup(
  registry: CodexHookRegistry,
  event: string,
  matcher: string | undefined,
  handlers: CodexHookCommandHandler[]
): void {
  if (handlers.length === 0) return;
  const groups = registry.hooks[event] ?? [];
  const existing = groups.find((group) => group.matcher === matcher);
  if (existing) {
    existing.hooks.push(...handlers);
  } else {
    groups.push({ ...(matcher ? { matcher } : {}), hooks: handlers });
  }
  registry.hooks[event] = groups;
}

function recordUnsupportedHandlers(
  event: string,
  matcher: string | undefined,
  handlers: SourceHandler[],
  compatibility: CodexHookCompatibilityRecord
): void {
  for (const handler of handlers) {
    if (handler.type !== undefined && handler.type !== 'command') {
      compatibility.excluded.push({
        event,
        matcher,
        reason: 'unsupported_handler_type',
        detail: String(handler.type),
      });
    } else if (typeof handler.command !== 'string' || handler.command.trim() === '') {
      compatibility.excluded.push({
        event,
        matcher,
        reason: 'invalid_handler',
      });
    }
  }
}

function compileFileChangedCompatibility(
  group: SourceMatcherGroup,
  registry: CodexHookRegistry,
  compatibility: CodexHookCompatibilityRecord,
  authoritativeRoot?: string
): void {
  const matcher = typeof group.matcher === 'string' ? group.matcher : undefined;
  const handlers = sourceHandlers(group);
  recordUnsupportedHandlers('FileChanged', matcher, handlers, compatibility);

  for (const handler of handlers) {
    const converted = convertHandler(handler, authoritativeRoot);
    const validated = validatedNativeHandler(handler, authoritativeRoot);
    if (!validated || commandScriptName(validated.command) !== 'file-change-validator.sh') {
      if (converted) {
        compatibility.excluded.push({
          event: 'FileChanged',
          matcher,
          reason: 'unsupported_event',
          command: converted.command,
        });
      }
      continue;
    }
    addGroup(registry, 'PostToolUse', '^apply_patch$', [validated]);
    compatibility.migrated.push({
      sourceEvent: 'FileChanged',
      targetEvent: 'PostToolUse',
      reason: 'Codex has no FileChanged event; the validator inspects apply_patch payloads',
      command: validated.command,
    });
  }
}

function compilePredicateGroup(
  event: string,
  matcher: string,
  handlers: SourceHandler[],
  registry: CodexHookRegistry,
  compatibility: CodexHookCompatibilityRecord,
  authoritativeRoot?: string
): void {
  const toolMatcher = nativeToolMatcher(extractToolNames(matcher));
  for (const handler of handlers) {
    const converted = convertHandler(handler, authoritativeRoot);
    const validated = validatedNativeHandler(handler, authoritativeRoot);
    const scriptName = validated ? commandScriptName(validated.command) : null;
    if (
      validated &&
      scriptName &&
      SELF_FILTERING_PREDICATE_SCRIPTS.has(scriptName) &&
      toolMatcher
    ) {
      addGroup(registry, event, toolMatcher, [validated]);
      compatibility.migrated.push({
        sourceEvent: event,
        targetEvent: event,
        reason: 'Advisory only (exit 0): matcher predicate is enforced inside the managed script',
        command: validated.command,
      });
      continue;
    }
    if (converted) {
      compatibility.excluded.push({
        event,
        matcher,
        reason: 'unsupported_match_predicate',
        command: converted.command,
      });
    }
  }
}

function recordUnvalidatedNativeHandlers(
  event: string,
  matcher: string | undefined,
  handlers: SourceHandler[],
  compatibility: CodexHookCompatibilityRecord,
  authoritativeRoot?: string
): void {
  for (const handler of handlers) {
    const converted = convertHandler(handler, authoritativeRoot);
    if (converted && !validatedNativeHandler(handler, authoritativeRoot)) {
      compatibility.excluded.push({
        event,
        matcher,
        reason: 'unvalidated_native_handler',
        command: converted.command,
      });
    }
  }
}

function nativeHandlerCount(registry: CodexHookRegistry): number {
  return Object.values(registry.hooks).reduce(
    (count, groups) =>
      count + groups.reduce((groupCount, group) => groupCount + group.hooks.length, 0),
    0
  );
}

function recordGroupCompatibility(
  event: string,
  sourceGroupIndex: number,
  nativeCountBefore: number,
  migrationCountBefore: number,
  registry: CodexHookRegistry,
  compatibility: CodexHookCompatibilityRecord
): void {
  const migration = compatibility.migrated[migrationCountBefore];
  const nativeAdded = nativeHandlerCount(registry) > nativeCountBefore;
  compatibility.groups.push({
    sourceEvent: event,
    sourceGroupIndex,
    disposition: migration ? 'migrated' : nativeAdded ? 'native' : 'excluded',
    ...(migration
      ? { targetEvent: migration.targetEvent }
      : nativeAdded
        ? { targetEvent: event }
        : {}),
  });
}

function normalizedSourceMatcher(group: SourceMatcherGroup): string | undefined {
  const rawMatcher = typeof group.matcher === 'string' ? group.matcher.trim() : '';
  return rawMatcher && rawMatcher !== '*' ? rawMatcher : undefined;
}

function excludeConvertedHandlers(
  event: string,
  matcher: string | undefined,
  handlers: SourceHandler[],
  reason: HookCompatibilityEntry['reason'],
  compatibility: CodexHookCompatibilityRecord,
  authoritativeRoot?: string
): void {
  for (const handler of handlers) {
    const converted = convertHandler(handler, authoritativeRoot);
    if (converted) {
      compatibility.excluded.push({ event, matcher, reason, command: converted.command });
    }
  }
}

function compileUnsupportedEventGroup(
  event: string,
  group: SourceMatcherGroup,
  compatibility: CodexHookCompatibilityRecord,
  authoritativeRoot?: string
): void {
  const matcher = normalizedSourceMatcher(group);
  const handlers = sourceHandlers(group);
  recordUnsupportedHandlers(event, matcher, handlers, compatibility);
  excludeConvertedHandlers(
    event,
    matcher,
    handlers,
    'unsupported_event',
    compatibility,
    authoritativeRoot
  );
}

interface NativeMatcherResolution {
  accepted: boolean;
  matcher?: string;
}

function resolveNativeMatcher(
  event: string,
  matcher: string | undefined,
  handlers: SourceHandler[],
  compatibility: CodexHookCompatibilityRecord,
  authoritativeRoot?: string
): NativeMatcherResolution {
  if (!TOOL_MATCHER_EVENTS.has(event) || !matcher) {
    return { accepted: true, matcher: MATCHER_IGNORED_EVENTS.has(event) ? undefined : matcher };
  }

  const converted = convertToolMatcher(matcher);
  if (!converted.matcher) {
    excludeConvertedHandlers(
      event,
      matcher,
      handlers,
      'unsupported_match_predicate',
      compatibility,
      authoritativeRoot
    );
    return { accepted: false };
  }

  for (const unsupportedName of converted.unsupported) {
    compatibility.excluded.push({
      event,
      matcher,
      reason: 'unsupported_tool_name',
      detail: unsupportedName,
    });
  }
  return { accepted: true, matcher: converted.matcher };
}

function compileNativeGroup(
  event: string,
  group: SourceMatcherGroup,
  registry: CodexHookRegistry,
  compatibility: CodexHookCompatibilityRecord,
  authoritativeRoot?: string
): void {
  const matcher = normalizedSourceMatcher(group);
  const handlers = sourceHandlers(group);
  recordUnsupportedHandlers(event, matcher, handlers, compatibility);

  if (matcher?.includes('tool_input')) {
    compilePredicateGroup(event, matcher, handlers, registry, compatibility, authoritativeRoot);
    return;
  }

  const nativeMatcher = resolveNativeMatcher(
    event,
    matcher,
    handlers,
    compatibility,
    authoritativeRoot
  );
  if (!nativeMatcher.accepted) return;

  recordUnvalidatedNativeHandlers(event, matcher, handlers, compatibility, authoritativeRoot);
  const convertedHandlers = handlers
    .map((handler) => validatedNativeHandler(handler, authoritativeRoot))
    .filter((handler): handler is CodexHookCommandHandler => handler !== null);
  addGroup(registry, event, nativeMatcher.matcher, convertedHandlers);
}

function compileSourceGroup(
  event: string,
  sourceGroupIndex: number,
  group: SourceMatcherGroup,
  registry: CodexHookRegistry,
  compatibility: CodexHookCompatibilityRecord,
  authoritativeRoot?: string
): void {
  const nativeCountBefore = nativeHandlerCount(registry);
  const migrationCountBefore = compatibility.migrated.length;

  if (event === 'FileChanged') {
    compileFileChangedCompatibility(group, registry, compatibility, authoritativeRoot);
  } else if (!NATIVE_EVENTS.has(event)) {
    compileUnsupportedEventGroup(event, group, compatibility, authoritativeRoot);
  } else {
    compileNativeGroup(event, group, registry, compatibility, authoritativeRoot);
  }

  recordGroupCompatibility(
    event,
    sourceGroupIndex,
    nativeCountBefore,
    migrationCountBefore,
    registry,
    compatibility
  );
}

/** Compile a Claude compatibility registry into a deterministic Codex-native registry. */
export function compileCodexHooks(
  source: unknown,
  options: CompileCodexHooksOptions = {}
): CodexHooksCompilation {
  const registry: CodexHookRegistry = { hooks: {} };
  const compatibility: CodexHookCompatibilityRecord = {
    version: 1,
    source: 'templates/.claude/hooks/hooks.json',
    registrySha256: '',
    groups: [],
    excluded: [],
    migrated: [],
  };
  const hooks = sourceHooks(source);

  for (const event of Object.keys(hooks).sort((left, right) => left.localeCompare(right))) {
    const groups = hooks[event];
    for (const [sourceGroupIndex, group] of groups.entries()) {
      compileSourceGroup(
        event,
        sourceGroupIndex,
        group,
        registry,
        compatibility,
        options.authoritativeRoot
      );
    }
  }

  registry.hooks = Object.fromEntries(
    Object.entries(registry.hooks).sort(([left], [right]) => left.localeCompare(right))
  );
  compatibility.registrySha256 = sha256(stableJson(registry));
  return { registry, compatibility };
}

function invalidRegistry(detail: string): never {
  throw new Error(`Invalid Codex hook registry: ${detail}`);
}

function validateCommandHandler(value: unknown, location: string): void {
  if (!isRecord(value) || value.type !== 'command') {
    invalidRegistry(`${location} must be a command`);
  }
  if (typeof value.command !== 'string' || value.command.trim() === '') {
    invalidRegistry(`${location}.command is required`);
  }
  if (
    value.timeout !== undefined &&
    (typeof value.timeout !== 'number' || !Number.isFinite(value.timeout) || value.timeout <= 0)
  ) {
    invalidRegistry(`${location}.timeout is invalid`);
  }
}

function validateMatcherGroup(value: unknown, location: string): void {
  if (!isRecord(value)) invalidRegistry(`${location} must be an object`);
  if (value.matcher !== undefined && typeof value.matcher !== 'string') {
    invalidRegistry(`${location}.matcher must be a string`);
  }
  if (!Array.isArray(value.hooks)) invalidRegistry(`${location}.hooks must be an array`);
  for (const [handlerIndex, handler] of value.hooks.entries()) {
    validateCommandHandler(handler, `${location}.hooks[${handlerIndex}]`);
  }
}

function validateEventGroups(value: unknown, event: string): void {
  if (!Array.isArray(value)) invalidRegistry(`${event} must be an array`);
  for (const [groupIndex, group] of value.entries()) {
    validateMatcherGroup(group, `${event}[${groupIndex}]`);
  }
}

/** Validate the project hook registry contract used by install and diagnostic callers. */
export function validateCodexHookRegistry(value: unknown): CodexHookRegistry {
  if (!isRecord(value) || !isRecord(value.hooks)) {
    return invalidRegistry('expected a hooks object');
  }

  for (const [event, groups] of Object.entries(value.hooks)) {
    validateEventGroups(groups, event);
  }

  return value as CodexHookRegistry;
}

function managedHandlerIdentity(handler: CodexHookCommandHandler): string | null {
  const scriptName = commandScriptName(handler.command);
  return scriptName && NATIVE_VALIDATED_SCRIPTS.has(scriptName)
    ? `omcustomcodex:${scriptName}`
    : null;
}

/** Return the exact managed script footprint reachable from a compiled registry. */
export function getActiveManagedHookScriptNames(registry: CodexHookRegistry): string[] {
  const scriptNames = new Set<string>();
  for (const groups of Object.values(registry.hooks)) {
    for (const group of groups) {
      for (const handler of group.hooks) {
        const scriptName = commandScriptName(handler.command);
        if (scriptName && NATIVE_VALIDATED_SCRIPTS.has(scriptName)) {
          scriptNames.add(scriptName);
        }
      }
    }
  }
  if (scriptNames.size > 0) scriptNames.add(CODEX_NATIVE_HOOK_WRAPPER_SCRIPT);
  return [...scriptNames].sort((left, right) => left.localeCompare(right));
}

function getReferencedHookScriptNames(registry: CodexHookRegistry): Set<string> {
  const scriptNames = new Set<string>();
  for (const groups of Object.values(registry.hooks)) {
    for (const group of groups) {
      for (const handler of group.hooks) {
        const scriptName = commandScriptName(handler.command);
        if (scriptName) scriptNames.add(scriptName);
      }
    }
  }
  return scriptNames;
}

function sameMatcher(left: CodexHookMatcherGroup, right: CodexHookMatcherGroup): boolean {
  return left.matcher === right.matcher;
}

function stripManagedHandlers(registry: CodexHookRegistry): void {
  for (const [event, groups] of Object.entries(registry.hooks)) {
    registry.hooks[event] = groups.flatMap((group) => {
      const hooks = group.hooks.filter((handler) => !managedHandlerIdentity(handler));
      if (hooks.length === group.hooks.length) return [group];
      return hooks.length === 0 ? [] : [{ ...group, hooks }];
    });
  }
}

function appendManagedHandler(
  registry: CodexHookRegistry,
  event: string,
  managedGroup: CodexHookMatcherGroup,
  handler: CodexHookCommandHandler
): void {
  const identity = managedHandlerIdentity(handler);
  if (!identity) invalidRegistry(`managed command has no stable identity: ${handler.command}`);
  const groups = registry.hooks[event] ?? [];
  let targetGroup = groups.find((group) => sameMatcher(group, managedGroup));
  if (!targetGroup) {
    targetGroup = { ...managedGroup, hooks: [] };
    groups.push(targetGroup);
  }

  targetGroup.hooks.push(handler);
  registry.hooks[event] = groups;
}

/** Normalize managed handlers after custom/OMX groups so position-based trust keys stay stable. */
export function mergeCodexHookRegistries(
  existingValue: unknown,
  managedValue: unknown
): CodexHookRegistry {
  const existing = validateCodexHookRegistry(existingValue);
  const managed = validateCodexHookRegistry(managedValue);
  const merged = validateCodexHookRegistry(JSON.parse(stableJson(existing)));
  stripManagedHandlers(merged);

  for (const [event, groups] of Object.entries(managed.hooks)) {
    for (const group of groups) {
      for (const handler of group.hooks) {
        appendManagedHandler(merged, event, group, handler);
      }
    }
  }
  return merged;
}

function registryHasUnmanagedContent(registry: CodexHookRegistry): boolean {
  if (Object.keys(registry).some((key) => key !== 'hooks')) return true;
  for (const groups of Object.values(registry.hooks)) {
    for (const group of groups) {
      if (Object.keys(group).some((key) => key !== 'matcher' && key !== 'hooks')) return true;
      if (group.hooks.length === 0) return true;
      if (group.hooks.some((handler) => !managedHandlerIdentity(handler))) return true;
    }
  }
  return false;
}

interface NativeCodexHookPaths {
  sourceRoot: string;
  sourceRegistryPath: string;
  sourceScriptsPath: string;
  registryPath: string;
  hooksPath: string;
  scriptsPath: string;
  compatibilityPath: string;
  compatibilityRegistryPath: string;
  conversionPath: string;
}

function resolveNativeCodexHookPaths(
  targetDir: string,
  options: InstallNativeCodexHooksOptions
): NativeCodexHookPaths {
  const sourceRoot = options.sourceRoot ?? resolveTemplatePath('.claude/hooks');
  const hooksPath = join(targetDir, '.codex', 'hooks');
  const compatibilityPath = join(hooksPath, 'compatibility');
  return {
    sourceRoot,
    sourceRegistryPath: join(sourceRoot, 'hooks.json'),
    sourceScriptsPath: join(sourceRoot, 'scripts'),
    registryPath: join(targetDir, '.codex', 'hooks.json'),
    hooksPath,
    scriptsPath: join(hooksPath, 'scripts'),
    compatibilityPath,
    compatibilityRegistryPath: join(compatibilityPath, 'claude-hooks.json'),
    conversionPath: join(compatibilityPath, 'conversion.json'),
  };
}

interface ManagedHookAsset {
  name: string;
  sourcePath: string;
  targetPath: string;
}

interface StaleManagedHookAssets {
  removable: ManagedHookAsset[];
  preserved: ManagedHookAsset[];
}

function activeManagedHookAssets(
  paths: NativeCodexHookPaths,
  registry: CodexHookRegistry
): ManagedHookAsset[] {
  return getActiveManagedHookScriptNames(registry).map((name) => ({
    name,
    sourcePath: join(paths.sourceScriptsPath, name),
    targetPath: join(paths.scriptsPath, name),
  }));
}

async function sourceManagedHookAssets(paths: NativeCodexHookPaths): Promise<ManagedHookAsset[]> {
  const entries = await fs.readdir(paths.sourceScriptsPath, { withFileTypes: true });
  const assets = entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      sourcePath: join(paths.sourceScriptsPath, entry.name),
      targetPath: join(paths.scriptsPath, entry.name),
    }));
  const legacyRootSource = join(paths.sourceRoot, 'skill-count-reminder.sh');
  try {
    const stats = await fs.lstat(legacyRootSource);
    if (stats.isFile() && !stats.isSymbolicLink()) {
      assets.push({
        name: 'skill-count-reminder.sh',
        sourcePath: legacyRootSource,
        targetPath: join(paths.hooksPath, 'skill-count-reminder.sh'),
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return assets;
}

async function assertRegularManagedSource(asset: ManagedHookAsset): Promise<void> {
  const stats = await fs.lstat(asset.sourcePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Managed hook source must be a regular file: ${asset.sourcePath}`);
  }
}

async function classifyStaleManagedHookAssets(
  paths: NativeCodexHookPaths,
  activeNames: Set<string>,
  retainedNames: Set<string> = activeNames
): Promise<StaleManagedHookAssets> {
  const removable: ManagedHookAsset[] = [];
  const preserved: ManagedHookAsset[] = [];

  for (const asset of await sourceManagedHookAssets(paths)) {
    if (activeNames.has(asset.name)) continue;
    if (retainedNames.has(asset.name)) {
      preserved.push(asset);
      continue;
    }
    try {
      const targetStats = await fs.lstat(asset.targetPath);
      if (targetStats.isSymbolicLink() || !targetStats.isFile() || targetStats.nlink > 1) {
        preserved.push(asset);
        continue;
      }
      const [sourceContent, targetContent] = await Promise.all([
        fs.readFile(asset.sourcePath),
        fs.readFile(asset.targetPath),
      ]);
      if (sourceContent.equals(targetContent)) removable.push(asset);
      else preserved.push(asset);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  return { removable, preserved };
}

async function prevalidateActiveManagedHookAssets(
  targetDir: string,
  activeAssets: ManagedHookAsset[],
  overwrite: boolean
): Promise<void> {
  for (const asset of activeAssets) {
    await assertRegularManagedSource(asset);
    if (!overwrite && (await fileExists(asset.targetPath))) continue;
    await prevalidateSafeWritePath(asset.targetPath, targetDir);
  }
}

async function copyActiveManagedHookAssets(
  targetDir: string,
  activeAssets: ManagedHookAsset[],
  overwrite: boolean
): Promise<void> {
  for (const asset of activeAssets) {
    if (!overwrite && (await fileExists(asset.targetPath))) continue;
    await copyFile(asset.sourcePath, asset.targetPath, targetDir);
    const stats = await fs.stat(asset.sourcePath);
    await fs.utimes(asset.targetPath, stats.atime, stats.mtime);
  }
}

/** Prevalidate every native-hook target before an installer/update mutates the project. */
export async function prevalidateNativeCodexHooks(
  targetDir: string,
  options: InstallNativeCodexHooksOptions = {}
): Promise<void> {
  const paths = resolveNativeCodexHookPaths(targetDir, options);
  await prevalidateSafeWritePath(paths.registryPath, targetDir);
  await prevalidateSafeWritePath(paths.compatibilityRegistryPath, targetDir);
  await prevalidateSafeWritePath(paths.conversionPath, targetDir);
  const source = await readJsonFile<unknown>(paths.sourceRegistryPath);
  const compilation = compileCodexHooks(source);
  const activeAssets = activeManagedHookAssets(paths, compilation.registry);
  const registryExists = await fileExists(paths.registryPath);
  const existingRegistry = registryExists
    ? validateCodexHookRegistry(await readJsonFile<unknown>(paths.registryPath))
    : ({ hooks: {} } satisfies CodexHookRegistry);
  const mergedRegistry = mergeCodexHookRegistries(existingRegistry, compilation.registry);
  const retainedScriptNames = getReferencedHookScriptNames(mergedRegistry);
  const activeScriptNames = new Set(activeAssets.map((asset) => asset.name));
  await prevalidateActiveManagedHookAssets(targetDir, activeAssets, !!options.overwrite);
  const staleAssets = await classifyStaleManagedHookAssets(
    paths,
    activeScriptNames,
    retainedScriptNames
  );
  for (const asset of staleAssets.removable) {
    await prevalidateSafeWritePath(asset.targetPath, targetDir);
  }
}

/**
 * Install the native root registry and hook scripts without installing the
 * Claude registry at the plugin-only `.codex/hooks/hooks.json` location.
 */
export async function installNativeCodexHooks(
  targetDir: string,
  options: InstallNativeCodexHooksOptions = {}
): Promise<InstallNativeCodexHooksResult> {
  const paths = resolveNativeCodexHookPaths(targetDir, options);
  const source = await readJsonFile<unknown>(paths.sourceRegistryPath);
  const authoritativeRoot = await realpath(targetDir);
  const compilation = compileCodexHooks(source, { authoritativeRoot });
  await prevalidateNativeCodexHooks(targetDir, options);
  const registryExists = await fileExists(paths.registryPath);
  const existingRegistry = registryExists
    ? validateCodexHookRegistry(await readJsonFile<unknown>(paths.registryPath))
    : ({ hooks: {} } satisfies CodexHookRegistry);
  const registryPreserved = registryExists && registryHasUnmanagedContent(existingRegistry);
  const mergedRegistry = mergeCodexHookRegistries(existingRegistry, compilation.registry);
  const activeAssets = activeManagedHookAssets(paths, compilation.registry);
  const retainedScriptNames = getReferencedHookScriptNames(mergedRegistry);
  const activeScriptNames = new Set(activeAssets.map((asset) => asset.name));

  await copyActiveManagedHookAssets(targetDir, activeAssets, !!options.overwrite);
  const staleAssets = await classifyStaleManagedHookAssets(
    paths,
    activeScriptNames,
    retainedScriptNames
  );
  for (const asset of staleAssets.removable) {
    await deleteFile(asset.targetPath, targetDir);
  }
  await writeJsonFile(paths.registryPath, mergedRegistry, { trustedWriteRoot: targetDir });
  await writeJsonFile(paths.conversionPath, compilation.compatibility, {
    trustedWriteRoot: targetDir,
  });
  await writeJsonFile(paths.compatibilityRegistryPath, source, { trustedWriteRoot: targetDir });

  return {
    installed: true,
    registryPath: paths.registryPath,
    scriptsPath: paths.scriptsPath,
    compatibilityPath: paths.compatibilityPath,
    registryPreserved,
    activeScriptPaths: activeAssets.map((asset) => asset.targetPath),
    removedStaleManagedPaths: staleAssets.removable.map((asset) => asset.targetPath),
    preservedCustomPaths: staleAssets.preserved.map((asset) => asset.targetPath),
  };
}
