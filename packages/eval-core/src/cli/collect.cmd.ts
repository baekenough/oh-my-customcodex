import { Command } from 'commander';
import { collect } from '../collect/index.js';
import type { OutcomeParseDiagnostic } from '../collect/outcome-parser.js';
import { runMigrations } from '../db/migrate.js';
import { getDefaultConfig } from '../types/config.js';

interface CollectCliOptions {
  since?: string;
  ppid?: string;
  omxDir?: string;
  dbPath?: string;
  dryRun?: boolean;
}

export function formatCollectDiagnostics(
  diagnostics: readonly OutcomeParseDiagnostic[] = [],
  ppid = 'unknown'
): string[] {
  return diagnostics.map((diagnostic) => {
    switch (diagnostic.code) {
      case 'outcome_file_missing':
        return `No task outcome file found for PPID ${ppid} (expected /tmp/.codex-task-outcomes-${ppid})`;
      case 'legacy_fallback':
        return `Using legacy Claude task outcome file for PPID ${ppid}`;
      case 'malformed_records':
        return `Skipped ${diagnostic.count} malformed task outcome records`;
      case 'duplicate_records':
        return `Skipped ${diagnostic.count} duplicate task outcome records`;
    }
  });
}

export const collectCommand = new Command('collect')
  .description('Collect session and agent data from .omx/ logs')
  .option('--since <date>', 'Collect data since this date (ISO 8601)')
  .option('--ppid <pid>', 'Collect specific PPID outcome file')
  .option('--omx-dir <dir>', 'Path to .omx/logs/ directory')
  .option('--db-path <path>', 'Database file path')
  .option('--dry-run', 'Parse without writing to DB')
  .action(async (options: CollectCliOptions) => {
    const config = getDefaultConfig();
    const dbPath = options.dbPath ?? config.sqlitePath;
    const omxDir = options.omxDir ?? '.omx/logs';

    // Auto-migrate on first run
    if (!options.dryRun) {
      runMigrations(dbPath);
    }

    console.log(`Collecting data from: ${omxDir}`);
    const result = await collect({
      dbPath,
      omxLogsDir: omxDir,
      since: options.since,
      ppid: options.ppid,
      dryRun: options.dryRun,
    });

    console.log(
      `Collected: ${result.sessions} sessions, ${result.turns} turns, ${result.invocations} agent invocations`
    );

    const diagnosticLines = formatCollectDiagnostics(result.diagnostics, options.ppid);
    if (diagnosticLines.length > 0) {
      console.warn(`Diagnostics:\n${diagnosticLines.map((line) => `- ${line}`).join('\n')}`);
    }
  });
