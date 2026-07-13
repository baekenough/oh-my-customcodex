/**
 * Extract executable references from native hook command declarations.
 *
 * This intentionally parses only the declaration boundary. Security callers
 * may follow the explicit omcustomcodex managed-marker hop, but arbitrary
 * commands launched later by a referenced script are outside this parser's
 * coverage and must not be described as recursively scanned.
 */

import { isAbsolute, resolve as resolvePath } from 'node:path';

const SHELL_INTERPRETER_WORD = /^(?:\/(?:usr\/)?bin\/)?(?:bash|dash|ksh|sh|zsh)$/;
const SCRIPT_RUNTIME_WORD = /^(?:\/(?:usr\/)?bin\/)?(?:bun|node)$/;
const MANAGED_MARKER = /#\s*omcustomcodex-hook:([A-Za-z0-9._-]+\.sh)\s*$/g;

export interface HookExecutableReference {
  raw: string;
  path: string | null;
  source: 'shell-operand' | 'direct-command' | 'direct-hook-path' | 'managed-marker';
}

/** Extract command values from both native Codex and legacy hook registries. */
export function extractHookCommands(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(extractHookCommands);
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const commands = typeof record.command === 'string' ? [record.command] : [];
  for (const [key, child] of Object.entries(record)) {
    if (key !== 'command') {
      commands.push(...extractHookCommands(child));
    }
  }
  return commands;
}

interface ShellWord {
  raw: string;
  value: string;
  start: number;
  end: number;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Quoted shell-word parsing is a small state machine.
function readShellWord(command: string, start: number): ShellWord | null {
  let index = start;
  while (index < command.length && /\s/.test(command[index])) index += 1;
  if (index >= command.length || /[;&|()]/.test(command[index])) return null;

  const wordStart = index;
  let value = '';
  let quote: '"' | "'" | null = null;

  while (index < command.length) {
    const character = command[index];
    if (!quote && (/\s/.test(character) || /[;&|()]/.test(character))) break;
    if (character === '\\' && quote !== "'" && index + 1 < command.length) {
      value += command[index + 1];
      index += 2;
      continue;
    }
    if (character === '"' || character === "'") {
      if (quote === character) quote = null;
      else if (!quote) quote = character;
      else value += character;
      index += 1;
      continue;
    }
    value += character;
    index += 1;
  }

  return { raw: command.slice(wordStart, index), value, start: wordStart, end: index };
}

interface ShellInvocation {
  operand: ShellWord | null;
  inlineBody: ShellWord | null;
  unsupportedInline: boolean;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Shell option handling must classify inline -c bodies conservatively.
function shellInvocation(command: string, start: number): ShellInvocation {
  let cursor = start;
  let skipOptionArgument = false;

  for (;;) {
    const word = readShellWord(command, cursor);
    if (!word) return { operand: null, inlineBody: null, unsupportedInline: false };
    cursor = word.end;

    if (skipOptionArgument) {
      skipOptionArgument = false;
      continue;
    }
    if (word.value === '--') continue;
    if (word.value.startsWith('-')) {
      if (/c/.test(word.value.slice(1))) {
        return {
          operand: null,
          inlineBody: readShellWord(command, cursor),
          unsupportedInline: true,
        };
      }
      if (word.value === '-o' || word.value === '-O') skipOptionArgument = true;
      continue;
    }
    return { operand: word, inlineBody: null, unsupportedInline: false };
  }
}

interface CommandContext {
  cwdMutated: boolean;
  pwdRebound: boolean;
  repoRootRebound: boolean;
  canonicalRepoRoot: string | null;
  canonicalAssignmentEnd: number | null;
  canonicalPreludeEnd: number | null;
}

interface CanonicalManagedPrelude {
  repoRoot: string;
  assignmentEnd: number;
  preludeEnd: number;
}

function poisonCommandContext(context: CommandContext): void {
  context.cwdMutated = true;
  context.pwdRebound = true;
  context.repoRootRebound = true;
}

function canonicalManagedPrelude(command: string): CanonicalManagedPrelude | null {
  const match = command.match(/^repo_root="((?:\\["\\$`]|[^"\\])*)" && cd "\$repo_root" && /);
  if (!match) return null;
  const repoRoot = match[1].replace(/\\(["\\$`])/g, '$1');
  if (!isAbsolute(repoRoot) || /[\0\r\n]/.test(repoRoot)) return null;
  return {
    repoRoot: resolvePath(repoRoot),
    assignmentEnd: match[0].indexOf(' &&'),
    preludeEnd: match[0].length,
  };
}

