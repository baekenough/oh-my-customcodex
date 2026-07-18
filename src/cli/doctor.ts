/**
 * omcodex doctor command
 * Checks and fixes configuration issues
 */

import { constants, promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { parseNativeAgentListMetadata } from '../core/agent-compiler.js';
import { validateCodexHookRegistry } from '../core/codex-hooks.js';
import { getCodexVersion, installCodex, isCodexInstalled } from '../core/codex-installer.js';
import { resolveCodexProjectRoot } from '../core/codex-project-root.js';
import { loadConfig } from '../core/config.js';
import { checkFrameworkVersion } from '../core/doctor-framework.js';
import { getComponentPath, getProviderLayout } from '../core/layout.js';
import {
  computeLockfileEntryMetadata,
  readLockfile,
  resolveLockfileRootContext,
} from '../core/lockfile.js';
import {
  assessManagedShellAdvisorReadiness,
  assessOmxReadiness,
  ensureOmxProjectReady,
  type InstallerDeps,
  type ManagedShellAdvisorReadinessAssessment,
  MINIMUM_OMX_VERSION,
  OMX_PROJECT_SETUP_COMMAND,
  OMX_PROJECT_SURFACE_LABELS,
} from '../core/omx-installer.js';
import { getRtkVersion, installRtk, isRtkInstalled } from '../core/rtk-installer.js';
import { checkSelfUpdate } from '../core/self-update.js';
import { i18n } from '../i18n/index.js';
import { prevalidateSafeWritePath, validateSafeWritePath } from '../utils/fs.js';

/**
 * Options for the doctor command
 */
export interface DoctorOptions {
  /** Automatically fix issues that can be fixed */
  fix?: boolean;
  /** Run in quiet mode (only show errors) */
  quiet?: boolean;
  /** Check for oh-my-customcodex updates */
  updates?: boolean;
  /** Run only the fail-closed managed shell advisor readiness gate. */
  requireShellAdvisor?: boolean;
}

/**
 * Status of a single check
 */
export type CheckStatus = 'pass' | 'warn' | 'fail';

/**
 * Result of a single diagnostic check
 */
export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  fixable: boolean;
  fixed?: boolean;
  details?: string[];
}

/**
 * Result of the doctor command
 */
export interface DoctorResult {
  success: boolean;
  checks: CheckResult[];
  passCount: number;
  warnCount: number;
  failCount: number;
  fixedCount: number;
}

export interface DoctorCommandDependencies {
  /** Injectable complete check pass for deterministic post-fix orchestration tests. */
  runAllChecks?: (
    targetDir: string,
    layout: { entryFile: string; rootDir: string },
    packageVersion: string,
    includeUpdates: boolean
  ) => Promise<CheckResult[]>;
  /** Injectable mutation boundary for deterministic post-fix orchestration tests. */
  fixIssues?: typeof fixIssues;
  /** Injectable exact-advisor check for focused CLI orchestration tests. */
  checkManagedShellAdvisor?: typeof checkManagedShellAdvisor;
}

export interface ManagedShellAdvisorCheckDependencies {
  assess?: (projectRoot: string) => ManagedShellAdvisorReadinessAssessment;
}

// Mirrors the native events accepted by the Codex hook compiler. Doctor keeps
// this local so validation does not widen the hook compiler's public surface.
const DOCTOR_SUPPORTED_CODEX_HOOK_EVENTS = new Set([
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

/**
 * Check if a path exists
 */
async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a path is a directory
 */
async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a path is a valid symlink (not broken)
 */
async function isValidSymlink(symlinkPath: string): Promise<boolean> {
  try {
    // Try to read the symlink target to see if it's valid
    await fs.stat(symlinkPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively find all files matching a pattern in a directory
 */
async function findFiles(dir: string, pattern: RegExp): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const subResults = await findFiles(fullPath, pattern);
        results.push(...subResults);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore errors (permission issues, etc.)
  }

  return results;
}

/**
 * Collect symlinks from a refs directory
 */
async function collectSymlinksFromRefsDir(refsDir: string): Promise<string[]> {
  const symlinks: string[] = [];
  try {
    const entries = await fs.readdir(refsDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(refsDir, entry.name);
      try {
        const stat = await fs.lstat(entryPath);
        if (stat.isSymbolicLink()) {
          symlinks.push(entryPath);
        }
      } catch {
        // Ignore errors
      }
    }
  } catch {
    // Ignore errors
  }
  return symlinks;
}

/**
 * Find all symlinks in refs/ directories
 */
async function findRefsSymlinks(dir: string): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.name === 'refs') {
        const symlinks = await collectSymlinksFromRefsDir(fullPath);
        results.push(...symlinks);
      } else {
        const subResults = await findRefsSymlinks(fullPath);
        results.push(...subResults);
      }
    }
  } catch {
    // Ignore errors
  }

  return results;
}

/**
 * Count directories in a path (one level deep)
 */
async function countDirectories(dirPath: string): Promise<number> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).length;
}

function assessRunnableNativeHooks(registry: ReturnType<typeof validateCodexHookRegistry>): {
  eventCount: number;
  handlerCount: number;
} {
  const events = Object.entries(registry.hooks);
  let handlerCount = 0;

  for (const [event, groups] of events) {
    if (!DOCTOR_SUPPORTED_CODEX_HOOK_EVENTS.has(event)) {
      throw new Error(`Unsupported Codex hook event: ${event}`);
    }
    for (const group of groups) handlerCount += group.hooks.length;
  }

  if (handlerCount === 0) {
    throw new Error('Native hook registry requires at least one runnable command handler');
  }

  return { eventCount: events.length, handlerCount };
}

