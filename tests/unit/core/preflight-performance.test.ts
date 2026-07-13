import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'bun';

const PROJECT_ROOT = join(import.meta.dir, '../../..');
const CLI_PATH = join(PROJECT_ROOT, 'src/cli/index.ts');
const COMMAND_TIMEOUT_MS = 12_000;
const FIXED_TIMER_REGRESSION_LIMIT_MS = 4_000;
const HOT_ABSOLUTE_LIMIT_MS = 2_000;
const HOT_SKIP_DELTA_LIMIT_MS = 750;

interface CliTiming {
  durationMs: number;
  exitCode: number;
  stderr: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}

describe('preflight actual CLI startup performance', () => {
  let tempDir: string;
  let homeDir: string;
  let binDir: string;
  let probeLog: string;
  let childEnv: Record<string, string | undefined>;

  async function writeFakeCommand(name: string, output: string, exitCode = 0): Promise<void> {
    const isWindows = process.platform === 'win32';
    const commandPath = join(binDir, isWindows ? `${name}.cmd` : name);
    const logLine = isWindows
      ? `@echo ${name}>>"%OMCODEX_PREFLIGHT_PROBE_LOG%"\r\n`
      : `printf '%s\\n' '${name}' >> "$OMCODEX_PREFLIGHT_PROBE_LOG"\n`;
    const body = isWindows
      ? `${logLine}${output ? `@echo ${output}\r\n` : ''}@exit /b ${exitCode}\r\n`
      : `#!/bin/sh\n${logLine}${output ? `printf '%s\\n' '${output}'\n` : ''}exit ${exitCode}\n`;

    await writeFile(commandPath, body, 'utf8');
    if (!isWindows) await chmod(commandPath, 0o755);
  }

  async function runCli(skipVersionCheck: boolean): Promise<CliTiming> {
    const args = skipVersionCheck
      ? ['--skip-version-check', 'list', 'all', '--format', 'json']
      : ['list', 'all', '--format', 'json'];
    const startedAt = performance.now();
    const proc = spawn({
      cmd: [process.execPath, CLI_PATH, ...args],
      cwd: PROJECT_ROOT,
      env: childEnv,
      stdout: 'ignore',
      stderr: 'pipe',
    });
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        proc.kill();
        reject(new Error(`CLI command timed out after ${COMMAND_TIMEOUT_MS}ms`));
      }, COMMAND_TIMEOUT_MS);
    });

    try {
      const [stderr, exitCode] = await Promise.race([
        Promise.all([new Response(proc.stderr).text(), proc.exited]),
        timeoutPromise,
      ]);
      return { durationMs: performance.now() - startedAt, exitCode, stderr };
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-preflight-performance-'));
    homeDir = join(tempDir, 'home');
    binDir = join(tempDir, 'bin');
    probeLog = join(tempDir, 'provider-probes.log');
    await mkdir(homeDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFakeCommand('brew', '', 1);
    await writeFakeCommand('codex', 'codex-cli 1.0.0');
    await writeFakeCommand('omx', 'omx 1.0.0');
    await writeFakeCommand('npm', '"1.0.0"');

    childEnv = { ...process.env };
    for (const key of Object.keys(childEnv)) {
      if (
        key.toUpperCase() === 'PATH' ||
        key === 'CI' ||
        key === 'GITHUB_ACTIONS' ||
        key === 'OMCODEX_SKIP_PREFLIGHT' ||
        key === 'OMCUSTOM_SKIP_PREFLIGHT'
      ) {
        delete childEnv[key];
      }
    }
    childEnv.PATH = binDir;
    childEnv.HOME = homeDir;
    childEnv.USERPROFILE = homeDir;
    childEnv.OMCODEX_PREFLIGHT_PROBE_LOG = probeLog;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('keeps cached preflight startup at skip-level latency without a fixed five-second timer', async () => {
    const cold = await runCli(false);
    expect(cold.exitCode, cold.stderr).toBe(0);
    expect(cold.durationMs).toBeLessThan(FIXED_TIMER_REGRESSION_LIMIT_MS);

    const cachePath = join(homeDir, '.oh-my-customcodex', 'preflight-cache.json');
    const cache = JSON.parse(await readFile(cachePath, 'utf8')) as {
      entries?: Array<{ toolNames?: string[] }>;
    };
    expect(cache.entries?.[0]?.toolNames).toEqual(['codex', 'omx']);
    const probesAfterCold = await readFile(probeLog, 'utf8');

    const hotDurations: number[] = [];
    const skipDurations: number[] = [];
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const hot = await runCli(false);
      const skipped = await runCli(true);
      expect(hot.exitCode, hot.stderr).toBe(0);
      expect(skipped.exitCode, skipped.stderr).toBe(0);
      hotDurations.push(hot.durationMs);
      skipDurations.push(skipped.durationMs);
    }

    expect(Math.max(...hotDurations)).toBeLessThan(HOT_ABSOLUTE_LIMIT_MS);
    expect(median(hotDurations) - median(skipDurations)).toBeLessThan(HOT_SKIP_DELTA_LIMIT_MS);
    expect(await readFile(probeLog, 'utf8')).toBe(probesAfterCold);
  }, 30_000);
});
