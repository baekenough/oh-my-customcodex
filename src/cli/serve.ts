/**
 * Background web server management for the omcodex CLI
 * Manages the lifecycle of the packages/serve SvelteKit server process
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_PORT = 4321;

const PID_FILE = join(process.env.HOME ?? '~', '.omcodex-serve.pid');
const LEGACY_PID_FILE = join(process.env.HOME ?? '~', '.omcustom-serve.pid');

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

async function readPidFromKnownFiles(): Promise<{ pid: number; path: string } | null> {
  for (const pidFile of [PID_FILE, LEGACY_PID_FILE]) {
    try {
      const raw = await readFile(pidFile, 'utf-8');
      const pid = Number(raw.trim());
      if (Number.isFinite(pid) && pid > 0) {
        return { pid, path: pidFile };
      }
    } catch {
      // Try the next known PID file.
    }
  }
  return null;
}

export interface FindServeBuildDirOptions {
  /**
   * When true, skips the npm package fallback path.
   * This is intended for test isolation to prevent real build artifacts
   * from interfering with tests that expect a missing build directory.
   */
  skipNpmFallback?: boolean;
}

/**
 * Find the built SvelteKit server directory.
 * Checks two locations: the local monorepo packages/serve/build,
 * and the npm-installed package path relative to this module.
 */
export function findServeBuildDir(
  projectRoot: string,
  options?: FindServeBuildDirOptions
): string | null {
  // 1. Monorepo: packages/serve/build (dev / local install)
  const localBuild = join(projectRoot, 'packages', 'serve', 'build');
  if (existsSync(join(localBuild, 'index.js'))) return localBuild;

  // 2. npm global: installed next to dist/ inside the omcodex package
  // __dirname is dist/cli/ when compiled, so go up two levels to package root
  if (options?.skipNpmFallback !== true) {
    const npmBuild = join(import.meta.dirname, '..', '..', 'packages', 'serve', 'build');
    if (existsSync(join(npmBuild, 'index.js'))) return npmBuild;
  }

  return null;
}

/**
 * Check whether the serve process is currently running.
 * Reads the PID file and sends signal 0 to verify the process exists.
 * Cleans up a stale PID file if the process is gone.
 */
export async function isServeRunning(): Promise<boolean> {
  try {
    const pidEntry = await readPidFromKnownFiles();
    if (!pidEntry) {
      await cleanupPidFile();
      return false;
    }
    process.kill(pidEntry.pid, 0); // signal 0 = existence check only
    return true;
  } catch {
    await cleanupPidFile();
    return false;
  }
}

/**
 * Start the SvelteKit web server as a detached background process.
 * Silently skips if the server is already running or the build is missing.
 *
 * @param projectRoot - Absolute path to the project root (used to find build dir)
 * @param port - TCP port to bind (default: 4321)
 * @param buildDirOpts - Options forwarded to findServeBuildDir (e.g. skipNpmFallback for tests)
 */
export async function startServeBackground(
  projectRoot: string,
  port: number = DEFAULT_PORT,
  buildDirOpts?: FindServeBuildDirOptions
): Promise<void> {
  if (await isServeRunning()) {
    return; // already running — no-op
  }

  const buildDir = findServeBuildDir(projectRoot, buildDirOpts);
  if (buildDir === null) {
    // Build not present (serve package not installed / not yet built) — silently skip
    return;
  }

  const child = spawn('node', [join(buildDir, 'index.js')], {
    env: buildServeEnv(port, projectRoot),
    stdio: 'ignore',
    detached: true,
  });

  child.unref();

  if (child.pid !== undefined) {
    await writeFile(PID_FILE, String(child.pid), 'utf-8');
  }
}

/**
 * Stop the background serve process.
 *
 * @returns `true` if a running process was stopped, `false` if nothing was running.
 */
export async function stopServe(): Promise<boolean> {
  try {
    const pidEntry = await readPidFromKnownFiles();
    if (!pidEntry) {
      await cleanupPidFile();
      return false;
    }
    process.kill(pidEntry.pid, 'SIGTERM');
    await cleanupPidFile();
    return true;
  } catch {
    await cleanupPidFile();
    return false;
  }
}

/**
 * Remove the PID file, ignoring errors if it does not exist.
 */
async function cleanupPidFile(): Promise<void> {
  for (const pidFile of [PID_FILE, LEGACY_PID_FILE]) {
    try {
      await unlink(pidFile);
    } catch {
      // ignore — file may already be absent
    }
  }
}
