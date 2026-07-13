/**
 * OMX / oh-my-codex auto-installer
 */

// execSync is used here with fully hardcoded command strings (no user input),
// so there is no shell injection risk. Global npm install requires a shell.
import { type ExecSyncOptions, execFileSync, execSync } from 'node:child_process';
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { platform } from 'node:os';
import { join, resolve } from 'node:path';
import { info, warn } from '../utils/logger.js';
import { parseNativeAgentListMetadata } from './agent-compiler.js';
import type { CodexHookCommandHandler } from './codex-hooks.js';

export const MINIMUM_OMX_VERSION = '0.19.0';
export const OMX_PROJECT_SETUP_COMMAND = 'omx setup --scope project --merge-agents';

export interface InstallerDeps {
  exec: (cmd: string, opts?: ExecSyncOptions) => string | Buffer;
  getPlatform: () => NodeJS.Platform;
  inspectHooks?: (projectRoot: string) => CodexHookRuntimeEntry[] | null;
}

export type OmxProjectInstallMode = 'legacy' | 'plugin';
export type OmxMcpMode = 'none' | 'compat';

export interface OmxProjectSetupOptions {
  installMode?: OmxProjectInstallMode;
  mcpMode?: OmxMcpMode;
}

export function buildOmxProjectSetupCommand(options: OmxProjectSetupOptions = {}): string {
  const args = [OMX_PROJECT_SETUP_COMMAND];
  if (options.installMode) args.push(`--install-mode ${options.installMode}`);
  if (options.mcpMode) args.push(`--mcp ${options.mcpMode}`);
  return args.join(' ');
}

export type OmxInstallStatus = 'missing' | 'stale' | 'api-missing' | 'unknown-version' | 'ready';

export interface OmxInstallationAssessment {
  status: OmxInstallStatus;
  installed: boolean;
  version: string | null;
  parsedVersion: string | null;
  minimumVersion: string;
  hasApiCommand: boolean;
}

export type OmxProjectSurface =
  | 'prompts'
  | 'skills'
  | 'nativeAgents'
  | 'agentsInstructions'
  | 'codexConfig'
  | 'nativeHooks'
  | 'mcp';

export type OmxMcpReadinessStatus = 'none-valid' | 'configured-valid' | 'configured-broken';

export type OmxProjectSetupStatus = 'partial' | 'needs-hook-approval' | 'ready';

export type OmxHookReadinessStatus =
  | 'missing'
  | 'unverified'
  | 'approval-needed'
  | 'inactive'
  | 'runnable';

export type CodexHookTrustStatus = 'managed' | 'untrusted' | 'trusted' | 'modified';

export interface CodexHookRuntimeEntry {
  key: string;
  command: string | null;
  currentHash: string;
  enabled: boolean;
  source: string;
  sourcePath: string;
  trustStatus: CodexHookTrustStatus;
}

export interface OmxHookReadinessAssessment {
  status: OmxHookReadinessStatus;
  installed: boolean;
  discovered: number;
  runnable: number;
  approvalNeeded: number;
}

export interface OmxProjectSetupAssessment {
  status: OmxProjectSetupStatus;
  ready: boolean;
  projectRoot: string;
  setupCommand: string;
  installMode: OmxProjectInstallMode;
  mcpStatus: OmxMcpReadinessStatus;
  hookReadiness: OmxHookReadinessAssessment;
  surfaces: Record<OmxProjectSurface, boolean>;
  missingSurfaces: OmxProjectSurface[];
}

export type OmxReadinessStatus = Exclude<OmxInstallStatus, 'ready'> | OmxProjectSetupStatus;

export interface OmxReadinessAssessment {
  status: OmxReadinessStatus;
  ready: boolean;
  capability: OmxInstallationAssessment;
  project: OmxProjectSetupAssessment;
}

export interface OmxProjectProvisionResult {
  success: boolean;
  attempted: boolean;
  command: string;
  assessment: OmxReadinessAssessment;
  error?: string;
}

