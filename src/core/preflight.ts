/**
 * Pre-flight checks for Codex/OMX CLI tool versions.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * CLI tool information
 */
export interface CliTool {
  /** Tool name */
  name: string;
  /** Whether the tool is installed */
  installed: boolean;
  /** Current installed version */
  currentVersion: string | null;
  /** Latest available version */
  latestVersion: string | null;
  /** Whether an update is available */
  updateAvailable: boolean;
  /** Installation method detected */
  installMethod: 'homebrew' | 'npm' | 'path' | 'unknown';
}

export interface ToolDescriptor {
  name: string;
  executable: string;
  brewToken?: string;
  npmPackage?: string;
}

export interface CommandOptions {
  signal: AbortSignal;
  timeout: number;
}

export interface CommandInvocation {
  executable: string;
  args: string[];
}

export type CommandRunner = (
  executable: string,
  args: string[],
  options: CommandOptions
) => Promise<string>;

export interface PreflightCollectionContext {
  signal: AbortSignal;
  deadline: number;
  commandTimeout: number;
  runCommand: CommandRunner;
}

/**
 * Pre-flight check result
 */
export interface PreflightResult {
  tools: CliTool[];
  hasUpdates: boolean;
  warnings: string[];
  skipped: boolean;
  skipReason?: string;
}

/**
 * Pre-flight check options
 */
export interface PreflightOptions {
  skip?: boolean;
  tools?: string[];
  timeout?: number;
  /** @internal Test seam for persistent cache behavior. */
  _cachePath?: string;
  /** @internal Test seam for persistent cache behavior. */
  _cacheTtlMs?: number;
  /** @internal Test seam for deterministic cache timestamps. */
  _now?: number;
  /** @internal Test seam for collection behavior. */
  _collectFn?: (
    toolNames: string[],
    context: PreflightCollectionContext
  ) => PreflightResult | Promise<PreflightResult>;
  /** @internal Test seam for child-process behavior. */
  _runCommand?: CommandRunner;
}

interface BrewInfo {
  casks?: Array<{
    token: string;
    version: string;
    installed?: string | null;
  }>;
  formulae?: Array<{
    name: string;
    versions: { stable: string };
    installed?: Array<{ version: string }>;
  }>;
}

interface BrewOutdated {
  casks?: Array<{
    name: string;
    installed_versions: string[];
    current_version: string;
  }>;
  formulae?: Array<{
    name: string;
    installed_versions: string[];
    current_version: string;
  }>;
}

interface BrewToolInfo {
  installed: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
}

const DEFAULT_COMMAND_TIMEOUT = 3000;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 1;
const MAX_CACHE_ENTRIES = 20;
const SAFE_WINDOWS_COMMAND = /^[A-Za-z0-9_.+-]+$/;
const SAFE_WINDOWS_ARGUMENT = /^[-A-Za-z0-9@._+:/=\\]+$/;

interface PreflightCacheEntry {
  checkedAt: number;
  toolNames: string[];
  result: PreflightResult;
}

interface PreflightCache {
  version: typeof CACHE_SCHEMA_VERSION;
  entries: PreflightCacheEntry[];
}

const TOOL_DESCRIPTORS: Record<string, ToolDescriptor> = {
  codex: {
    name: 'codex',
    executable: 'codex',
    brewToken: 'codex',
    npmPackage: '@openai/codex',
  },
  omx: {
    name: 'omx',
    executable: 'omx',
    npmPackage: 'oh-my-codex',
  },
  'claude-code': {
    name: 'claude-code',
    executable: 'claude',
    brewToken: 'claude-code',
    npmPackage: '@anthropic-ai/claude-code',
  },
};

function getDescriptor(toolName: string): ToolDescriptor {
  return (
    TOOL_DESCRIPTORS[toolName] ?? {
      name: toolName,
      executable: toolName,
      brewToken: toolName,
      npmPackage: toolName,
    }
  );
}

