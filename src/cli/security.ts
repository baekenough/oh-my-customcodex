/**
 * omcodex security command
 * Scans for security issues in hooks, configs, and templates
 */

import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveCodexProjectRoot } from '../core/codex-project-root.js';
import {
  extractHookCommands,
  extractHookExecutableReferences,
  type HookExecutableReference,
} from '../core/hook-references.js';
import { getProviderLayout } from '../core/layout.js';
import { i18n } from '../i18n/index.js';
import { type CheckResult, type CheckStatus, printCheck } from './doctor.js';

/**
 * Options for the security command
 */
export interface SecurityOptions {
  /** Show detailed scan results */
  verbose?: boolean;
}

/**
 * Result of the security command
 */
export interface SecurityResult {
  success: boolean;
  checks: CheckResult[];
  passCount: number;
  warnCount: number;
  failCount: number;
}

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
 * Check if content is valid UTF-8 text.
 * Buffer.toString('utf-8') never throws — invalid bytes are silently replaced
 * with U+FFFD. We detect non-text content by checking for null bytes instead,
 * which are absent in well-formed text files but common in binary files.
 */
function isValidUtf8Text(content: Buffer): boolean {
  return !content.includes(0x00);
}

/**
 * Recursively find all files in a directory
 */
async function findAllFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const subResults = await findAllFiles(fullPath);
        results.push(...subResults);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore errors (permission issues, etc.)
  }

  return results;
}