interface NativeAgentScan {
  validCount: number;
  invalidFiles: string[];
}

function hasRequiredTomlKey(content: string, key: string): boolean {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^${escapedKey}\\s*=\\s*(?:"(?:[^"\\\\]|\\\\.)+"|'[^']+'|'''[\\s\\S]+?'''|"""[\\s\\S]+?""")`,
    'm'
  ).test(content);
}

/** Validate standalone Codex-native TOML roles in a flat {root}/agents directory. */
async function scanNativeAgents(agentsDir: string): Promise<NativeAgentScan> {
  const result: NativeAgentScan = { validCount: 0, invalidFiles: [] };

  try {
    const entries = (await fs.readdir(agentsDir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.toml')) continue;

      try {
        const content = await fs.readFile(path.join(agentsDir, entry.name), 'utf-8');
        parseNativeAgentListMetadata(content);
        if (!hasRequiredTomlKey(content, 'developer_instructions')) {
          throw new Error('Native agent TOML requires developer_instructions');
        }
        result.validCount++;
      } catch {
        result.invalidFiles.push(entry.name);
      }
    }
  } catch {
    // Ignore errors
  }

  return result;
}

/**
 * Check if entry doc exists
 * @param targetDir - Target directory
 * @param entryFile - Entry file name (CLAUDE.md or AGENTS.md)
 * @returns Check result
 */
export async function checkEntryDoc(targetDir: string, entryFile: string): Promise<CheckResult> {
  const entryPath = path.join(targetDir, entryFile);
  const exists = await pathExists(entryPath);

  return {
    name: entryFile,
    status: exists ? 'pass' : 'fail',
    message: exists
      ? i18n.t('cli.doctor.checks.entryMd.pass', { entry: entryFile })
      : i18n.t('cli.doctor.checks.entryMd.fail', { entry: entryFile }),
    fixable: false, // Entry doc should be created by init, not auto-fixed
  };
}

// Backward compatibility for older callers/tests
export async function checkClaudeMd(targetDir: string): Promise<CheckResult> {
  return checkEntryDoc(targetDir, 'CLAUDE.md');
}

/**
 * Check the shared policy directory without conflating harness Markdown policy
 * with Codex-native Starlark command execution policy.
 * @param targetDir - Target directory
 * @returns Check result
 */
export async function checkRules(
  targetDir: string,
  rootDir: string = '.codex'
): Promise<CheckResult> {
  const rulesDir = path.join(targetDir, rootDir, 'rules');
  const exists = await isDirectory(rulesDir);

  if (!exists) {
    return {
      name: 'Rules',
      status: 'fail',
      message: i18n.t('cli.doctor.checks.rules.fail'),
      fixable: true,
    };
  }

  const harnessPolicyFiles = await findFiles(rulesDir, /\.md$/);
  const nativeExecPolicyFiles = await findFiles(rulesDir, /\.rules$/);
  const policySummary = i18n.t('cli.doctor.checks.rules.summary', {
    markdown: harnessPolicyFiles.length,
    native: nativeExecPolicyFiles.length,
  });

  if (harnessPolicyFiles.length === 0) {
    return {
      name: 'Rules',
      status: 'warn',
      message: `${i18n.t('cli.doctor.checks.rules.fail')} (${policySummary})`,
      fixable: false,
    };
  }

  return {
    name: 'Rules',
    status: 'pass',
    message: `${i18n.t('cli.doctor.checks.rules.pass')} (${policySummary})`,
    fixable: false,
  };
}

/**
 * Check if agents directory contains valid standalone Codex-native TOML roles.
 * Official format: {root}/agents/*.toml
 * @param targetDir - Target directory
 * @returns Check result
 */
export async function checkAgents(
  targetDir: string,
  rootDir: string = '.codex'
): Promise<CheckResult> {
  const agentsDir = path.join(targetDir, rootDir, 'agents');
  const exists = await isDirectory(agentsDir);

  if (!exists) {
    return {
      name: 'Agents',
      status: 'fail',
      message: i18n.t('cli.doctor.checks.agents.fail'),
      fixable: true,
    };
  }

  const { validCount, invalidFiles } = await scanNativeAgents(agentsDir);

  if (validCount === 0) {
    return {
      name: 'Agents',
      status: 'warn',
      message: `${i18n.t('cli.doctor.checks.agents.fail')} (0 agents found)`,
      fixable: false,
      details: invalidFiles.length > 0 ? invalidFiles : undefined,
    };
  }

  if (invalidFiles.length > 0) {
    return {
      name: 'Agents',
      status: 'warn',
      message: `${i18n.t('cli.doctor.checks.agents.pass')} (${validCount} agents; ${invalidFiles.length} invalid TOML)`,
      fixable: false,
      details: invalidFiles,
    };
  }

  return {
    name: 'Agents',
    status: 'pass',
    message: `${i18n.t('cli.doctor.checks.agents.pass')} (${validCount} agents)`,
    fixable: false,
  };
}

/**
 * Check if all symlinks in refs/ are valid
 * Official format: {root}/agents/, {root}/skills/
 * @param targetDir - Target directory
 * @returns Check result
 */
export async function checkSymlinks(
  targetDir: string,
  _rootDir: string = '.codex'
): Promise<CheckResult> {
  const skillsDir = path.join(targetDir, getComponentPath('skills'));

  const brokenSymlinks: string[] = [];

  // Check symlinks in skills directory (agents are now flat .md files, no refs)
  if (await isDirectory(skillsDir)) {
    const skillSymlinks = await findRefsSymlinks(skillsDir);
    for (const symlink of skillSymlinks) {
      if (!(await isValidSymlink(symlink))) {
        brokenSymlinks.push(symlink);
      }
    }
  }

  if (brokenSymlinks.length > 0) {
    return {
      name: 'Symlinks',
      status: 'fail',
      message: `${i18n.t('cli.doctor.checks.symlinks.fail')} (${brokenSymlinks.length} broken)`,
      fixable: true,
      details: brokenSymlinks.map((s) => path.relative(targetDir, s)),
    };
  }

  return {
    name: 'Symlinks',
    status: 'pass',
    message: i18n.t('cli.doctor.checks.symlinks.pass'),
    fixable: false,
  };
}

/**
 * Check if index.yaml files are valid
 * @param targetDir - Target directory
 * @returns Check result
 */
export async function checkIndexFiles(targetDir: string): Promise<CheckResult> {
  const indexFiles = await findFiles(targetDir, /^index\.yaml$/);
  const invalidFiles: string[] = [];

  for (const indexFile of indexFiles) {
    try {
      const content = await fs.readFile(indexFile, 'utf-8');
      parseYaml(content);
    } catch (_error) {
      invalidFiles.push(indexFile);
    }
  }

  if (invalidFiles.length > 0) {
    return {
      name: 'Index files',
      status: 'fail',
      message: `${i18n.t('cli.doctor.checks.index.fail')} (${invalidFiles.length} invalid)`,
      fixable: false,
      details: invalidFiles.map((f) => path.relative(targetDir, f)),
    };
  }

  if (indexFiles.length === 0) {
    return {
      name: 'Index files',
      status: 'warn',
      message: `${i18n.t('cli.doctor.checks.index.pass')} (0 files found)`,
      fixable: false,
    };
  }

  return {
    name: 'Index files',
    status: 'pass',
    message: `${i18n.t('cli.doctor.checks.index.pass')} (${indexFiles.length} files)`,
    fixable: false,
  };
}

/**
 * Check whether installed skills are discoverable through SKILL.md definitions.
 * Official Codex project format: .agents/skills/{name}/SKILL.md
 * @param targetDir - Target directory
 * @returns Check result
 */
export async function checkSkills(
  targetDir: string,
  _rootDir: string = '.codex'
): Promise<CheckResult> {
  const skillsDir = path.join(targetDir, getComponentPath('skills'));
  const exists = await isDirectory(skillsDir);

  if (!exists) {
    return {
      name: 'Skills',
      status: 'fail',
      message: i18n.t('cli.doctor.checks.skills.fail'),
      fixable: true,
    };
  }

  const skillFiles = await findFiles(skillsDir, /^SKILL\.md$/);
  const skillSummary = i18n.t('cli.doctor.checks.skills.summary', {
    count: skillFiles.length,
  });

  if (skillFiles.length === 0) {
    return {
      name: 'Skills',
      status: 'warn',
      message: `${i18n.t('cli.doctor.checks.skills.fail')} (${skillSummary})`,
      fixable: false,
    };
  }

  return {
    name: 'Skills',
    status: 'pass',
    message: `${i18n.t('cli.doctor.checks.skills.pass')} (${skillSummary})`,
    fixable: false,
  };
}

/**
 * Check if guides directory exists
 * @param targetDir - Target directory
 * @returns Check result
 */
export async function checkGuides(targetDir: string): Promise<CheckResult> {
  const guidesDir = path.join(targetDir, 'guides');
  const exists = await isDirectory(guidesDir);

  if (!exists) {
    return {
      name: 'Guides',
      status: 'fail',
      message: 'guides/ directory not found',
      fixable: true,
    };
  }

  const topicCount = await countDirectories(guidesDir);

  if (topicCount === 0) {
    return {
      name: 'Guides',
      status: 'warn',
      message: 'guides/ directory is empty (0 topics found)',
      fixable: false,
    };
  }

  return {
    name: 'Guides',
    status: 'pass',
    message: `Guides OK (${topicCount} topics)`,
    fixable: false,
  };
}

/** Validate the root Codex-native hook registry. */
export async function checkHooks(
  targetDir: string,
  rootDir: string = '.codex'
): Promise<CheckResult> {
  const projectRoot = resolveCodexProjectRoot(targetDir);
  const registryPath = path.join(projectRoot, rootDir, 'hooks.json');
  const registryLabel = path.relative(projectRoot, registryPath);
  const exists = await pathExists(registryPath);

  if (!exists) {
    return {
      name: 'Hooks',
      status: 'fail',
      message: `${registryLabel} native hook registry not found`,
      fixable: false,
      details: [`Missing native hook registry: ${registryLabel}`],
    };
  }

  try {
    const content = await fs.readFile(registryPath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('Invalid JSON');
    }

    const registry = validateCodexHookRegistry(parsed);
    const { eventCount, handlerCount } = assessRunnableNativeHooks(registry);
    return {
      name: 'Hooks',
      status: 'pass',
      message: `Hooks OK (${eventCount} events, ${handlerCount} handlers)`,
      fixable: false,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      name: 'Hooks',
      status: 'fail',
      message: `${registryLabel} native hook registry is malformed`,
      fixable: false,
      details: [`${registryLabel}: ${reason}`],
    };
  }
}

/**
 * Check if RTK is installed for token optimization
 */
export async function checkRtk(): Promise<CheckResult> {
  if (!isRtkInstalled()) {
    return {
      name: 'RTK',
      status: 'warn',
      message: 'RTK not installed — token savings unavailable (brew install rtk-ai/tap/rtk)',
      fixable: true,
    };
  }

  const version = getRtkVersion();
  return {
    name: 'RTK',
    status: 'pass',
    message: `RTK OK (${version ?? 'unknown version'})`,
    fixable: false,
  };
}

/**
 * Check if Codex CLI is installed for AI-assisted development
 */
export async function checkCodex(): Promise<CheckResult> {
  if (!isCodexInstalled()) {
    return {
      name: 'Codex',
      status: 'warn',
      message: 'Codex CLI not installed — install manually: npm install -g @openai/codex',
      fixable: true,
    };
  }

  const version = getCodexVersion();
  return {
    name: 'Codex',
    status: 'pass',
    message: `Codex CLI OK (${version ?? 'unknown version'})`,
    fixable: false,
  };
}

/**
 * Check OMX binary/API capability and project-scoped setup readiness separately.
 */
export async function checkOmx(
  targetDir: string = process.cwd(),
  deps?: InstallerDeps
): Promise<CheckResult> {
  const readiness = assessOmxReadiness(targetDir, deps);
  const omx = readiness.capability;

  if (omx.status === 'missing') {
    return {
      name: 'OMX',
      status: 'warn',
      message: 'OMX not installed — install manually: npm install -g oh-my-codex',
      fixable: true,
    };
  }

  if (omx.status === 'stale') {
    return {
      name: 'OMX',
      status: 'warn',
      message: `OMX stale (${omx.version ?? 'unknown version'}) — requires oh-my-codex v${MINIMUM_OMX_VERSION}+ with omx api`,
      fixable: true,
    };
  }

  if (omx.status === 'api-missing') {
    return {
      name: 'OMX',
      status: 'warn',
      message: `OMX missing required omx api command (${omx.version ?? 'unknown version'}) — install oh-my-codex v${MINIMUM_OMX_VERSION}+`,
      fixable: true,
    };
  }

  if (omx.status === 'unknown-version') {
    return {
      name: 'OMX',
      status: 'warn',
      message: `OMX version could not be verified — requires oh-my-codex v${MINIMUM_OMX_VERSION}+ with omx api`,
      fixable: true,
    };
  }

  if (readiness.project.status === 'needs-hook-approval') {
    const hooks = readiness.project.hookReadiness;
    return {
      name: 'OMX',
      status: 'warn',
      message:
        'OMX project hooks are installed but need approval — trust the project, then review /hooks',
      fixable: false,
      details: [
        `Codex hooks/list: discovered=${hooks.discovered}, runnable=${hooks.runnable}, approval-needed=${hooks.approvalNeeded}`,
        'Project-layer hook hashes are not auto-approved.',
      ],
    };
  }

  if (!readiness.project.ready) {
    const details = readiness.project.missingSurfaces.map(
      (surface) => `missing: ${OMX_PROJECT_SURFACE_LABELS[surface]}`
    );
    if (
      readiness.project.hookReadiness.status === 'inactive' &&
      readiness.project.hookReadiness.installed &&
      readiness.project.hookReadiness.discovered === 0
    ) {
      details.unshift(
        'Codex hooks/list discovered 0 project hooks; verify user-level $CODEX_HOME/config.toml contains [features] hooks = true.'
      );
    }
    return {
      name: 'OMX',
      status: 'warn',
      message: `OMX binary/API available, but project setup incomplete — run: ${OMX_PROJECT_SETUP_COMMAND}`,
      fixable: true,
      details,
    };
  }

  return {
    name: 'OMX',
    status: 'pass',
    message: `OMX OK (${omx.version ?? 'unknown version'}, omx api available, project setup ready)`,
    fixable: false,
  };
}

/**
 * Machine-oriented readiness gate for the exact project-managed shell advisor.
 * It intentionally emits no hook command, hash, environment, or credential data.
 */
export function checkManagedShellAdvisor(
  targetDir: string = process.cwd(),
  dependencies: ManagedShellAdvisorCheckDependencies = {}
): CheckResult {
  const readiness = (dependencies.assess ?? assessManagedShellAdvisorReadiness)(targetDir);
  const name = 'Managed shell advisor';

  switch (readiness.status) {
    case 'runnable':
      return {
        name,
        status: 'pass',
        message: 'Managed shell advisor is runnable.',
        fixable: false,
      };
    case 'missing':
      return {
        name,
        status: 'fail',
        message:
          'Managed shell advisor is missing. Run `omcustomcodex update --hooks`, then rerun this check.',
        fixable: false,
      };
    case 'assets-modified':
      return {
        name,
        status: 'fail',
        message:
          'Managed shell advisor assets differ from the packaged version. Review the intentional modification and back it up; then run `omcustomcodex update --hooks --force-overwrite-all` and rerun this check.',
        fixable: false,
      };
    case 'integrity-failed':
      return {
        name,
        status: 'fail',
        message:
          'Managed shell advisor registry differs from the packaged version. Review the modification and back it up; then run `omcustomcodex update --hooks --force-overwrite-all` and rerun this check.',
        fixable: false,
      };
    case 'inactive':
      return {
        name,
        status: 'fail',
        message:
          'Managed shell advisor is installed but inactive. Verify Codex hooks are enabled in the user-level $CODEX_HOME/config.toml with `[features] hooks = true`; also trust the project and review `/hooks`. Trust state is never written automatically. Then rerun this check.',
        fixable: false,
      };
    case 'approval-needed':
      return {
        name,
        status: 'fail',
        message:
          'Managed shell advisor needs approval. Trust the project and review it with `/hooks`; approval is never written automatically.',
        fixable: false,
      };
    case 'unverified':
      return {
        name,
        status: 'fail',
        message:
          'Managed shell advisor could not be verified through Codex app-server. Restore runtime discovery, then rerun this check.',
        fixable: false,
      };
  }
}

/**
 * Check configured OMX model lane routing hints.
 *
 * This diagnostic is intentionally observational: OMX owns the runtime model
 * contract, while oh-my-customcodex surfaces obvious lane drift in doctor output.
 */
export function checkOmxModelRouting(): CheckResult {
  const frontierModel = process.env.OMX_DEFAULT_FRONTIER_MODEL?.trim() || null;
  const sparkModel =
    process.env.OMX_DEFAULT_SPARK_MODEL?.trim() || process.env.OMX_SPARK_MODEL?.trim() || null;
  const usingLegacySpark = !process.env.OMX_DEFAULT_SPARK_MODEL?.trim() && Boolean(sparkModel);

  if (!frontierModel && !sparkModel) {
    return {
      name: 'OMX model lanes',
      status: 'pass',
      message: 'OMX model lane routing uses runtime defaults (no explicit env override)',
      fixable: false,
    };
  }

  const details = [
    `frontier=${frontierModel ?? 'runtime-default'}`,
    `spark=${sparkModel ?? 'runtime-default'}`,
  ];

  if (usingLegacySpark) {
    details.push('legacy OMX_SPARK_MODEL detected; prefer OMX_DEFAULT_SPARK_MODEL');
  }

  const sameExplicitLane =
    frontierModel !== null && sparkModel !== null && frontierModel === sparkModel;

  return {
    name: 'OMX model lanes',
    status: sameExplicitLane ? 'warn' : 'pass',
    message: sameExplicitLane
      ? `OMX Spark/model lane routing uses the same explicit model for frontier and spark (${frontierModel})`
      : 'OMX Spark/model lane routing overrides detected',
    fixable: false,
    details,
  };
}

/**
 * Check if contexts directory exists
 * @param targetDir - Target directory
 * @returns Check result
 */
export async function checkContexts(
  targetDir: string,
  rootDir: string = '.codex'
): Promise<CheckResult> {
  const contextsDir = path.join(targetDir, rootDir, 'contexts');
  const exists = await isDirectory(contextsDir);

  if (!exists) {
    return {
      name: 'Contexts',
      status: 'fail',
      message: `${rootDir}/contexts/ directory not found`,
      fixable: true,
    };
  }

  const contextFiles = await findFiles(contextsDir, /\.md$/);

  if (contextFiles.length === 0) {
    return {
      name: 'Contexts',
      status: 'warn',
      message: `${rootDir}/contexts/ directory is empty`,
      fixable: false,
    };
  }

  return {
    name: 'Contexts',
    status: 'pass',
    message: `Contexts OK (${contextFiles.length} files)`,
    fixable: false,
  };
}

/**
 * Check if custom components (managed:false) exist
 * @param targetDir - Target directory
 * @param rootDir - Root directory (.claude)
 * @returns Check result
 */
export async function checkCustomComponents(
  targetDir: string,
  _rootDir: string = '.codex'
): Promise<CheckResult> {
  try {
    const config = await loadConfig(targetDir);
    const customComponents = config.customComponents || [];

    if (customComponents.length === 0) {
      return {
        name: 'Custom components',
        status: 'pass',
        message: 'No custom components configured',
        fixable: false,
      };
    }

    const missing: string[] = [];

    for (const component of customComponents) {
      const fullPath = path.join(targetDir, component.path);
      if (!(await pathExists(fullPath))) {
        missing.push(component.path);
      }
    }

    if (missing.length > 0) {
      return {
        name: 'Custom components',
        status: 'warn',
        message: `Custom components: ${customComponents.length} items (${missing.length} missing)`,
        fixable: false,
        details: missing,
      };
    }

    return {
      name: 'Custom components',
      status: 'pass',
      message: `Custom components: ${customComponents.length} items (managed: false)`,
      fixable: false,
    };
  } catch {
    return {
      name: 'Custom components',
      status: 'pass',
      message: 'No config file found',
      fixable: false,
    };
  }
}

/**
 * Fix broken symlinks by removing them
 * @param targetDir - Target directory
 * @param brokenSymlinks - List of broken symlink paths
 * @returns Number of fixed symlinks
 */
async function fixBrokenSymlinks(targetDir: string, brokenSymlinks: string[]): Promise<number> {
  let plan: string[];

  try {
    plan = await prevalidateBrokenSymlinkRepairs(targetDir, brokenSymlinks);
  } catch {
    return 0;
  }

  let fixed = 0;
  for (const symlink of plan) {
    try {
      await fs.unlink(symlink);
      fixed++;
    } catch {
      // Ignore errors
    }
  }

  return fixed;
}

async function prevalidateBrokenSymlinkRepairs(
  targetDir: string,
  brokenSymlinks: string[]
): Promise<string[]> {
  const trustedRoot = path.resolve(targetDir);
  const plan: string[] = [];

  for (const symlink of brokenSymlinks) {
    const resolvedLink = path.resolve(symlink);
    const relativeLink = path.relative(trustedRoot, resolvedLink);
    if (relativeLink.startsWith('..') || path.isAbsolute(relativeLink)) {
      throw new Error(`Unsafe doctor repair path: ${symlink}`);
    }

    // A probe in the same parent validates every ancestor without rejecting
    // the leaf symlink that unlink() is intentionally meant to remove.
    await prevalidateSafeWritePath(
      path.join(path.dirname(resolvedLink), '.omcodex-doctor-delete-boundary'),
      trustedRoot
    );
    const stats = await fs.lstat(resolvedLink);
    if (!stats.isSymbolicLink()) {
      throw new Error(`Unsafe doctor repair target is not a symbolic link: ${resolvedLink}`);
    }
    plan.push(resolvedLink);
  }

  // Recheck every leaf before returning a mutation-ready plan so a stale
  // diagnostic cannot produce a partial unlink batch.
  for (const symlink of plan) {
    if (!(await fs.lstat(symlink)).isSymbolicLink()) {
      throw new Error(`Unsafe doctor repair target is not a symbolic link: ${symlink}`);
    }
  }

  return plan;
}

/**
 * Create missing directories
 * @param dirPath - Directory path to create
 * @returns true if created successfully
 */
async function createMissingDirectory(dirPath: string, trustedRoot: string): Promise<boolean> {
  try {
    const boundaryProbe = path.join(dirPath, '.omcodex-doctor-write-boundary');
    await prevalidateSafeWritePath(boundaryProbe, trustedRoot);
    // validateSafeWritePath creates only the safe parent directory; the probe
    // itself is never written.
    await validateSafeWritePath(boundaryProbe, trustedRoot);
    return true;
  } catch {
    return false;
  }
}

function getMissingDirectoryRepairPath(
  checkName: string,
  targetDir: string,
  rootDir: string
): string | null {
  const repairPaths: Record<string, string> = {
    Rules: path.join(targetDir, rootDir, 'rules'),
    Agents: path.join(targetDir, rootDir, 'agents'),
    Skills: path.join(targetDir, getComponentPath('skills')),
    Guides: path.join(targetDir, 'guides'),
    Hooks: path.join(targetDir, rootDir, 'hooks'),
    Contexts: path.join(targetDir, rootDir, 'contexts'),
  };

  return repairPaths[checkName] ?? null;
}

function getBrokenSymlinkRepairPaths(check: CheckResult, targetDir: string): string[] {
  if (check.name !== 'Symlinks' || !check.details) return [];
  return check.details.map((detail) => path.join(targetDir, detail));
}

async function prevalidateFilesystemRepairPlan(
  checks: CheckResult[],
  targetDir: string,
  rootDir: string
): Promise<boolean> {
  try {
    for (const check of checks) {
      if (check.status === 'pass' || !check.fixable) continue;

      const directoryPath = getMissingDirectoryRepairPath(check.name, targetDir, rootDir);
      if (directoryPath) {
        await prevalidateSafeWritePath(
          path.join(directoryPath, '.omcodex-doctor-write-boundary'),
          targetDir
        );
      }

      const brokenSymlinks = getBrokenSymlinkRepairPaths(check, targetDir);
      if (brokenSymlinks.length > 0) {
        await prevalidateBrokenSymlinkRepairs(targetDir, brokenSymlinks);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Fix a single check issue
 * @param check - Check result to fix
 * @param targetDir - Target directory
 * @returns true if fixed successfully
 */
async function fixSingleIssue(
  check: CheckResult,
  targetDir: string,
  rootDir: string = '.codex'
): Promise<boolean> {
  const directoryPath = getMissingDirectoryRepairPath(check.name, targetDir, rootDir);
  if (directoryPath) {
    return createMissingDirectory(directoryPath, targetDir);
  }

  const fixMap: Record<string, () => Promise<boolean>> = {
    Symlinks: async () => {
      const fullPaths = getBrokenSymlinkRepairPaths(check, targetDir);
      if (fullPaths.length === 0) return false;
      const fixedCount = await fixBrokenSymlinks(targetDir, fullPaths);
      return fixedCount > 0;
    },
    RTK: async () => Promise.resolve(installRtk()),
    Codex: async () => Promise.resolve(installCodex()),
    OMX: async () => Promise.resolve(ensureOmxProjectReady(targetDir).success),
  };

  const fixer = fixMap[check.name];
  return fixer ? fixer() : false;
}

/**
 * Fix issues that can be automatically fixed
 * @param checks - Check results to fix
 * @param targetDir - Target directory
 * @returns Updated check results with fix status
 */
export async function fixIssues(
  checks: CheckResult[],
  targetDir: string,
  rootDir: string = '.codex'
): Promise<CheckResult[]> {
  if (!(await prevalidateFilesystemRepairPlan(checks, targetDir, rootDir))) {
    return [...checks];
  }

  const fixedChecks: CheckResult[] = [];

  for (const check of checks) {
    if (check.status === 'pass' || !check.fixable) {
      fixedChecks.push(check);
      continue;
    }

    console.log(i18n.t('cli.doctor.fixing', { name: check.name }));
    const fixed = await fixSingleIssue(check, targetDir, rootDir);

    fixedChecks.push(
      fixed
        ? { ...check, fixed: true, message: i18n.t('cli.doctor.fixed', { name: check.name }) }
        : check
    );
  }

  return fixedChecks;
}

/**
 * Print check result with appropriate icon
 * @param check - Check result to print
 */
export function printCheck(check: CheckResult): void {
  const icons: Record<CheckStatus, string> = {
    pass: '[PASS]',
    warn: '[WARN]',
    fail: '[FAIL]',
  };

  const icon = icons[check.status];
  const fixedLabel = check.fixed ? ' (fixed)' : '';

  console.log(`  ${icon} ${check.name}: ${check.message}${fixedLabel}`);

  // Print details if available (e.g., list of broken symlinks)
  if (check.details && check.details.length > 0 && !check.fixed) {
    for (const detail of check.details.slice(0, 5)) {
      console.log(`         - ${detail}`);
    }
    if (check.details.length > 5) {
      console.log(`         ... and ${check.details.length - 5} more`);
    }
  }
}

/**
 * Read the current package version from package.json
 * @returns Semver string, or '0.0.0' on failure
 */
function readCurrentVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const packageJsonPath = path.resolve(path.dirname(__filename), '../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };
    return packageJson.version;
  } catch {
    return '0.0.0';
  }
}

/**
 * Check for lockfile drift: compare recorded template hashes with current file hashes.
 * Returns 'skip' if no lockfile exists (not an omcodex project).
 * Returns 'warn' if any files were modified, added, or removed since install.
 * Returns 'pass' if all files match the recorded hashes.
 * @param targetDir - Target directory containing the current harness lockfile
 * @returns Check result indicating lockfile drift status, or null if no lockfile exists
 */
export async function checkLockfileDrift(targetDir: string): Promise<CheckResult | null> {
  const lockfile = await readLockfile(targetDir);

  if (!lockfile) {
    return null;
  }

  const modified: string[] = [];
  const removed: string[] = [];
  const rootContext = resolveLockfileRootContext(targetDir);

  for (const [relativePath, entry] of Object.entries(lockfile.files)) {
    try {
      const current = await computeLockfileEntryMetadata(
        targetDir,
        relativePath,
        entry,
        rootContext
      );
      if (current.templateHash !== entry.templateHash) {
        modified.push(relativePath);
      }
    } catch {
      // File no longer exists
      removed.push(relativePath);
    }
  }

  const driftedFiles = [...modified, ...removed];

  if (driftedFiles.length === 0) {
    return {
      name: 'Lockfile',
      status: 'pass',
      message: `Lockfile OK — no drift detected (${Object.keys(lockfile.files).length} files tracked)`,
      fixable: false,
    };
  }

  const details: string[] = [
    ...modified.map((f) => `modified: ${f}`),
    ...removed.map((f) => `removed: ${f}`),
  ];

  return {
    name: 'Lockfile',
    status: 'warn',
    message: `Lockfile drift detected: ${driftedFiles.length} file(s) changed since install`,
    fixable: false,
    details,
  };
}

/**
 * Check if the installed framework version (currently stored in the harness rc file) is behind the CLI version
 * @param targetDir - Project directory containing the current harness rc file
 * @param currentVersion - The CLI's own version (latest)
 * @returns Check result indicating framework drift status, or null if no rc file found
 */
export async function checkFrameworkDrift(
  targetDir: string,
  currentVersion: string
): Promise<CheckResult | null> {
  const result = await checkFrameworkVersion(targetDir, currentVersion);
  if (!result) return null;

  if (result.isOutdated) {
    return {
      name: 'Framework',
      status: 'warn',
      message: i18n.t('cli.doctor.checks.framework.warn', {
        installed: result.installed,
        latest: result.latest,
        behind: String(result.versionsBehind),
      }),
      fixable: false,
    };
  }

  return {
    name: 'Framework',
    status: 'pass',
    message: i18n.t('cli.doctor.checks.framework.pass', { version: result.installed }),
    fixable: false,
  };
}

/**
 * Check if a newer version of oh-my-customcodex is available
 * @param currentVersion - The currently installed version
 * @returns Check result indicating update status
 */
export function checkUpdateAvailable(currentVersion: string): CheckResult {
  const result = checkSelfUpdate({ currentVersion });

  if (!result.checked) {
    return {
      name: 'Update',
      status: 'warn',
      message: i18n.t('cli.doctor.updateCheckFailed', { reason: result.reason ?? 'unknown' }),
      fixable: false,
    };
  }

  if (result.updateAvailable && result.latestVersion !== null) {
    return {
      name: 'Update',
      status: 'warn',
      message: i18n.t('cli.doctor.updateAvailable', {
        current: currentVersion,
        latest: result.latestVersion,
      }),
      fixable: false,
      details: result.usedCache ? ['(checked from cache)'] : ['(checked from npm registry)'],
    };
  }

  return {
    name: 'Update',
    status: 'pass',
    message: i18n.t('cli.doctor.updateUpToDate', { version: currentVersion }),
    fixable: false,
  };
}

/**
 * Run all diagnostic checks and return the combined list
 */
async function runAllChecks(
  targetDir: string,
  layout: { entryFile: string; rootDir: string },
  packageVersion: string,
  includeUpdates: boolean
): Promise<CheckResult[]> {
  const baseChecks: CheckResult[] = await Promise.all([
    checkEntryDoc(targetDir, layout.entryFile),
    checkRules(targetDir, layout.rootDir),
    checkAgents(targetDir, layout.rootDir),
    checkSkills(targetDir, layout.rootDir),
    checkSymlinks(targetDir, layout.rootDir),
    checkIndexFiles(targetDir),
    checkGuides(targetDir),
    checkHooks(targetDir, layout.rootDir),
    checkContexts(targetDir, layout.rootDir),
    checkCustomComponents(targetDir, layout.rootDir),
    checkRtk(),
    checkCodex(),
    checkOmx(targetDir),
    checkOmxModelRouting(),
  ]);

  // Framework version drift check (always runs when the harness rc file exists)
  const frameworkCheck = await checkFrameworkDrift(targetDir, packageVersion);
  const checksWithFramework = frameworkCheck ? [...baseChecks, frameworkCheck] : baseChecks;

  // Lockfile drift check (runs when the harness lockfile exists)
  const lockfileCheck = await checkLockfileDrift(targetDir);
  const checksWithLockfile = lockfileCheck
    ? [...checksWithFramework, lockfileCheck]
    : checksWithFramework;

  // Optionally append update check
  return includeUpdates
    ? [...checksWithLockfile, checkUpdateAvailable(packageVersion)]
    : checksWithLockfile;
}

async function applyFixesAndRecheck(
  initialChecks: CheckResult[],
  targetDir: string,
  layout: { entryFile: string; rootDir: string },
  packageVersion: string,
  includeUpdates: boolean,
  dependencies: DoctorCommandDependencies,
  runChecks: NonNullable<DoctorCommandDependencies['runAllChecks']>
): Promise<CheckResult[]> {
  console.log(i18n.t('cli.doctor.applyingFixes'));
  console.log('');

  const applyFixes = dependencies.fixIssues ?? fixIssues;
  const fixAttempts = await applyFixes(initialChecks, targetDir, layout.rootDir);
  const attemptedFixNames = new Set(
    fixAttempts.filter((check) => check.fixed).map((check) => check.name)
  );
  const freshChecks = await runChecks(targetDir, layout, packageVersion, includeUpdates);

  console.log('');
  return freshChecks.map((check) =>
    attemptedFixNames.has(check.name) && check.status === 'pass' ? { ...check, fixed: true } : check
  );
}

function printChecks(checks: CheckResult[], quiet: boolean): void {
  for (const check of checks) {
    if (!quiet || check.status !== 'pass') {
      printCheck(check);
    }
  }
}

/**
 * Execute the doctor command
 * @param options - Doctor command options
 * @returns Result of the doctor operation
 */
export async function doctorCommand(
  options: DoctorOptions = {},
  dependencies: DoctorCommandDependencies = {}
): Promise<DoctorResult> {
  const targetDir = process.cwd();

  console.log(i18n.t('cli.doctor.checking'));
  console.log('');

  const layout = getProviderLayout();
  const packageVersion = readCurrentVersion();

  // The release preflight gate must not inherit unrelated doctor inventory state.
  const runChecks = dependencies.runAllChecks ?? runAllChecks;
  const checksWithUpdate = options.requireShellAdvisor
    ? [(dependencies.checkManagedShellAdvisor ?? checkManagedShellAdvisor)(targetDir)]
    : await runChecks(targetDir, layout, packageVersion, options.updates ?? false);

  // Apply fixes if requested
  let checks: CheckResult[] = checksWithUpdate;
  if (
    !options.requireShellAdvisor &&
    options.fix &&
    checksWithUpdate.some((check) => check.status !== 'pass' && check.fixable)
  ) {
    checks = await applyFixesAndRecheck(
      checksWithUpdate,
      targetDir,
      layout,
      packageVersion,
      options.updates ?? false,
      dependencies,
      runChecks
    );
  }

  // Print results
  printChecks(checks, options.quiet ?? false);

  // Calculate counts
  const passCount = checks.filter((c) => c.status === 'pass').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const failCount = checks.filter((c) => c.status === 'fail').length;
  const fixedCount = checks.filter((c) => c.fixed).length;

  // Print summary
  console.log('');

  if (failCount === 0) {
    console.log(i18n.t('cli.doctor.passed'));
  } else {
    console.log(i18n.t('cli.doctor.failed'));

    if (!options.fix) {
      const fixableCount = checks.filter((c) => c.status === 'fail' && c.fixable).length;
      if (fixableCount > 0) {
        console.log(i18n.t('cli.doctor.runWithFix', { count: fixableCount }));
      }
    }
  }

  console.log(
    i18n.t('cli.doctor.summary', {
      pass: passCount,
      warn: warnCount,
      fail: failCount,
      fixed: fixedCount,
    })
  );

  return {
    success: failCount === 0,
    checks,
    passCount,
    warnCount,
    failCount,
    fixedCount,
  };
}

export default doctorCommand;