function getDefaultCachePath(): string {
  return join(homedir(), '.oh-my-customcodex', 'preflight-cache.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameToolNames(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCliTool(value: unknown, expectedName: string): value is CliTool {
  if (!isRecord(value) || value.name !== expectedName) return false;
  if (typeof value.installed !== 'boolean' || typeof value.updateAvailable !== 'boolean') {
    return false;
  }
  if (!isNullableString(value.currentVersion) || !isNullableString(value.latestVersion)) {
    return false;
  }
  return (
    value.installMethod === 'homebrew' ||
    value.installMethod === 'npm' ||
    value.installMethod === 'path' ||
    value.installMethod === 'unknown'
  );
}

function isPreflightResultForTools(value: unknown, toolNames: string[]): value is PreflightResult {
  if (!isRecord(value) || value.skipped !== false || !Array.isArray(value.tools)) return false;
  if (value.tools.length !== toolNames.length) return false;
  if (!value.tools.every((tool, index) => isCliTool(tool, toolNames[index]))) return false;
  if (
    !Array.isArray(value.warnings) ||
    !value.warnings.every((warning) => typeof warning === 'string')
  ) {
    return false;
  }
  if (value.skipReason !== undefined && typeof value.skipReason !== 'string') return false;
  return (
    typeof value.hasUpdates === 'boolean' &&
    value.hasUpdates === value.tools.some((tool) => tool.updateAvailable)
  );
}

function parseCacheEntry(value: unknown): PreflightCacheEntry | null {
  if (!isRecord(value) || !Number.isFinite(value.checkedAt) || !Array.isArray(value.toolNames)) {
    return null;
  }
  if (!value.toolNames.every((name) => typeof name === 'string')) return null;
  if (!isPreflightResultForTools(value.result, value.toolNames)) return null;

  return {
    checkedAt: value.checkedAt as number,
    toolNames: value.toolNames,
    result: value.result,
  };
}

function readCache(cachePath: string): PreflightCache | null {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.version !== CACHE_SCHEMA_VERSION ||
      !Array.isArray(parsed.entries)
    ) {
      return null;
    }

    return {
      version: CACHE_SCHEMA_VERSION,
      entries: parsed.entries
        .map(parseCacheEntry)
        .filter((entry): entry is PreflightCacheEntry => entry !== null),
    };
  } catch {
    return null;
  }
}

function isFresh(entry: PreflightCacheEntry, now: number, cacheTtlMs: number): boolean {
  const age = now - entry.checkedAt;
  return age >= 0 && age < cacheTtlMs;
}

function readFreshCachedResult(
  cachePath: string,
  toolNames: string[],
  now: number,
  cacheTtlMs: number
): PreflightResult | null {
  if (cacheTtlMs <= 0) return null;
  const cache = readCache(cachePath);
  const entry = cache?.entries.find(
    (candidate) =>
      sameToolNames(candidate.toolNames, toolNames) && isFresh(candidate, now, cacheTtlMs)
  );
  return entry?.result ?? null;
}