export const OMX_PROJECT_SURFACE_LABELS: Record<OmxProjectSurface, string> = {
  prompts: '.codex/prompts/*.md',
  skills: '.codex/skills/*/SKILL.md',
  nativeAgents: '.codex/agents/*.toml',
  agentsInstructions: 'OMX-managed AGENTS.md instructions',
  codexConfig: '.codex/config.toml OMX configuration',
  nativeHooks: 'native hooks delivery',
  mcp: 'configured OMX MCP policy',
};

const defaultDeps: InstallerDeps = {
  exec: execSync as InstallerDeps['exec'],
  getPlatform: platform,
  inspectHooks: inspectCodexHooks,
};

const OMX_PROJECT_HOOK_TRUST_START = '# OMX-owned Codex hook trust state';
const OMX_PROJECT_HOOK_TRUST_END = '# End OMX-owned Codex hook trust state';
const CODEX_HOOKS_LIST_CLIENT = String.raw`
const { spawn } = require('node:child_process');
const cwd = process.env.OMCUSTOMCODEX_HOOKS_CWD;
const child = spawn('codex', ['app-server', '--stdio'], {
  cwd,
  env: process.env,
  stdio: ['pipe', 'pipe', 'ignore'],
});
let buffer = '';
let done = false;
const finish = (code, result) => {
  if (done) return;
  done = true;
  clearTimeout(timer);
  child.kill();
  if (result === undefined) process.exit(code);
  process.stdout.write(JSON.stringify(result), () => process.exit(code));
};
const send = (value) => child.stdin.write(JSON.stringify(value) + '\n');
const timer = setTimeout(() => finish(2), 4500);
child.on('error', () => finish(2));
child.on('exit', () => finish(2));
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';
  for (const line of lines) {
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.id === 1 && message.result) {
      send({ jsonrpc: '2.0', method: 'initialized', params: {} });
      send({ jsonrpc: '2.0', id: 2, method: 'hooks/list', params: { cwds: [cwd] } });
    } else if (message.id === 2 && message.result) {
      finish(0, message.result);
    }
  }
});
send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    clientInfo: { name: 'omcustomcodex-readiness', version: '1.0.11' },
    capabilities: { experimentalApi: true },
  },
});
`;

interface CodexHooksListResponse {
  data?: Array<{
    cwd?: unknown;
    hooks?: unknown;
    errors?: unknown;
  }>;
}

function isCodexHookTrustStatus(value: unknown): value is CodexHookTrustStatus {
  return ['managed', 'untrusted', 'trusted', 'modified'].includes(String(value));
}

function parseRuntimeHook(value: unknown): CodexHookRuntimeEntry | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.key !== 'string' ||
    (value.command !== null && typeof value.command !== 'string') ||
    typeof value.currentHash !== 'string' ||
    typeof value.enabled !== 'boolean' ||
    typeof value.source !== 'string' ||
    typeof value.sourcePath !== 'string' ||
    !isCodexHookTrustStatus(value.trustStatus)
  ) {
    return null;
  }
  return {
    key: value.key,
    command: value.command,
    currentHash: value.currentHash,
    enabled: value.enabled,
    source: value.source,
    sourcePath: value.sourcePath,
    trustStatus: value.trustStatus,
  };
}

/** Query the official Codex app-server hook registry without changing trust state. */
export function inspectCodexHooks(projectRoot: string): CodexHookRuntimeEntry[] | null {
  let resolvedRoot: string;
  try {
    resolvedRoot = realpathSync(projectRoot);
  } catch {
    resolvedRoot = resolve(projectRoot);
  }
  try {
    const output = execFileSync(process.execPath, ['-e', CODEX_HOOKS_LIST_CLIENT], {
      cwd: resolvedRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        OMCUSTOMCODEX_HOOKS_CWD: resolvedRoot,
      },
    });
    const result = JSON.parse(String(output)) as CodexHooksListResponse;
    const cwdEntry = result.data?.find(
      (entry) => isRecord(entry) && entry.cwd === resolvedRoot && Array.isArray(entry.hooks)
    );
    if (!cwdEntry || !Array.isArray(cwdEntry.hooks)) return null;
    if (Array.isArray(cwdEntry.errors) && cwdEntry.errors.length > 0) return null;
    return cwdEntry.hooks
      .map(parseRuntimeHook)
      .filter((hook): hook is CodexHookRuntimeEntry => hook !== null);
  } catch {
    return null;
  }
}

