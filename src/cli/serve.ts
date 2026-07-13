/**
 * Background Web UI lifecycle management.
 *
 * The canonical state file intentionally keeps its historical `.pid` name, but
 * now stores the endpoint metadata that independent CLI processes need.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export const DEFAULT_PORT = 4321;
export const SERVE_STATE_VERSION = 1;

const STATE_FILE_NAME = '.omcodex-serve.pid';
const LEGACY_STATE_FILE_NAME = '.omcustom-serve.pid';

export interface ServeStateV1 {
  version: 1;
  pid: number;
  port: number;
  projectRoot: string;
  startedAt: string;
}

export type ServeStateSource = 'v1' | 'legacy-current' | 'legacy-file';

export interface RunningServeState {
  pid: number;
  port: number;
  projectRoot?: string;
  startedAt?: string;
  source: ServeStateSource;
  portAssumed: boolean;
}

export type ServeDiagnostic =
  | 'invalid-state-removed'
  | 'stale-state-removed'
  | 'legacy-port-assumed';

export interface ServeStatus {
  running: boolean;
  state?: RunningServeState;
  endpoint?: string;
  diagnostics: ServeDiagnostic[];
}

export interface ServeRuntimeOptions {
  /** Override the home directory containing lifecycle state (tests only). */
  stateDir?: string;
  /** Port to associate with a legacy numeric PID file, whose port is unknown. */
  legacyPort?: number;
  /** Process probe override for deterministic tests. */
  processExists?: (pid: number) => boolean;
  /** Detached child process factory override for deterministic tests. */
  spawnProcess?: typeof spawn;
  /** Clock override for deterministic tests. */
  now?: () => Date;
  /** State removal override for deterministic error-path tests. */
  unlinkFile?: typeof unlink;
}

export interface FindServeBuildDirOptions {
  /**
   * When true, skips the npm package fallback path.
   * This is intended for test isolation to prevent real build artifacts
   * from interfering with tests that expect a missing build directory.
   */
  skipNpmFallback?: boolean;
}

export type StartServeResult =
  | { kind: 'started'; state: RunningServeState }
  | { kind: 'already-running'; state: RunningServeState }
  | { kind: 'missing-build' }
  | { kind: 'failed'; error: Error };

function getStatePaths(stateDir = homedir()): {
  current: string;
  legacy: string;
} {
  return {
    current: join(stateDir, STATE_FILE_NAME),
    legacy: join(stateDir, LEGACY_STATE_FILE_NAME),
  };
}

function isValidPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65_535;
}

function isValidPid(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function parseServeStateV1(raw: string): ServeStateV1 | null {
  try {
    const candidate = JSON.parse(raw) as Partial<ServeStateV1>;
    if (
      candidate.version !== SERVE_STATE_VERSION ||
      !isValidPid(candidate.pid) ||
      !isValidPort(candidate.port) ||
      typeof candidate.projectRoot !== 'string' ||
      candidate.projectRoot.length === 0 ||
      !isAbsolute(candidate.projectRoot) ||
      typeof candidate.startedAt !== 'string' ||
      candidate.startedAt.length === 0 ||
      !Number.isFinite(Date.parse(candidate.startedAt))
    ) {
      return null;
    }

    return {
      version: SERVE_STATE_VERSION,
      pid: candidate.pid,
      port: candidate.port,
      projectRoot: candidate.projectRoot,
      startedAt: candidate.startedAt,
    };
  } catch {
    return null;
  }
}

function parseLegacyPid(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const pid = Number(raw.trim());
  return isValidPid(pid) ? pid : null;
}

function getLegacyPort(explicitPort?: number): number {
  if (isValidPort(explicitPort)) return explicitPort;

  for (const value of [process.env.OMCODEX_PORT, process.env.OMCUSTOM_PORT]) {
    const parsed = Number(value);
    if (isValidPort(parsed)) return parsed;
  }

  return DEFAULT_PORT;
}

function defaultProcessExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function removeStateFile(path: string, unlinkFile: typeof unlink = unlink): Promise<void> {
  try {
    await unlinkFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** Remove canonical and legacy lifecycle state. */
export async function cleanupServeState(options: ServeRuntimeOptions = {}): Promise<void> {
  const paths = getStatePaths(options.stateDir);
  await Promise.all([
    removeStateFile(paths.current, options.unlinkFile),
    removeStateFile(paths.legacy, options.unlinkFile),
  ]);
}

/**
 * Persist V1 state with a sibling mode-0600 temporary file and atomic rename.
 */
export async function persistServeState(
  state: ServeStateV1,
  options: ServeRuntimeOptions = {}
): Promise<void> {
  const { current } = getStatePaths(options.stateDir);
  const temporary = `${current}.tmp-${process.pid}-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, current);
  } finally {
    await handle?.close().catch(() => undefined);
    await removeStateFile(temporary, options.unlinkFile);
  }
}

/**
 * Read, validate, and probe the lifecycle state shared by independent CLI
 * invocations. Invalid and stale entries are removed before returning.
 */
interface StateCandidateResult {
  state?: RunningServeState;
  diagnostic?: ServeDiagnostic;
}

async function readStateCandidate(
  path: string,
  source: Exclude<ServeStateSource, 'v1'>,
  isCanonical: boolean,
  options: ServeRuntimeOptions
): Promise<StateCandidateResult> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return {};
  }

  const v1State = isCanonical ? parseServeStateV1(raw) : null;
  const legacyPid = v1State === null ? parseLegacyPid(raw) : null;
  if (v1State === null && legacyPid === null) {
    await removeStateFile(path, options.unlinkFile);
    return { diagnostic: 'invalid-state-removed' };
  }

  const pid = v1State?.pid ?? legacyPid;
  if (pid === null || !(options.processExists ?? defaultProcessExists)(pid)) {
    await removeStateFile(path, options.unlinkFile);
    return { diagnostic: 'stale-state-removed' };
  }

  if (v1State !== null) {
    return {
      state: {
        pid: v1State.pid,
        port: v1State.port,
        projectRoot: v1State.projectRoot,
        startedAt: v1State.startedAt,
        source: 'v1',
        portAssumed: false,
      },
    };
  }

  return {
    state: {
      pid,
      port: getLegacyPort(options.legacyPort),
      source,
      portAssumed: true,
    },
    diagnostic: 'legacy-port-assumed',
  };
}

export async function getServeStatus(options: ServeRuntimeOptions = {}): Promise<ServeStatus> {
  const paths = getStatePaths(options.stateDir);
  const diagnostics: ServeDiagnostic[] = [];

  for (const [path, source, isCanonical] of [
    [paths.current, 'legacy-current', true],
    [paths.legacy, 'legacy-file', false],
  ] as const) {
    const candidate = await readStateCandidate(path, source, isCanonical, options);
    if (candidate.diagnostic !== undefined) diagnostics.push(candidate.diagnostic);
    if (candidate.state === undefined) continue;

    return {
      running: true,
      state: candidate.state,
      endpoint: `http://localhost:${candidate.state.port}`,
      diagnostics,
    };
  }

  return { running: false, diagnostics };
}

/** Compatibility wrapper for callers that only need a boolean. */
export async function isServeRunning(options: ServeRuntimeOptions = {}): Promise<boolean> {
  return (await getServeStatus(options)).running;
}

function buildServeEnv(port: number, projectRoot: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OMCODEX_PORT: String(port),
    OMCODEX_HOST: 'localhost',
    OMCODEX_ORIGIN: `http://localhost:${port}`,
    OMCUSTOM_PORT: String(port),
    OMCUSTOM_HOST: 'localhost',
    OMCUSTOM_ORIGIN: `http://localhost:${port}`,
    OMX_PROJECT_ROOT: projectRoot,
  };
}