function writeCache(
  cachePath: string,
  toolNames: string[],
  result: PreflightResult,
  now: number,
  cacheTtlMs: number
): void {
  if (cacheTtlMs <= 0 || !isPreflightResultForTools(result, toolNames)) return;

  const previousEntries = readCache(cachePath)?.entries ?? [];
  const entries = [
    { checkedAt: now, toolNames: [...toolNames], result },
    ...previousEntries.filter(
      (entry) => !sameToolNames(entry.toolNames, toolNames) && isFresh(entry, now, cacheTtlMs)
    ),
  ].slice(0, MAX_CACHE_ENTRIES);
  const payload: PreflightCache = { version: CACHE_SCHEMA_VERSION, entries };
  const tempPath = `${cachePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;

  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(tempPath, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      renameSync(tempPath, cachePath);
    } catch (error) {
      const code = isRecord(error) ? error.code : undefined;
      if (code !== 'EEXIST' && code !== 'EPERM') throw error;
      rmSync(cachePath, { force: true });
      renameSync(tempPath, cachePath);
    }
  } catch {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Cache failures must never block the requested CLI command.
    }
  }
}

/** Check if running in CI environment. */
export function isCI(): boolean {
  const ciEnvVars = ['CI', 'GITHUB_ACTIONS'];
  return (
    ciEnvVars.some((envVar) => process.env[envVar] === 'true') ||
    process.env.OMCODEX_SKIP_PREFLIGHT === 'true' ||
    process.env.OMCUSTOM_SKIP_PREFLIGHT === 'true'
  );
}

/**
 * Resolve the process invocation without enabling a general-purpose shell.
 *
 * Windows npm global binaries are commonly `.cmd` shims, which `execFile()` cannot launch
 * directly. The cmd.exe fallback only accepts a deliberately narrow token grammar: whitespace,
 * quoting, expansion (`%`/`!`), pipes, redirects, grouping, and escape characters are rejected.
 * This keeps custom tool names from becoming shell input.
 *
 * @internal Exported as a platform-independent test seam.
 */
export function resolveCommandInvocation(
  executable: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comspec: string = process.env.ComSpec || 'cmd.exe'
): CommandInvocation {
  if (platform !== 'win32') return { executable, args };

  if (
    !SAFE_WINDOWS_COMMAND.test(executable) ||
    !args.every((arg) => SAFE_WINDOWS_ARGUMENT.test(arg))
  ) {
    throw new Error(`Unsafe Windows pre-flight command token: ${executable}`);
  }

  return {
    executable: comspec,
    args: ['/d', '/s', '/v:off', '/c', [executable, ...args].join(' ')],
  };
}

const defaultCommandRunner: CommandRunner = (executable, args, options) =>
  new Promise((resolve, reject) => {
    let invocation: CommandInvocation;
    try {
      invocation = resolveCommandInvocation(executable, args);
    } catch (error) {
      reject(error);
      return;
    }

    execFile(
      invocation.executable,
      invocation.args,
      {
        encoding: 'utf-8',
        signal: options.signal,
        timeout: options.timeout,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
  });

function remainingTime(context: PreflightCollectionContext): number {
  return Math.max(0, context.deadline - Date.now());
}

async function runCommand(
  context: PreflightCollectionContext,
  executable: string,
  args: string[]
): Promise<string> {
  const remaining = remainingTime(context);
  if (context.signal.aborted || remaining <= 0) {
    throw new DOMException('Pre-flight check timed out', 'AbortError');
  }

  return context.runCommand(executable, args, {
    signal: context.signal,
    timeout: Math.max(1, Math.min(context.commandTimeout, remaining)),
  });
}

function rethrowAbort(error: unknown, context: PreflightCollectionContext): void {
  if (context.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
    throw error;
  }
}

function parseVersion(output: string): string | null {
  const trimmed = output.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return match?.[0] ?? trimmed;
}

async function hasHomebrew(context: PreflightCollectionContext): Promise<boolean> {
  try {
    await runCommand(context, 'brew', ['--version']);
    return true;
  } catch (error) {
    rethrowAbort(error, context);
    return false;
  }
}

async function getExecutableVersion(
  descriptor: ToolDescriptor,
  context: PreflightCollectionContext
): Promise<string | null> {
  try {
    return parseVersion(await runCommand(context, descriptor.executable, ['--version']));
  } catch (error) {
    rethrowAbort(error, context);
    return null;
  }
}

async function getLatestNpmVersion(
  descriptor: ToolDescriptor,
  context: PreflightCollectionContext
): Promise<string | null> {
  if (!descriptor.npmPackage) return null;

  try {
    const output = await runCommand(context, 'npm', [
      'view',
      descriptor.npmPackage,
      'version',
      '--json',
    ]);
    try {
      const parsed = JSON.parse(output) as unknown;
      return typeof parsed === 'string' ? parseVersion(parsed) : null;
    } catch {
      return parseVersion(output);
    }
  } catch (error) {
    rethrowAbort(error, context);
    return null;
  }
}

async function getToolInfoFromBrew(
  descriptor: ToolDescriptor,
  brewAvailable: boolean,
  context: PreflightCollectionContext
): Promise<BrewToolInfo> {
  const empty: BrewToolInfo = {
    installed: false,
    currentVersion: null,
    latestVersion: null,
  };
  if (!brewAvailable || !descriptor.brewToken) return empty;

  try {
    const output = await runCommand(context, 'brew', ['info', '--json=v2', descriptor.brewToken]);
    const info = JSON.parse(output) as BrewInfo;
    const cask = info.casks?.[0];
    if (cask) {
      return {
        installed: Boolean(cask.installed),
        currentVersion: cask.installed || null,
        latestVersion: cask.version || null,
      };
    }

    const formula = info.formulae?.[0];
    if (formula) {
      return {
        installed: Boolean(formula.installed?.length),
        currentVersion: formula.installed?.[0]?.version ?? null,
        latestVersion: formula.versions.stable || null,
      };
    }
  } catch (error) {
    rethrowAbort(error, context);
  }

  return empty;
}

async function getToolInfo(
  descriptor: ToolDescriptor,
  brewAvailable: boolean,
  context: PreflightCollectionContext
): Promise<CliTool> {
  const [executableVersion, brewInfo, npmLatestVersion] = await Promise.all([
    getExecutableVersion(descriptor, context),
    getToolInfoFromBrew(descriptor, brewAvailable, context),
    getLatestNpmVersion(descriptor, context),
  ]);

  const installed = executableVersion !== null || brewInfo.installed;
  const currentVersion = executableVersion ?? brewInfo.currentVersion;
  const latestVersion = brewInfo.installed
    ? (brewInfo.latestVersion ?? npmLatestVersion)
    : npmLatestVersion;
  const installMethod: CliTool['installMethod'] = brewInfo.installed
    ? 'homebrew'
    : executableVersion !== null
      ? descriptor.npmPackage
        ? 'npm'
        : 'path'
      : 'unknown';

  return {
    name: descriptor.name,
    installed,
    currentVersion,
    latestVersion,
    updateAvailable: Boolean(
      installed && currentVersion && latestVersion && currentVersion !== latestVersion
    ),
    installMethod,
  };
}

async function checkOutdated(
  tools: CliTool[],
  descriptors: ToolDescriptor[],
  brewAvailable: boolean,
  context: PreflightCollectionContext
): Promise<void> {
  if (!brewAvailable) return;

  const brewTokens = descriptors
    .filter((descriptor) => {
      const tool = tools.find((candidate) => candidate.name === descriptor.name);
      return descriptor.brewToken && tool?.installMethod === 'homebrew';
    })
    .map((descriptor) => descriptor.brewToken as string);
  if (brewTokens.length === 0) return;

  try {
    const output = await runCommand(context, 'brew', ['outdated', '--json=v2', ...brewTokens]);
    const outdated = JSON.parse(output) as BrewOutdated;
    const outdatedCasks = outdated.casks || [];
    const outdatedFormulae = outdated.formulae || [];

    for (const tool of tools) {
      const descriptor = descriptors.find((candidate) => candidate.name === tool.name);
      if (!descriptor?.brewToken) continue;
      const entry =
        outdatedCasks.find((candidate) => candidate.name === descriptor.brewToken) ??
        outdatedFormulae.find((candidate) => candidate.name === descriptor.brewToken);
      if (entry) {
        tool.latestVersion = entry.current_version;
        tool.updateAvailable = true;
      }
    }
  } catch (error) {
    rethrowAbort(error, context);
  }
}

/** Perform the actual tool collection and outdated check. */
export async function collectToolResults(
  toolNames: string[],
  context: PreflightCollectionContext
): Promise<PreflightResult> {
  const descriptors = toolNames.map(getDescriptor);
  const brewAvailable = await hasHomebrew(context);
  const tools = await Promise.all(
    descriptors.map((descriptor) => getToolInfo(descriptor, brewAvailable, context))
  );
  await checkOutdated(tools, descriptors, brewAvailable, context);

  return {
    tools,
    hasUpdates: tools.some((tool) => tool.updateAvailable),
    warnings: [],
    skipped: false,
  };
}

function timeoutResult(): PreflightResult {
  return {
    tools: [],
    hasUpdates: false,
    warnings: ['Version check timed out'],
    skipped: true,
    skipReason: 'Timeout',
  };
}

/** Run pre-flight check. */
export async function runPreflightCheck(options: PreflightOptions = {}): Promise<PreflightResult> {
  const {
    skip = false,
    tools: toolNames = ['codex', 'omx'],
    timeout = 5000,
    _collectFn = collectToolResults,
    _runCommand = defaultCommandRunner,
  } = options;

  if (skip) {
    return {
      tools: [],
      hasUpdates: false,
      warnings: [],
      skipped: true,
      skipReason: 'Skipped by --skip-version-check flag',
    };
  }

  if (isCI()) {
    return {
      tools: [],
      hasUpdates: false,
      warnings: [],
      skipped: true,
      skipReason: 'CI environment detected',
    };
  }

  const cachePath = options._cachePath ?? getDefaultCachePath();
  const cacheTtlMs = options._cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cacheNow = Number.isFinite(options._now) ? (options._now as number) : Date.now();
  const hasCustomProbe = options._collectFn !== undefined || options._runCommand !== undefined;
  const useCache = cacheTtlMs > 0 && (!hasCustomProbe || options._cachePath !== undefined);
  if (useCache) {
    const cachedResult = readFreshCachedResult(cachePath, toolNames, cacheNow, cacheTtlMs);
    if (cachedResult) return cachedResult;
  }

  const effectiveTimeout = Math.max(1, timeout);
  const controller = new AbortController();
  const context: PreflightCollectionContext = {
    signal: controller.signal,
    deadline: Date.now() + effectiveTimeout,
    commandTimeout: Math.min(effectiveTimeout, DEFAULT_COMMAND_TIMEOUT),
    runCommand: _runCommand,
  };

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<PreflightResult>((resolve) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      resolve(timeoutResult());
    }, effectiveTimeout);
  });

  const collectPromise = Promise.resolve()
    .then(() => _collectFn(toolNames, context))
    .catch((error: unknown): PreflightResult => {
      if (controller.signal.aborted) return timeoutResult();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        tools: [],
        hasUpdates: false,
        warnings: [`Pre-flight check failed: ${errorMessage}`],
        skipped: true,
        skipReason: 'Error during check',
      };
    });

  let result: PreflightResult;
  try {
    result = await Promise.race([collectPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }

  if (useCache) writeCache(cachePath, toolNames, result, cacheNow, cacheTtlMs);
  return result;
}

/** Format pre-flight warnings for display. */
export function formatPreflightWarnings(result: PreflightResult): string {
  if (!result.hasUpdates) return '';

  const lines: string[] = [];
  const updatesAvailable = result.tools.filter((tool) => tool.updateAvailable);

  if (updatesAvailable.length === 1) {
    const tool = updatesAvailable[0];
    lines.push(
      `⚠ ${tool.name} ${tool.latestVersion} is available (current: ${tool.currentVersion})`
    );
    lines.push(`  Run: ${getUpgradeCommand(tool)}`);
  } else if (updatesAvailable.length > 1) {
    lines.push('Run the following to upgrade:');
    for (const tool of updatesAvailable) {
      lines.push(
        `  ${getUpgradeCommand(tool)}  # ${tool.latestVersion} available (current: ${tool.currentVersion})`
      );
    }
  }

  lines.push('  Use --skip-version-check to skip this check');
  return lines.join('\n');
}

function getUpgradeCommand(tool: CliTool): string {
  const descriptor = getDescriptor(tool.name);
  if (tool.installMethod === 'npm' && descriptor.npmPackage) {
    return `npm install --global ${descriptor.npmPackage}@latest`;
  }
  return `brew upgrade ${descriptor.brewToken ?? tool.name}`;
}
