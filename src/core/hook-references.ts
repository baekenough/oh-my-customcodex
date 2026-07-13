/**
 * Extract executable references from native hook command declarations.
 *
 * This intentionally parses only the declaration boundary. Security callers
 * may follow the explicit omcustomcodex managed-marker hop, but arbitrary
 * commands launched later by a referenced script are outside this parser's
 * coverage and must not be described as recursively scanned.
 */

const SHELL_INTERPRETER =
  /\b(?:\/usr\/bin\/env\s+)?(?:\/(?:usr\/)?bin\/)?(?:bash|dash|ksh|sh|zsh)\b/g;
const MANAGED_MARKER = /#\s*omcustomcodex-hook:([A-Za-z0-9._-]+\.sh)\s*$/g;

export interface HookExecutableReference {
  raw: string;
  path: string | null;
  source: 'shell-operand' | 'direct-hook-path' | 'managed-marker';
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
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Quoted shell-word parsing is a small state machine.
function readShellWord(command: string, start: number): ShellWord | null {
  let index = start;
  while (index < command.length && /\s/.test(command[index])) index += 1;
  if (index >= command.length || /[;&|]/.test(command[index])) return null;

  const wordStart = index;
  let value = '';
  let quote: '"' | "'" | null = null;

  while (index < command.length) {
    const character = command[index];
    if (!quote && (/\s/.test(character) || /[;&|]/.test(character))) break;
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

  return { raw: command.slice(wordStart, index), value };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Shell option handling must reject inline -c bodies conservatively.
function shellOperand(command: string, start: number): ShellWord | null {
  let cursor = start;
  let skipOptionArgument = false;

  for (;;) {
    const word = readShellWord(command, cursor);
    if (!word) return null;
    cursor = command.indexOf(word.raw, cursor) + word.raw.length;

    if (skipOptionArgument) {
      skipOptionArgument = false;
      continue;
    }
    if (word.value === '--') continue;
    if (word.value.startsWith('-')) {
      if (/c/.test(word.value.slice(1))) return null;
      if (word.value === '-o' || word.value === '-O') skipOptionArgument = true;
      continue;
    }
    return word;
  }
}

function normalizeReferencePath(rawPath: string): string | null {
  const withoutProjectVariable = rawPath.replace(
    /^\$(?:repo_root|PWD)\/|^\$\{(?:repo_root|PWD)\}\//,
    ''
  );
  const normalized = withoutProjectVariable.startsWith('./')
    ? withoutProjectVariable.slice(2)
    : withoutProjectVariable;
  return /[$`]/.test(normalized) ? null : normalized;
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract directly declared shell operands, direct provider-hook paths, and
 * the single explicit managed-marker hop emitted by the native compiler.
 */
export function extractHookExecutableReferences(
  command: string,
  rootDir: string = '.codex'
): HookExecutableReference[] {
  const references: HookExecutableReference[] = [];

  SHELL_INTERPRETER.lastIndex = 0;
  for (
    let match = SHELL_INTERPRETER.exec(command);
    match;
    match = SHELL_INTERPRETER.exec(command)
  ) {
    const operand = shellOperand(command, SHELL_INTERPRETER.lastIndex);
    if (!operand) continue;
    references.push({
      raw: operand.value,
      path: normalizeReferencePath(operand.value),
      source: 'shell-operand',
    });
  }

  const directHookPath = new RegExp(
    `(?:^|[\\s"'=;&|])(${regexEscape(rootDir)}\\/hooks\\/[A-Za-z0-9._+\\/-]+)`,
    'g'
  );
  for (let match = directHookPath.exec(command); match; match = directHookPath.exec(command)) {
    references.push({
      raw: match[1],
      path: match[1],
      source: 'direct-hook-path',
    });
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