// Note: These patterns detect dangerous shell constructs in hooks, not actual code usage
const DANGEROUS_PATTERNS = [
  {
    pattern: /rm\s+-rf\s+[/~]/,
    name: 'rm -rf with root/home path',
    severity: 'fail' as CheckStatus,
  },
  {
    pattern: /curl\s+.*\|\s*(bash|sh|eval)/,
    name: 'curl pipe to shell',
    severity: 'fail' as CheckStatus,
  },
  {
    pattern: /wget\s+.*\|\s*(bash|sh|eval)/,
    name: 'wget pipe to shell',
    severity: 'fail' as CheckStatus,
  },
  { pattern: /\bsudo\b/, name: 'sudo usage', severity: 'warn' as CheckStatus },
  { pattern: /chmod\s+777/, name: 'chmod 777', severity: 'warn' as CheckStatus },
  { pattern: /\beval\s*\(/, name: 'eval() usage', severity: 'warn' as CheckStatus },
  {
    pattern: /\$\{.*:-.*\}.*>\s*\/etc/,
    name: 'write to /etc',
    severity: 'fail' as CheckStatus,
  },
  {
    pattern: /base64\s+(-d|--decode).*\|\s*(bash|sh)/,
    name: 'base64 decode to shell',
    severity: 'fail' as CheckStatus,
  },
];

async function resolveHookRegistryPath(targetDir: string, rootDir: string): Promise<string> {
  const nativeRegistry = path.join(targetDir, rootDir, 'hooks.json');
  if (await pathExists(nativeRegistry)) {
    return nativeRegistry;
  }

  // Preserve security coverage for installations created before the native
  // registry moved from .codex/hooks/hooks.json to .codex/hooks.json.
  return path.join(targetDir, rootDir, 'hooks', 'hooks.json');
}

/**
 * Scan commands for dangerous patterns
 * Complexity is inherent to pattern matching logic
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Security pattern scanning requires comprehensive checks
function scanCommands(commands: string[]): { findings: string[]; worstSeverity: CheckStatus } {
  const findings: string[] = [];
  let worstSeverity: CheckStatus = 'pass';

  for (const command of commands) {
    for (const { pattern, name, severity } of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        findings.push(`${name}: ${command.substring(0, 80)}${command.length > 80 ? '...' : ''}`);
        if (severity === 'fail') {
          worstSeverity = 'fail';
        } else if (severity === 'warn' && worstSeverity === 'pass') {
          worstSeverity = 'warn';
        }
      }
    }
  }

  return { findings, worstSeverity };
}

interface ReferencedExecutableScan {
  findings: string[];
  worstSeverity: CheckStatus;
  scannedPaths: string[];
}

function worstStatus(left: CheckStatus, right: CheckStatus): CheckStatus {
  if (left === 'fail' || right === 'fail') return 'fail';
  if (left === 'warn' || right === 'warn') return 'warn';
  return 'pass';
}

function escapesRoot(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath.startsWith('..') || path.isAbsolute(relativePath);
}

function displayPath(targetDir: string, targetPath: string): string {
  const relativePath = path.relative(targetDir, targetPath);
  return relativePath && !path.isAbsolute(relativePath) ? relativePath : targetPath;
}

interface ShellDataRange {
  start: number;
  end: number;
}

function findBacktickEnd(content: string, start: number): number | null {
  for (let index = start; index < content.length; index += 1) {
    if (content[index] === '\\') {
      index += 1;
      continue;
    }
    if (content[index] === '`') return index;
  }
  return null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Bounded shell-substitution matching keeps nested quote state explicit.
function findCommandSubstitutionEnd(
  content: string,
  start: number,
  nesting: number = 0
): number | null {
  if (nesting >= 32) return null;
  let depth = 1;
  let quote: '"' | "'" | '`' | null = null;

  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (character === '\\' && quote !== "'") {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else if (quote !== "'" && character === '$' && content[index + 1] === '(') {
        const nestedEnd = findCommandSubstitutionEnd(content, index + 2, nesting + 1);
        if (nestedEnd === null) return null;
        index = nestedEnd;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '$' && content[index + 1] === '(') {
      const nestedEnd = findCommandSubstitutionEnd(content, index + 2, nesting + 1);
      if (nestedEnd === null) return null;
      index = nestedEnd;
      continue;
    }
    if (character === '(') {
      depth += 1;
      if (depth > 32) return null;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function appendNestedShellDataRanges(
  ranges: ShellDataRange[],
  content: string,
  start: number,
  end: number
): void {
  for (const range of shellDataRanges(content.slice(start, end))) {
    ranges.push({ start: start + range.start, end: start + range.end });
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Shell quoting, comments, and command-boundary state are intentionally explicit.
function shellDataRanges(content: string): ShellDataRange[] {
  const ranges: ShellDataRange[] = [];
  let quote: '"' | "'" | null = null;
  let quoteDataStart = -1;
  let quoteIsCommandWord = false;
  let commandStart = true;
  let wordStart = -1;
  let word = '';

  const finishWord = (): void => {
    if (wordStart < 0) return;
    if (commandStart) {
      const preservesCommandStart =
        /^[A-Za-z_][A-Za-z0-9_]*=/.test(word) ||
        [
          '!',
          'command',
          'exec',
          'builtin',
          'env',
          'if',
          'then',
          'elif',
          'while',
          'until',
          'do',
        ].includes(word);
      if (!preservesCommandStart) commandStart = false;
    }
    wordStart = -1;
    word = '';
  };

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quote) {
      if (character === '\\' && quote === '"') {
        index += 1;
        continue;
      }
      if (quote === '"' && character === '$' && content[index + 1] === '(') {
        if (!quoteIsCommandWord && quoteDataStart < index) {
          ranges.push({ start: quoteDataStart, end: index });
        }
        const nestedStart = index + 2;
        const nestedEnd = findCommandSubstitutionEnd(content, nestedStart);
        appendNestedShellDataRanges(ranges, content, nestedStart, nestedEnd ?? content.length);
        if (nestedEnd === null) {
          quote = null;
          quoteDataStart = content.length;
          break;
        }
        index = nestedEnd;
        quoteDataStart = nestedEnd + 1;
        continue;
      }
      if (quote === '"' && character === '`') {
        if (!quoteIsCommandWord && quoteDataStart < index) {
          ranges.push({ start: quoteDataStart, end: index });
        }
        const nestedStart = index + 1;
        const nestedEnd = findBacktickEnd(content, nestedStart);
        appendNestedShellDataRanges(ranges, content, nestedStart, nestedEnd ?? content.length);
        if (nestedEnd === null) {
          quote = null;
          quoteDataStart = content.length;
          break;
        }
        index = nestedEnd;
        quoteDataStart = nestedEnd + 1;
        continue;
      }
      if (character === quote) {
        if (!quoteIsCommandWord && quoteDataStart < index + 1) {
          ranges.push({ start: quoteDataStart, end: index + 1 });
        }
        quote = null;
      }
      continue;
    }

    if (character === '\\') {
      if (wordStart < 0) wordStart = index;
      word += character;
      if (index + 1 < content.length) {
        word += content[index + 1];
        index += 1;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      quoteDataStart = index;
      quoteIsCommandWord = commandStart && wordStart < 0;
      if (wordStart < 0) wordStart = index;
      continue;
    }

    if (character === '#' && wordStart < 0) {
      const lineEnd = content.indexOf('\n', index);
      ranges.push({ start: index, end: lineEnd < 0 ? content.length : lineEnd });
      if (lineEnd < 0) break;
      index = lineEnd - 1;
      continue;
    }

    if (/\s/.test(character)) {
      finishWord();
      if (character === '\n') commandStart = true;
      continue;
    }

    if (/[;&|()]/.test(character)) {
      const arrayAssignment = character === '(' && /^[A-Za-z_][A-Za-z0-9_]*\+?=$/.test(word);
      finishWord();
      commandStart = character !== ')' && !arrayAssignment;
      continue;
    }

    if (wordStart < 0) wordStart = index;
    word += character;
  }

  if (quote && !quoteIsCommandWord) ranges.push({ start: quoteDataStart, end: content.length });
  return ranges;
}

function firstExecutablePatternMatch(
  content: string,
  pattern: RegExp,
  dataRanges: ShellDataRange[]
): RegExpExecArray | null {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const scanner = new RegExp(pattern.source, flags);
  for (let match = scanner.exec(content); match; match = scanner.exec(content)) {
    const inData = dataRanges.some(({ start, end }) => match.index >= start && match.index < end);
    if (!inData) return match;
    if (match[0].length === 0) scanner.lastIndex += 1;
  }
  return null;
}

function excerptAt(content: string, matchIndex: number): string {
  const lineStart = content.lastIndexOf('\n', matchIndex) + 1;
  const nextLine = content.indexOf('\n', matchIndex);
  return content.slice(lineStart, nextLine === -1 ? undefined : nextLine).trim();
}

function scanExecutableBody(
  content: string,
  relativePath: string
): { findings: string[]; worstSeverity: CheckStatus } {
  const findings: string[] = [];
  let worstSeverity: CheckStatus = 'pass';
  const dataRanges = shellDataRanges(content);

  for (const { pattern, name, severity } of DANGEROUS_PATTERNS) {
    const match = firstExecutablePatternMatch(content, pattern, dataRanges);
    if (!match) continue;
    const excerpt = excerptAt(content, match.index).replace(/\s+/g, ' ');
    findings.push(
      `${name}: ${relativePath}: ${excerpt.substring(0, 80)}${excerpt.length > 80 ? '...' : ''}`
    );
    worstSeverity = worstStatus(worstSeverity, severity);
  }

  return { findings, worstSeverity };
}

function uniqueExecutableReferences(
  commands: string[],
  rootDir: string
): HookExecutableReference[] {
  const unique = new Map<string, HookExecutableReference>();
  for (const command of commands) {
    for (const reference of extractHookExecutableReferences(command, rootDir)) {
      const key = reference.path ?? `${reference.source}:${reference.raw}`;
      if (!unique.has(key)) unique.set(key, reference);
    }
  }
  return [...unique.values()];
}

async function readTrustedHookRoot(
  hooksRoot: string
): Promise<{ available: boolean; realPath: string; finding?: string }> {
  try {
    const stats = await fs.lstat(hooksRoot);
    if (stats.isSymbolicLink()) {
      return {
        available: false,
        realPath: hooksRoot,
        finding: `Trusted hook root is a symbolic link and was not scanned: ${hooksRoot}`,
      };
    }
    if (!stats.isDirectory()) {
      return {
        available: false,
        realPath: hooksRoot,
        finding: `Trusted hook root is not a directory and was not scanned: ${hooksRoot}`,
      };
    }
    return { available: true, realPath: await fs.realpath(hooksRoot) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { available: false, realPath: hooksRoot };
    }
    return {
      available: false,
      realPath: hooksRoot,
      finding: `Trusted hook root could not be inspected: ${hooksRoot}`,
    };
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Security classification keeps each conservative path outcome explicit.
async function scanReferencedExecutableBodies(
  targetDir: string,
  rootDir: string,
  commands: string[]
): Promise<ReferencedExecutableScan> {
  const findings: string[] = [];
  let worstSeverity: CheckStatus = 'pass';
  const scannedPaths = new Set<string>();
  const references = uniqueExecutableReferences(commands, rootDir);
  if (references.length === 0) return { findings, worstSeverity, scannedPaths: [] };

  const projectRoot = path.resolve(targetDir);
  const hooksRoot = path.resolve(targetDir, rootDir, 'hooks');
  const trustedRoot = await readTrustedHookRoot(hooksRoot);
  if (trustedRoot.finding) {
    findings.push(trustedRoot.finding);
    worstSeverity = 'fail';
  }

  for (const reference of references) {
    if (!reference.path) {
      findings.push(`Dynamic hook executable path was not scanned: ${reference.raw}`);
      worstSeverity = worstStatus(worstSeverity, 'warn');
      continue;
    }

    const candidate = path.isAbsolute(reference.path)
      ? path.resolve(reference.path)
      : path.resolve(targetDir, reference.path);
    if (escapesRoot(hooksRoot, candidate)) {
      if (escapesRoot(projectRoot, candidate)) {
        findings.push(`External hook executable was not scanned: ${reference.raw}`);
        worstSeverity = worstStatus(worstSeverity, 'warn');
      } else {
        findings.push(`Hook executable escapes trusted hook root: ${reference.raw}`);
        worstSeverity = 'fail';
      }
      continue;
    }

    try {
      const lexicalStats = await fs.lstat(candidate);
      const realCandidate = await fs.realpath(candidate);
      if (!trustedRoot.available || escapesRoot(trustedRoot.realPath, realCandidate)) {
        const kind = lexicalStats.isSymbolicLink() ? 'symbolic link' : 'path';
        findings.push(
          `Hook executable ${kind} escapes trusted hook root: ${displayPath(targetDir, candidate)}`
        );
        worstSeverity = 'fail';
        continue;
      }

      const stats = await fs.stat(realCandidate);
      if (!stats.isFile()) {
        findings.push(
          `Referenced hook executable is not a regular file: ${displayPath(targetDir, candidate)}`
        );
        worstSeverity = worstStatus(worstSeverity, 'warn');
        continue;
      }

      const content = await fs.readFile(realCandidate);
      if (!isValidUtf8Text(content)) {
        findings.push(
          `Referenced hook executable is not text and was not scanned: ${displayPath(
            targetDir,
            candidate
          )}`
        );
        worstSeverity = worstStatus(worstSeverity, 'warn');
        continue;
      }

      const relativePath = displayPath(targetDir, candidate);
      scannedPaths.add(relativePath);
      const bodyScan = scanExecutableBody(content.toString('utf-8'), relativePath);
      findings.push(...bodyScan.findings);
      worstSeverity = worstStatus(worstSeverity, bodyScan.worstSeverity);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      findings.push(
        code === 'ENOENT'
          ? `Referenced hook executable is missing: ${displayPath(targetDir, candidate)}`
          : `Referenced hook executable could not be scanned: ${displayPath(targetDir, candidate)}`
      );
      worstSeverity = worstStatus(worstSeverity, 'warn');
    }
  }

  return { findings, worstSeverity, scannedPaths: [...scannedPaths].sort() };
}

/**
 * Check hook scripts for dangerous patterns
 * @param targetDir - Target directory
 * @param rootDir - Provider root directory (.codex)
 * @returns Check result
 */
export async function checkHookScripts(
  targetDir: string,
  rootDir: string = '.codex'
): Promise<CheckResult> {
  const projectRoot = resolveCodexProjectRoot(targetDir);
  const hooksFile = await resolveHookRegistryPath(projectRoot, rootDir);
  const exists = await pathExists(hooksFile);

  if (!exists) {
    return {
      name: 'Hook scripts',
      status: 'pass',
      message: i18n.t('cli.security.checks.hooks.notFound'),
      fixable: false,
    };
  }

  try {
    const content = await fs.readFile(hooksFile, 'utf-8');
    const hooks = JSON.parse(content);

    const commands = extractHookCommands(hooks);
    const commandScan = scanCommands(commands);
    const executableScan = await scanReferencedExecutableBodies(projectRoot, rootDir, commands);
    const findings = [...commandScan.findings, ...executableScan.findings];
    const worstSeverity = worstStatus(commandScan.worstSeverity, executableScan.worstSeverity);

    if (findings.length > 0) {
      const message =
        worstSeverity === 'fail'
          ? i18n.t('cli.security.checks.hooks.fail')
          : i18n.t('cli.security.checks.hooks.warn');

      return {
        name: 'Hook scripts',
        status: worstSeverity,
        message: `${message} (${findings.length} issues)`,
        fixable: false,
        details: findings,
      };
    }

    return {
      name: 'Hook scripts',
      status: 'pass',
      message:
        executableScan.scannedPaths.length > 0
          ? `${i18n.t('cli.security.checks.hooks.pass')} (${i18n.t(
              'cli.security.checks.hooks.coverage',
              { count: executableScan.scannedPaths.length }
            )})`
          : i18n.t('cli.security.checks.hooks.declarationsOnly'),
      fixable: false,
    };
  } catch (error: unknown) {
    return {
      name: 'Hook scripts',
      status: 'warn',
      message: `Failed to parse hooks.json: ${error instanceof Error ? error.message : String(error)}`,
      fixable: false,
    };
  }
}

/**
 * Check configuration files for secrets
 * @param targetDir - Target directory
 * @param rootDir - Root directory (.claude)
 * @returns Check result
 */
export async function checkConfigSecrets(
  targetDir: string,
  rootDir: string = '.codex'
): Promise<CheckResult> {
  const configDir = path.join(targetDir, rootDir);
  const exists = await pathExists(configDir);

  if (!exists) {
    return {
      name: 'Config secrets',
      status: 'pass',
      message: i18n.t('cli.security.checks.secrets.pass'),
      fixable: false,
    };
  }

  const SECRET_PATTERNS = [
    {
      pattern: /(?:AWS_SECRET|AWS_ACCESS_KEY|AWS_SESSION)[_A-Z]*\s*[=:]\s*['"]?[A-Za-z0-9/+=]{20,}/,
      name: 'AWS credential',
    },
    {
      pattern:
        /(?:GITHUB_TOKEN|GH_TOKEN|GITHUB_PAT)\s*[=:]\s*['"]?(?:ghp_|gho_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]+/,
      name: 'GitHub token',
    },
    {
      pattern: /(?:sk-|sk_live_|sk_test_)[A-Za-z0-9]{20,}/,
      name: 'API secret key (sk-*)',
    },
    {
      pattern: /(?:password|passwd|secret)\s*[=:]\s*['"]?[^\s'"]{8,}/i,
      name: 'Hardcoded password/secret',
    },
    {
      pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
      name: 'Private key',
    },
  ];

  const files = await findAllFiles(configDir);
  const findings: string[] = [];

  for (const file of files) {
    try {
      const content = await fs.readFile(file);

      // Skip binary files
      if (!isValidUtf8Text(content)) {
        continue;
      }

      const text = content.toString('utf-8');

      for (const { pattern, name } of SECRET_PATTERNS) {
        if (pattern.test(text)) {
          const relativePath = path.relative(targetDir, file);
          findings.push(`${relativePath}: ${name}`);
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  if (findings.length > 0) {
    return {
      name: 'Config secrets',
      status: 'fail',
      message: `${i18n.t('cli.security.checks.secrets.fail')} (${findings.length} found)`,
      fixable: false,
      details: findings,
    };
  }

  return {
    name: 'Config secrets',
    status: 'pass',
    message: i18n.t('cli.security.checks.secrets.pass'),
    fixable: false,
  };
}

/**
 * Check for sensitive environment files
 */
async function checkEnvFiles(
  targetDir: string
): Promise<{ findings: string[]; severity: CheckStatus }> {
  const findings: string[] = [];
  let severity: CheckStatus = 'pass';

  const envFiles = ['.env', '.env.local', '.env.production', '.env.development'];
  for (const envFile of envFiles) {
    const envPath = path.join(targetDir, envFile);
    if (await pathExists(envPath)) {
      findings.push(`Security-sensitive file found: ${envFile}`);
      severity = 'fail';
    }
  }

  return { findings, severity };
}

/**
 * Check shell script permissions
 */
async function checkShellPermissions(
  targetDir: string,
  shellScripts: string[]
): Promise<{ findings: string[]; severity: CheckStatus }> {
  const findings: string[] = [];
  let severity: CheckStatus = 'pass';

  for (const script of shellScripts) {
    try {
      const stats = await fs.stat(script);
      const mode = stats.mode & 0o777;
      const relativePath = path.relative(targetDir, script);

      // Check for overly permissive permissions (777 or world-writable)
      if (mode === 0o777) {
        findings.push(`Overly permissive permissions (777): ${relativePath}`);
        if (severity === 'pass') {
          severity = 'warn';
        }
      } else if (mode & 0o002) {
        findings.push(`World-writable: ${relativePath}`);
        if (severity === 'pass') {
          severity = 'warn';
        }
      }
    } catch {
      // Ignore stat errors
    }
  }

  return { findings, severity };
}

/**
 * Check template file permissions and sensitive files
 * @param targetDir - Target directory
 * @returns Check result
 */
export async function checkTemplateIntegrity(targetDir: string): Promise<CheckResult> {
  let worstSeverity: CheckStatus = 'pass';
  const allFindings: string[] = [];

  // Check for .env files in project root
  const envCheck = await checkEnvFiles(targetDir);
  allFindings.push(...envCheck.findings);
  if (envCheck.severity === 'fail') {
    worstSeverity = 'fail';
  }

  // Find and check shell script permissions
  const allFiles = await findAllFiles(targetDir);
  const shellScripts = allFiles.filter((f) => f.endsWith('.sh'));
  const permCheck = await checkShellPermissions(targetDir, shellScripts);
  allFindings.push(...permCheck.findings);
  if (permCheck.severity === 'warn' && worstSeverity === 'pass') {
    worstSeverity = 'warn';
  }

  if (allFindings.length > 0) {
    const message =
      worstSeverity === 'fail'
        ? i18n.t('cli.security.checks.integrity.fail')
        : i18n.t('cli.security.checks.integrity.warn');

    return {
      name: 'Template integrity',
      status: worstSeverity,
      message: `${message} (${allFindings.length} issues)`,
      fixable: false,
      details: allFindings,
    };
  }

  return {
    name: 'Template integrity',
    status: 'pass',
    message: i18n.t('cli.security.checks.integrity.pass'),
    fixable: false,
  };
}

/**
 * Execute the security command
 * @param _options - Security command options (reserved for future use)
 * @returns Result of the security scan
 */
export async function securityCommand(_options: SecurityOptions = {}): Promise<SecurityResult> {
  const targetDir = process.cwd();

  console.log(i18n.t('cli.security.scanning'));
  console.log('');

  const layout = getProviderLayout();

  // Run all checks in parallel
  const checks: CheckResult[] = await Promise.all([
    checkHookScripts(targetDir, layout.rootDir),
    checkConfigSecrets(targetDir, layout.rootDir),
    checkTemplateIntegrity(targetDir),
  ]);

  // Print results
  for (const check of checks) {
    printCheck(check);
  }

  // Calculate counts
  const passCount = checks.filter((c) => c.status === 'pass').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const failCount = checks.filter((c) => c.status === 'fail').length;

  // Print summary
  console.log('');

  if (failCount === 0 && warnCount === 0) {
    console.log(i18n.t('cli.security.passed'));
  } else {
    console.log(i18n.t('cli.security.failed'));
  }

  console.log(
    i18n.t('cli.security.summary', {
      pass: passCount,
      warn: warnCount,
      fail: failCount,
    })
  );

  return {
    success: failCount === 0,
    checks,
    passCount,
    warnCount,
    failCount,
  };
}

export default securityCommand;