function readProjectText(filePath: string): string | null {
  try {
    if (!statSync(filePath).isFile()) return null;
    const content = readFileSync(filePath, 'utf8');
    return content.trim().length > 0 ? content : null;
  } catch {
    return null;
  }
}

function directoryHasFile(
  directoryPath: string,
  predicate: (name: string, content: string) => boolean
): boolean {
  try {
    return readdirSync(directoryPath, { withFileTypes: true }).some((entry) => {
      if (!entry.isFile()) return false;
      const content = readProjectText(join(directoryPath, entry.name));
      return content !== null && predicate(entry.name, content);
    });
  } catch {
    return false;
  }
}

function hasProjectPrompts(projectRoot: string): boolean {
  return directoryHasFile(join(projectRoot, '.codex', 'prompts'), (name) => name.endsWith('.md'));
}

function hasProjectSkills(projectRoot: string): boolean {
  const skillsDirectory = join(projectRoot, '.codex', 'skills');

  try {
    return readdirSync(skillsDirectory, { withFileTypes: true }).some((entry) => {
      if (!entry.isDirectory()) return false;
      return readProjectText(join(skillsDirectory, entry.name, 'SKILL.md')) !== null;
    });
  } catch {
    return false;
  }
}

function hasRequiredTomlKey(content: string, key: string): boolean {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^${escapedKey}\\s*=\\s*(?:"(?:[^"\\\\]|\\\\.)+"|'[^']+'|'''[\\s\\S]+?'''|"""[\\s\\S]+?""")`,
    'm'
  ).test(content);
}

function hasNativeAgentToml(projectRoot: string): boolean {
  return directoryHasFile(join(projectRoot, '.codex', 'agents'), (name, content) => {
    if (!name.endsWith('.toml')) return false;
    try {
      parseNativeAgentListMetadata(content);
      return hasRequiredTomlKey(content, 'developer_instructions');
    } catch {
      return false;
    }
  });
}

function hasOmxAgentsInstructions(projectRoot: string): boolean {
  const content = readProjectText(join(projectRoot, 'AGENTS.md'));
  if (!content) return false;

  return (
    content.includes('# oh-my-codex') ||
    content.includes('You are running with oh-my-codex') ||
    content.includes('<!-- OMX:GUIDANCE:')
  );
}

function readCodexConfig(projectRoot: string): string | null {
  return readProjectText(join(projectRoot, '.codex', 'config.toml'));
}

/** Remove OMX trust records that Codex intentionally ignores at project scope. */
export function removeIneffectiveProjectHookTrustState(projectRoot: string): boolean {
  const configPath = join(resolve(projectRoot), '.codex', 'config.toml');
  let stats: ReturnType<typeof lstatSync>;
  let config: string;
  try {
    stats = lstatSync(configPath);
    if (!stats.isFile() || stats.isSymbolicLink()) return false;
    config = readFileSync(configPath, 'utf8');
  } catch {
    return false;
  }

  const start = config.indexOf(OMX_PROJECT_HOOK_TRUST_START);
  if (start < 0) return false;
  const endMarker = config.indexOf(OMX_PROJECT_HOOK_TRUST_END, start);
  if (endMarker < 0) return false;
  let end = endMarker + OMX_PROJECT_HOOK_TRUST_END.length;
  if (config.slice(end, end + 2) === '\r\n') end += 2;
  else if (config[end] === '\n') end += 1;

  const before = config.slice(0, start).replace(/[ \t]*$/, '');
  const after = config.slice(end).replace(/^\r?\n/, '');
  const next = `${before}${before.endsWith('\n') ? '' : '\n'}${after}`;
  writeFileSync(configPath, next, 'utf8');
  return true;
}

interface OmxSetupScopeState {
  scope?: unknown;
  installMode?: unknown;
  mcpMode?: unknown;
}

function readSetupScopeState(projectRoot: string): OmxSetupScopeState | null {
  const content = readProjectText(join(projectRoot, '.omx', 'setup-scope.json'));
  if (!content) return null;

  try {
    const value: unknown = JSON.parse(content);
    return value !== null && typeof value === 'object' ? (value as OmxSetupScopeState) : null;
  } catch {
    return null;
  }
}

function resolveProjectInstallMode(state: OmxSetupScopeState | null): OmxProjectInstallMode {
  return state?.scope === 'project' && state.installMode === 'plugin' ? 'plugin' : 'legacy';
}

function hasOmxCodexConfig(config: string | null): boolean {
  if (!config) return false;
  return config.includes('oh-my-codex') || /^child_agents_md\s*=\s*true\b/m.test(config);
}

function hasEnabledConfigSection(config: string | null, sectionPattern: RegExp): boolean {
  if (!config) return false;

  let inMatchingSection = false;
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      inMatchingSection = sectionPattern.test(line);
      continue;
    }
    if (inMatchingSection && /^enabled\s*=\s*true\b/.test(line)) {
      return true;
    }
  }

  return false;
}

function readConfigSection(config: string | null, sectionPattern: RegExp): string[] | null {
  if (!config) return null;

  let section: string[] | null = null;
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      if (section !== null) break;
      if (sectionPattern.test(line)) section = [];
      continue;
    }
    if (section !== null && line && !line.startsWith('#')) section.push(line);
  }
  return section;
}

function configSectionHasBoolean(
  config: string | null,
  sectionPattern: RegExp,
  key: string,
  expected: boolean
): boolean {
  const section = readConfigSection(config, sectionPattern);
  if (!section) return false;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return section.some((line) =>
    new RegExp(`^${escapedKey}\\s*=\\s*${String(expected)}\\b`).test(line)
  );
}

function readConfigSectionString(
  config: string | null,
  sectionPattern: RegExp,
  key: string
): string | null {
  const section = readConfigSection(config, sectionPattern);
  if (!section) return null;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const assignment = section
    .map((line) =>
      line.match(new RegExp(`^${escapedKey}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|'[^']*')\\s*$`))
    )
    .find((match) => match !== null);
  if (!assignment) return null;

  const literal = assignment[1];
  if (literal.startsWith("'")) return literal.slice(1, -1);
  try {
    const value: unknown = JSON.parse(literal);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function hasEnabledOmxMcp(config: string | null): boolean {
  return hasEnabledConfigSection(config, /^\[mcp_servers\.omx_[^\]]+\]$/);
}

function assessMcpReadiness(
  state: OmxSetupScopeState | null,
  config: string | null
): OmxMcpReadinessStatus {
  if (hasEnabledOmxMcp(config)) return 'configured-valid';
  if (state?.scope === 'project' && state.mcpMode === 'none') return 'none-valid';
  return 'configured-broken';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type ReadinessCommandHandler = Omit<CodexHookCommandHandler, 'timeout'> & { timeout?: number };

function isValidCommandHandler(value: unknown): value is ReadinessCommandHandler {
  return (
    isRecord(value) &&
    value.type === 'command' &&
    typeof value.command === 'string' &&
    value.command.trim().length > 0 &&
    (value.timeout === undefined ||
      (typeof value.timeout === 'number' && Number.isFinite(value.timeout) && value.timeout > 0))
  );
}

function isValidHookGroup(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.hooks) &&
    value.hooks.length > 0 &&
    value.hooks.every(isValidCommandHandler)
  );
}

interface OmxPluginDelivery {
  prompts: boolean;
  skills: boolean;
  hooks: boolean;
}

const NO_OMX_PLUGIN_DELIVERY: OmxPluginDelivery = {
  prompts: false,
  skills: false,
  hooks: false,
};

const OMX_PLUGIN_HOOK_LAUNCHER_COMMAND = `node "\${PLUGIN_ROOT}/hooks/codex-native-hook.mjs"`;

function readJsonObject(filePath: string): Record<string, unknown> | null {
  const content = readProjectText(filePath);
  if (!content) return null;

  try {
    const value: unknown = JSON.parse(content);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function hasPluginSkillAssets(pluginRoot: string): boolean {
  const skillsDirectory = join(pluginRoot, 'skills');

  try {
    return readdirSync(skillsDirectory, { withFileTypes: true }).some(
      (entry) =>
        entry.isDirectory() &&
        readProjectText(join(skillsDirectory, entry.name, 'SKILL.md')) !== null
    );
  } catch {
    return false;
  }
}

function hasPluginHookAssets(pluginRoot: string): boolean {
  const launcherPath = join(pluginRoot, 'hooks', 'codex-native-hook.mjs');
  const registry = readJsonObject(join(pluginRoot, 'hooks', 'hooks.json'));
  if (!readProjectText(launcherPath) || !registry || !isRecord(registry.hooks)) return false;

  const events = Object.values(registry.hooks);
  if (
    events.length === 0 ||
    !events.every(
      (groups) => Array.isArray(groups) && groups.length > 0 && groups.every(isValidHookGroup)
    )
  ) {
    return false;
  }

  return events.every((groups) =>
    (groups as Array<{ hooks: unknown[] }>).every((group) =>
      group.hooks.every(
        (handler) =>
          isRecord(handler) &&
          typeof handler.command === 'string' &&
          handler.command === OMX_PLUGIN_HOOK_LAUNCHER_COMMAND
      )
    )
  );
}

function assessPluginDelivery(projectRoot: string, config: string | null): OmxPluginDelivery {
  const pluginHooksEnabled =
    configSectionHasBoolean(config, /^\[features\]$/, 'hooks', true) ||
    configSectionHasBoolean(config, /^\[features\]$/, 'plugin_hooks', true);
  if (
    !pluginHooksEnabled ||
    !hasEnabledConfigSection(config, /^\[plugins\."oh-my-codex@oh-my-codex-local"\]$/)
  ) {
    return NO_OMX_PLUGIN_DELIVERY;
  }

  const marketplaceSection = /^\[marketplaces\.oh-my-codex-local\]$/;
  const sourceType = readConfigSectionString(config, marketplaceSection, 'source_type');
  const configuredSource = readConfigSectionString(config, marketplaceSection, 'source');
  if (sourceType !== 'local' || !configuredSource) return NO_OMX_PLUGIN_DELIVERY;

  const packageRoot = resolve(projectRoot, configuredSource);
  const marketplace = readJsonObject(join(packageRoot, '.agents', 'plugins', 'marketplace.json'));
  if (marketplace?.name !== 'oh-my-codex-local' || !Array.isArray(marketplace.plugins)) {
    return NO_OMX_PLUGIN_DELIVERY;
  }

  const pluginEntry = marketplace.plugins.find(
    (entry) =>
      isRecord(entry) &&
      entry.name === 'oh-my-codex' &&
      isRecord(entry.source) &&
      entry.source.source === 'local' &&
      typeof entry.source.path === 'string' &&
      entry.source.path.trim().length > 0
  );
  if (!isRecord(pluginEntry) || !isRecord(pluginEntry.source)) return NO_OMX_PLUGIN_DELIVERY;

  const pluginRoot = resolve(packageRoot, pluginEntry.source.path as string);
  const manifest = readJsonObject(join(pluginRoot, '.codex-plugin', 'plugin.json'));
  if (manifest?.name !== 'oh-my-codex') return NO_OMX_PLUGIN_DELIVERY;

  const skills = manifest.skills === './skills/' && hasPluginSkillAssets(pluginRoot);
  const hooks = manifest.hooks === './hooks/hooks.json' && hasPluginHookAssets(pluginRoot);

  return {
    // OMX 0.20.1 plugin mode intentionally replaces native prompt files with
    // plugin-discovered skills, so the same proven skills asset satisfies both.
    prompts: skills,
    skills,
    hooks,
  };
}

function hasValidNativeHooksRegistry(projectRoot: string): boolean {
  const content = readProjectText(join(projectRoot, '.codex', 'hooks.json'));
  if (!content) return false;

  try {
    const registry: unknown = JSON.parse(content);
    if (!isRecord(registry) || !isRecord(registry.hooks)) return false;
    const events = Object.values(registry.hooks);
    return (
      events.length > 0 &&
      events.every(
        (groups) => Array.isArray(groups) && groups.length > 0 && groups.every(isValidHookGroup)
      )
    );
  } catch {
    return false;
  }
}

function assessHookReadiness(
  projectRoot: string,
  installed: boolean,
  deps: InstallerDeps
): OmxHookReadinessAssessment {
  if (!installed) {
    return {
      status: 'missing',
      installed: false,
      discovered: 0,
      runnable: 0,
      approvalNeeded: 0,
    };
  }

  const hooks = deps.inspectHooks?.(projectRoot);
  if (!hooks) {
    return {
      status: 'unverified',
      installed: true,
      discovered: 0,
      runnable: 0,
      approvalNeeded: 0,
    };
  }

  const projectHooks = hooks.filter(
    (hook) => hook.source === 'project' || hook.source === 'plugin'
  );
  const approvalNeeded = projectHooks.filter(
    (hook) => hook.trustStatus === 'untrusted' || hook.trustStatus === 'modified'
  ).length;
  const runnable = projectHooks.filter(
    (hook) => hook.enabled && (hook.trustStatus === 'trusted' || hook.trustStatus === 'managed')
  ).length;

  let status: OmxHookReadinessStatus;
  if (projectHooks.length === 0 || approvalNeeded > 0) {
    status = 'approval-needed';
  } else if (runnable !== projectHooks.length) {
    status = 'inactive';
  } else {
    status = 'runnable';
  }

  return {
    status,
    installed: true,
    discovered: projectHooks.length,
    runnable,
    approvalNeeded,
  };
}

export function assessOmxProjectSetup(
  projectRoot: string,
  deps: InstallerDeps = defaultDeps
): OmxProjectSetupAssessment {
  const resolvedRoot = resolve(projectRoot);
  const config = readCodexConfig(resolvedRoot);
  const setupState = readSetupScopeState(resolvedRoot);
  const installMode = resolveProjectInstallMode(setupState);
  const mcpStatus = assessMcpReadiness(setupState, config);
  const pluginDelivery =
    installMode === 'plugin' ? assessPluginDelivery(resolvedRoot, config) : NO_OMX_PLUGIN_DELIVERY;
  const hooksInstalled = pluginDelivery.hooks || hasValidNativeHooksRegistry(resolvedRoot);
  const hookReadiness = assessHookReadiness(resolvedRoot, hooksInstalled, deps);
  const surfaces: Record<OmxProjectSurface, boolean> = {
    prompts: pluginDelivery.prompts || hasProjectPrompts(resolvedRoot),
    skills: pluginDelivery.skills || hasProjectSkills(resolvedRoot),
    nativeAgents: hasNativeAgentToml(resolvedRoot),
    agentsInstructions: hasOmxAgentsInstructions(resolvedRoot),
    codexConfig: hasOmxCodexConfig(config),
    nativeHooks: hookReadiness.status === 'runnable',
    mcp: mcpStatus !== 'configured-broken',
  };
  const missingSurfaces = (Object.keys(surfaces) as OmxProjectSurface[]).filter(
    (surface) => !surfaces[surface]
  );
  const ready = missingSurfaces.length === 0;
  const onlyHookApprovalMissing =
    hookReadiness.status === 'approval-needed' &&
    missingSurfaces.length === 1 &&
    missingSurfaces[0] === 'nativeHooks';

  return {
    status: ready ? 'ready' : onlyHookApprovalMissing ? 'needs-hook-approval' : 'partial',
    ready,
    projectRoot: resolvedRoot,
    setupCommand: OMX_PROJECT_SETUP_COMMAND,
    installMode,
    mcpStatus,
    hookReadiness,
    surfaces,
    missingSurfaces,
  };
}

export function isOmxInstalled(deps: InstallerDeps = defaultDeps): boolean {
  try {
    deps.exec('which omx', { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export function getOmxVersion(deps: InstallerDeps = defaultDeps): string | null {
  try {
    return (
      deps.exec('omx --version', {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 3000,
      }) as string
    ).trim();
  } catch {
    return null;
  }
}

export function parseOmxVersion(versionOutput: string | null): string | null {
  if (!versionOutput) {
    return null;
  }

  const match = versionOutput.match(
    /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/
  );
  return match ? match[1] : null;
}

function parseVersionParts(version: string): {
  core: [number, number, number];
  prerelease: string | null;
} {
  const [withoutBuild] = version.split('+');
  const [coreText, prerelease = null] = withoutBuild.split('-', 2);
  const coreParts = coreText.split('.').map((part) => Number.parseInt(part, 10));

  return {
    core: [coreParts[0] ?? 0, coreParts[1] ?? 0, coreParts[2] ?? 0],
    prerelease,
  };
}

export function compareOmxVersions(left: string, right: string): number {
  const a = parseVersionParts(left);
  const b = parseVersionParts(right);

  for (let index = 0; index < 3; index += 1) {
    const diff = a.core[index] - b.core[index];
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  if (a.prerelease === b.prerelease) {
    return 0;
  }
  if (a.prerelease === null) {
    return 1;
  }
  if (b.prerelease === null) {
    return -1;
  }

  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

export function isOmxVersionAtLeast(
  version: string | null,
  minimumVersion: string = MINIMUM_OMX_VERSION
): boolean {
  const parsedVersion = parseOmxVersion(version);
  return parsedVersion !== null && compareOmxVersions(parsedVersion, minimumVersion) >= 0;
}

export function hasOmxApiCommand(deps: InstallerDeps = defaultDeps): boolean {
  try {
    deps.exec('omx api --help', {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

export function assessOmxInstallation(
  deps: InstallerDeps = defaultDeps
): OmxInstallationAssessment {
  if (!isOmxInstalled(deps)) {
    return {
      status: 'missing',
      installed: false,
      version: null,
      parsedVersion: null,
      minimumVersion: MINIMUM_OMX_VERSION,
      hasApiCommand: false,
    };
  }

  const version = getOmxVersion(deps);
  const parsedVersion = parseOmxVersion(version);

  if (parsedVersion && compareOmxVersions(parsedVersion, MINIMUM_OMX_VERSION) < 0) {
    return {
      status: 'stale',
      installed: true,
      version,
      parsedVersion,
      minimumVersion: MINIMUM_OMX_VERSION,
      hasApiCommand: false,
    };
  }

  const hasApi = hasOmxApiCommand(deps);

  if (parsedVersion && !hasApi) {
    return {
      status: 'api-missing',
      installed: true,
      version,
      parsedVersion,
      minimumVersion: MINIMUM_OMX_VERSION,
      hasApiCommand: false,
    };
  }

  if (!parsedVersion && !hasApi) {
    return {
      status: 'unknown-version',
      installed: true,
      version,
      parsedVersion: null,
      minimumVersion: MINIMUM_OMX_VERSION,
      hasApiCommand: false,
    };
  }

  return {
    status: 'ready',
    installed: true,
    version,
    parsedVersion,
    minimumVersion: MINIMUM_OMX_VERSION,
    hasApiCommand: hasApi,
  };
}

export function assessOmxReadiness(
  projectRoot: string,
  deps: InstallerDeps = defaultDeps
): OmxReadinessAssessment {
  const capability = assessOmxInstallation(deps);
  const project = assessOmxProjectSetup(projectRoot, deps);
  const status: OmxReadinessStatus =
    capability.status === 'ready' ? project.status : capability.status;

  return {
    status,
    ready: status === 'ready',
    capability,
    project,
  };
}

export function isOmxReady(deps: InstallerDeps = defaultDeps): boolean {
  return assessOmxInstallation(deps).status === 'ready';
}

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test';
}

export function installOmx(deps: InstallerDeps = defaultDeps): boolean {
  if (deps === defaultDeps && (process.env.CI || isTestRuntime())) {
    return false;
  }

  const current = assessOmxInstallation(deps);
  if (current.status === 'ready') {
    info('install.omx_already');
    return true;
  }

  const os = deps.getPlatform();
  if (!['darwin', 'linux', 'win32'].includes(os)) {
    warn('install.omx_install_failed', { error: `Unsupported OS: ${os}` });
    return false;
  }

  try {
    info('install.omx_installing');
    deps.exec('npm install -g oh-my-codex@latest', {
      stdio: 'inherit',
      timeout: 120000,
    });
    return isOmxReady(deps);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn('install.omx_install_failed', { error: message });
    return false;
  }
}

function provisionError(
  assessment: OmxReadinessAssessment,
  attempted: boolean,
  command: string,
  error: string
): OmxProjectProvisionResult {
  return {
    success: false,
    attempted,
    command,
    assessment,
    error,
  };
}

/**
 * Ensure both the OMX CLI capability and the project-scoped runtime surfaces exist.
 * The command is hardcoded and executes with an explicit cwd, so project paths never
 * enter the shell command. Injected dependencies keep isolated tests off the real HOME.
 */
export function ensureOmxProjectReady(
  projectRoot: string,
  deps: InstallerDeps = defaultDeps,
  options: OmxProjectSetupOptions = {}
): OmxProjectProvisionResult {
  const setupCommand = buildOmxProjectSetupCommand(options);
  removeIneffectiveProjectHookTrustState(projectRoot);
  let assessment = assessOmxReadiness(projectRoot, deps);
  if (assessment.ready) {
    return {
      success: true,
      attempted: false,
      command: setupCommand,
      assessment,
    };
  }

  if (assessment.capability.status !== 'ready') {
    if (!installOmx(deps)) {
      return provisionError(
        assessment,
        false,
        setupCommand,
        `OMX CLI is not capable (${assessment.capability.status}); install oh-my-codex >= v${MINIMUM_OMX_VERSION}`
      );
    }
    assessment = assessOmxReadiness(projectRoot, deps);
    if (assessment.capability.status !== 'ready') {
      return provisionError(
        assessment,
        true,
        setupCommand,
        `OMX CLI remains incapable after installation (${assessment.capability.status})`
      );
    }
  }

  if (deps === defaultDeps && isTestRuntime()) {
    return provisionError(
      assessment,
      false,
      setupCommand,
      `Automatic OMX project provisioning is disabled in tests; run: ${setupCommand}`
    );
  }

  try {
    deps.exec(setupCommand, {
      cwd: assessment.project.projectRoot,
      stdio: 'inherit',
      timeout: 120000,
    });
    removeIneffectiveProjectHookTrustState(projectRoot);
  } catch (error) {
    removeIneffectiveProjectHookTrustState(projectRoot);
    const message = error instanceof Error ? error.message : String(error);
    return provisionError(
      assessOmxReadiness(projectRoot, deps),
      true,
      setupCommand,
      `OMX project setup failed: ${message}. Run manually: ${setupCommand}`
    );
  }

  assessment = assessOmxReadiness(projectRoot, deps);
  if (assessment.project.hookReadiness.status === 'approval-needed') {
    return provisionError(
      assessment,
      true,
      setupCommand,
      'OMX project hooks are installed but need approval. Trust the project, then review /hooks; project-layer hook hashes are not auto-approved.'
    );
  }
  if (!assessment.ready) {
    const missing = assessment.project.missingSurfaces
      .map((surface) => OMX_PROJECT_SURFACE_LABELS[surface])
      .join(', ');
    return provisionError(
      assessment,
      true,
      setupCommand,
      `OMX project setup remains incomplete (${missing}). Run manually: ${setupCommand}`
    );
  }

  return {
    success: true,
    attempted: true,
    command: setupCommand,
    assessment,
  };
}
