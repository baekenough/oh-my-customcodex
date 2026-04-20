import { basename } from 'node:path';

export const DEFAULT_CLI_COMMAND = 'omcodex';

const KNOWN_CLI_COMMANDS = new Set([DEFAULT_CLI_COMMAND, 'omcustom', 'omcustomx']);
const WINDOWS_SCRIPT_EXTENSIONS = /\.(cmd|exe|ps1|bat)$/i;

let activeCliCommandName = DEFAULT_CLI_COMMAND;

export function normalizeCliCommandName(commandName?: string | null): string {
  const normalized = commandName?.trim().toLowerCase().replace(WINDOWS_SCRIPT_EXTENSIONS, '');

  return normalized && KNOWN_CLI_COMMANDS.has(normalized) ? normalized : DEFAULT_CLI_COMMAND;
}

export function detectCliCommandName(argv: string[] = process.argv): string {
  const invokedPath = argv[1];
  if (!invokedPath) {
    return DEFAULT_CLI_COMMAND;
  }

  const normalizedPath = invokedPath.replace(/\\/g, '/');
  return normalizeCliCommandName(basename(normalizedPath));
}

export function setActiveCliCommandName(commandName?: string | null): void {
  activeCliCommandName = normalizeCliCommandName(commandName);
}

export function getActiveCliCommandName(): string {
  return activeCliCommandName;
}

export function rewriteCliCommandReferences(
  text: string,
  commandName: string = getActiveCliCommandName()
): string {
  const normalizedCommandName = normalizeCliCommandName(commandName);
  if (normalizedCommandName === DEFAULT_CLI_COMMAND) {
    return text;
  }

  return text.replace(
    /(^|[^A-Za-z0-9_.-])omcodex(?=$|[^A-Za-z0-9_.-])/g,
    (_match, prefix: string) => `${prefix}${normalizedCommandName}`
  );
}