function normalizeReferencePath(rawPath: string, context: CommandContext): string | null {
  const usesPwd = /^\$(?:PWD)\/|^\$\{(?:PWD)\}\//.test(rawPath);
  const usesRepoRoot = /^\$(?:repo_root)\/|^\$\{(?:repo_root)\}\//.test(rawPath);
  const usesRelativeRoot =
    rawPath.startsWith('./') || rawPath.startsWith('../') || rawPath.startsWith('.codex/');
  if (usesRepoRoot && context.repoRootRebound) return null;
  if (usesPwd && (context.pwdRebound || context.cwdMutated)) return null;
  if (usesRelativeRoot && context.cwdMutated) return null;

  if (usesRepoRoot && context.canonicalRepoRoot) {
    const relativePath = rawPath.replace(/^\$(?:repo_root)\/|^\$\{(?:repo_root)\}\//, '');
    return resolvePath(context.canonicalRepoRoot, relativePath);
  }

  const withoutProjectVariable = rawPath.replace(
    /^\$(?:repo_root|PWD)\/|^\$\{(?:repo_root|PWD)\}\//,
    ''
  );
  const normalized = withoutProjectVariable.startsWith('./')
    ? withoutProjectVariable.slice(2)
    : withoutProjectVariable;
  return /[$`]/.test(normalized) ? null : normalized;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Command-boundary parsing keeps quoting and escaping explicit.
function directCommandStarts(command: string): number[] {
  const starts = [0];
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === '\\' && quote !== "'") {
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      if (quote === character) quote = null;
      else if (!quote) quote = character;
      continue;
    }
    if (!quote && /[;&|(\n]/.test(character)) starts.push(index + 1);
  }

  return starts;
}

function recordAssignment(word: ShellWord, context: CommandContext): boolean {
  const match = word.value.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
  if (!match) return false;
  if (match[1] === 'PWD') context.pwdRebound = true;
  if (match[1] === 'repo_root') {
    const isCanonicalCompilerAssignment =
      context.canonicalRepoRoot !== null &&
      word.start === 0 &&
      word.end === context.canonicalAssignmentEnd &&
      word.value === `repo_root=${context.canonicalRepoRoot}`;
    if (!isCanonicalCompilerAssignment) context.repoRootRebound = true;
  }
  return true;
}

function recordVariableMutations(command: string, start: number, context: CommandContext): void {
  let cursor = start;
  for (;;) {
    const word = readShellWord(command, cursor);
    if (!word) return;
    cursor = word.end;
    if (word.value.startsWith('-')) continue;
    if (recordAssignment(word, context)) continue;
    if (word.value === 'PWD') context.pwdRebound = true;
    if (word.value === 'repo_root') context.repoRootRebound = true;
  }
}

function isCanonicalPreludeCd(
  command: string,
  executable: ShellWord,
  operandStart: number,
  context: CommandContext
): boolean {
  if (context.canonicalPreludeEnd === null || executable.start >= context.canonicalPreludeEnd) {
    return false;
  }
  const operand = readShellWord(command, operandStart);
  return operand?.value === '$repo_root' && operand.end <= context.canonicalPreludeEnd;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Wrapper option parsing is bounded and fail-closed.
function skipWrapperOptions(
  command: string,
  cursor: number,
  wrapper: 'command' | 'exec'
): number | null {
  for (;;) {
    const option = readShellWord(command, cursor);
    if (!option || !option.value.startsWith('-')) return cursor;
    cursor = option.end;
    if (option.value === '--') return cursor;
    if (wrapper === 'command' && (option.value === '-v' || option.value === '-V')) return null;
    if (wrapper === 'exec' && option.value === '-a') {
      const name = readShellWord(command, cursor);
      if (!name) return null;
      cursor = name.end;
    }
  }
}

function skipBuiltinOptions(
  command: string,
  cursor: number,
  context: CommandContext
): number | null {
  const option = readShellWord(command, cursor);
  if (!option || !option.value.startsWith('-')) return cursor;
  if (option.value === '--') return option.end;
  poisonCommandContext(context);
  return null;
}

function skipNohupOptions(command: string, cursor: number, context: CommandContext): number | null {
  const option = readShellWord(command, cursor);
  if (!option || !option.value.startsWith('-')) return cursor;
  if (option.value === '--') return option.end;
  poisonCommandContext(context);
  return null;
}

function skipNiceOptions(command: string, cursor: number, context: CommandContext): number | null {
  for (;;) {
    const option = readShellWord(command, cursor);
    if (!option || !option.value.startsWith('-')) return cursor;
    cursor = option.end;
    if (option.value === '--') return cursor;
    if (option.value === '-n' || option.value === '--adjustment') {
      const adjustment = readShellWord(command, cursor);
      if (!adjustment) {
        poisonCommandContext(context);
        return null;
      }
      cursor = adjustment.end;
      continue;
    }
    if (/^-[0-9]+$/.test(option.value) || option.value.startsWith('--adjustment=')) continue;
    poisonCommandContext(context);
    return null;
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Env option parsing records confinement-affecting state explicitly.
function skipEnvOptions(command: string, cursor: number, context: CommandContext): number | null {
  for (;;) {
    const option = readShellWord(command, cursor);
    if (!option || !option.value.startsWith('-')) return cursor;
    cursor = option.end;
    if (option.value === '--') return cursor;
    if (option.value === '-C' || option.value === '--chdir') {
      const directory = readShellWord(command, cursor);
      if (!directory) return null;
      cursor = directory.end;
      context.cwdMutated = true;
    } else if (option.value.startsWith('--chdir=')) {
      context.cwdMutated = true;
    } else if (option.value === '-u' || option.value === '--unset') {
      const variable = readShellWord(command, cursor);
      if (!variable) return null;
      cursor = variable.end;
    }
  }
}

interface SegmentCommand {
  executable: ShellWord;
  operandStart: number;
  fallbackLauncher: ShellWord | null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Bounded wrapper unrolling keeps command-position semantics explicit.
function segmentCommand(
  command: string,
  start: number,
  context: CommandContext
): SegmentCommand | null {
  let cursor = start;
  let fallbackLauncher: ShellWord | null = null;

  for (let depth = 0; depth < 6; depth += 1) {
    let executable = readShellWord(command, cursor);
    while (executable && recordAssignment(executable, context)) {
      cursor = executable.end;
      executable = readShellWord(command, cursor);
    }
    if (!executable) return null;
    cursor = executable.end;

    if (executable.value === 'exec' || executable.value === 'command') {
      const next = skipWrapperOptions(command, cursor, executable.value);
      if (next === null) return null;
      cursor = next;
      continue;
    }

    if (executable.value === 'builtin') {
      poisonCommandContext(context);
      const next = skipBuiltinOptions(command, cursor, context);
      if (next === null) return null;
      cursor = next;
      continue;
    }

    if (executable.value === 'nohup' || executable.value === '/usr/bin/nohup') {
      const next = skipNohupOptions(command, cursor, context);
      if (next === null) return null;
      cursor = next;
      continue;
    }

    if (executable.value === 'nice' || executable.value === '/usr/bin/nice') {
      const next = skipNiceOptions(command, cursor, context);
      if (next === null) return null;
      cursor = next;
      continue;
    }

    if (executable.value === 'env' || executable.value === '/usr/bin/env') {
      if (executable.value.startsWith('/')) fallbackLauncher = executable;
      const next = skipEnvOptions(command, cursor, context);
      if (next === null) return null;
      cursor = next;
      continue;
    }

    return { executable, operandStart: cursor, fallbackLauncher };
  }
  return null;
}

function isPathLikeExecutable(value: string, rootDir: string): boolean {
  return (
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith(`${rootDir}/`) ||
    /^\$(?:repo_root|PWD)\//.test(value) ||
    /^\$\{(?:repo_root|PWD)\}\//.test(value)
  );
}

function scriptRuntimeOperand(command: string, start: number): ShellWord | null {
  let cursor = start;
  let skipArgument = false;
  for (;;) {
    const word = readShellWord(command, cursor);
    if (!word) return null;
    cursor = word.end;
    if (skipArgument) {
      skipArgument = false;
      continue;
    }
    if (word.value === '--') continue;
    if (
      word.value === '-e' ||
      word.value === '--eval' ||
      word.value === '-p' ||
      word.value === '--print'
    ) {
      return null;
    }
    if (['-r', '--require', '--loader', '--import'].includes(word.value)) {
      skipArgument = true;
      continue;
    }
    if (word.value.startsWith('-')) continue;
    return word;
  }
}

/**
 * Extract directly declared shell operands, direct provider-hook paths, and
 * the single explicit managed-marker hop emitted by the native compiler.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Security classification keeps every conservative path outcome explicit.
export function extractHookExecutableReferences(
  command: string,
  rootDir: string = '.codex'
): HookExecutableReference[] {
  const references: HookExecutableReference[] = [];
  const canonicalPrelude = canonicalManagedPrelude(command);
  const context: CommandContext = {
    cwdMutated: false,
    pwdRebound: false,
    repoRootRebound: false,
    canonicalRepoRoot: canonicalPrelude?.repoRoot ?? null,
    canonicalAssignmentEnd: canonicalPrelude?.assignmentEnd ?? null,
    canonicalPreludeEnd: canonicalPrelude?.preludeEnd ?? null,
  };

  for (const start of directCommandStarts(command)) {
    const parsed = segmentCommand(command, start, context);
    if (!parsed) continue;
    const { executable } = parsed;

    if (executable.value === 'cd') {
      if (!isCanonicalPreludeCd(command, executable, parsed.operandStart, context)) {
        context.cwdMutated = true;
      }
      continue;
    }

    if (executable.value === 'pushd' || executable.value === 'popd') {
      context.cwdMutated = true;
      continue;
    }

    if (executable.value === 'eval') {
      const body = readShellWord(command, parsed.operandStart);
      references.push({
        raw: body?.value ?? 'eval',
        path: null,
        source: 'direct-command',
      });
      poisonCommandContext(context);
      continue;
    }

    if (executable.value === 'source' || executable.value === '.') {
      const operand = readShellWord(command, parsed.operandStart);
      references.push({
        raw: operand?.value ?? executable.value,
        path: operand ? normalizeReferencePath(operand.value, context) : null,
        source: 'direct-command',
      });
      poisonCommandContext(context);
      continue;
    }

    if (['export', 'readonly', 'typeset', 'declare', 'local', 'unset'].includes(executable.value)) {
      recordVariableMutations(command, parsed.operandStart, context);
      continue;
    }

    if (SHELL_INTERPRETER_WORD.test(executable.value)) {
      const invocation = shellInvocation(command, parsed.operandStart);
      if (invocation.operand) {
        references.push({
          raw: invocation.operand.value,
          path: normalizeReferencePath(invocation.operand.value, context),
          source: 'shell-operand',
        });
      } else if (invocation.unsupportedInline) {
        references.push({
          raw: invocation.inlineBody?.value ?? `${executable.value} -c`,
          path: null,
          source: 'direct-command',
        });
      }
      continue;
    }

    if (SCRIPT_RUNTIME_WORD.test(executable.value)) {
      const operand = scriptRuntimeOperand(command, parsed.operandStart);
      if (operand && isPathLikeExecutable(operand.value, rootDir)) {
        references.push({
          raw: operand.value,
          path: normalizeReferencePath(operand.value, context),
          source: 'direct-command',
        });
      } else {
        const fallback =
          parsed.fallbackLauncher ??
          (isPathLikeExecutable(executable.value, rootDir) ? executable : null);
        if (fallback) {
          references.push({
            raw: fallback.value,
            path: fallback.value,
            source: 'direct-command',
          });
        }
      }
      continue;
    }

    if (isPathLikeExecutable(executable.value, rootDir)) {
      references.push({
        raw: executable.value,
        path: normalizeReferencePath(executable.value, context),
        source: 'direct-command',
      });
    } else if (parsed.fallbackLauncher) {
      references.push({
        raw: parsed.fallbackLauncher.value,
        path: parsed.fallbackLauncher.value,
        source: 'direct-command',
      });
    }
  }

  MANAGED_MARKER.lastIndex = 0;
  for (let match = MANAGED_MARKER.exec(command); match; match = MANAGED_MARKER.exec(command)) {
    references.push({
      raw: match[1],
      path: `${rootDir}/hooks/scripts/${match[1]}`,
      source: 'managed-marker',
    });
  }

  const unique = new Map<string, HookExecutableReference>();
  for (const reference of references) {
    const key = reference.path ?? `${reference.source}:${reference.raw}`;
    if (!unique.has(key)) unique.set(key, reference);
  }
  return [...unique.values()];
}