/** Find the built SvelteKit server directory. */
export function findServeBuildDir(
  projectRoot: string,
  options?: FindServeBuildDirOptions
): string | null {
  const localBuild = join(projectRoot, 'packages', 'serve', 'build');
  if (existsSync(join(localBuild, 'index.js'))) return localBuild;

  if (options?.skipNpmFallback !== true) {
    const npmBuild = join(import.meta.dirname, '..', '..', 'packages', 'serve', 'build');
    if (existsSync(join(npmBuild, 'index.js'))) return npmBuild;
  }

  return null;
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolveSpawn, rejectSpawn) => {
    child.once('spawn', resolveSpawn);
    child.once('error', rejectSpawn);
  });
}

/** Start the detached Web UI and return its authoritative lifecycle state. */
export async function startServeBackground(
  projectRoot: string,
  port: number = DEFAULT_PORT,
  buildDirOpts?: FindServeBuildDirOptions,
  runtimeOptions: ServeRuntimeOptions = {}
): Promise<StartServeResult> {
  if (!isValidPort(port)) {
    return { kind: 'failed', error: new Error(`Invalid Web UI port: ${String(port)}`) };
  }

  const status = await getServeStatus({ ...runtimeOptions, legacyPort: port });
  if (status.running && status.state !== undefined) {
    return { kind: 'already-running', state: status.state };
  }

  const buildDir = findServeBuildDir(projectRoot, buildDirOpts);
  if (buildDir === null) return { kind: 'missing-build' };

  const absoluteProjectRoot = resolve(projectRoot);
  const spawnProcess = runtimeOptions.spawnProcess ?? spawn;
  let child: ChildProcess | undefined;

  try {
    child = spawnProcess('node', [join(buildDir, 'index.js')], {
      env: buildServeEnv(port, absoluteProjectRoot),
      stdio: 'ignore',
      detached: true,
      shell: false,
    });
    await waitForSpawn(child);

    if (child.pid === undefined) {
      throw new Error('Detached Web UI process did not expose a PID');
    }

    const persisted: ServeStateV1 = {
      version: SERVE_STATE_VERSION,
      pid: child.pid,
      port,
      projectRoot: absoluteProjectRoot,
      startedAt: (runtimeOptions.now ?? (() => new Date()))().toISOString(),
    };
    await persistServeState(persisted, runtimeOptions);
    child.unref();

    return {
      kind: 'started',
      state: {
        pid: persisted.pid,
        port: persisted.port,
        projectRoot: persisted.projectRoot,
        startedAt: persisted.startedAt,
        source: 'v1',
        portAssumed: false,
      },
    };
  } catch (error) {
    if (child?.pid !== undefined) {
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch {
        // The child may already have exited after a spawn failure.
      }
    }
    await cleanupServeState(runtimeOptions);
    return { kind: 'failed', error: error as Error };
  }
}

/** Stop the running Web UI and remove canonical plus legacy state. */
export async function stopServe(options: ServeRuntimeOptions = {}): Promise<boolean> {
  const status = await getServeStatus(options);
  if (!status.running || status.state === undefined) {
    await cleanupServeState(options);
    return false;
  }

  try {
    process.kill(status.state.pid, 'SIGTERM');
    await cleanupServeState(options);
    return true;
  } catch {
    await cleanupServeState(options);
    return false;
  }
}
