/**
 * CLI command handlers for `omcodex serve` and `omcodex serve-stop`
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { i18n } from '../i18n/index.js';
import {
  DEFAULT_PORT,
  type FindServeBuildDirOptions,
  findServeBuildDir,
  startServeBackground,
  stopServe,
} from './serve.js';

export interface ServeCommandOptions {
  port?: string;
  foreground?: boolean;
  /**
   * Override the project root used to find the build directory.
   * Intended for test isolation only — not exposed in the CLI.
   */
  _projectRoot?: string;
  /** Override the directory containing Web lifecycle state (tests only). */
  _stateDir?: string;
}

/**
 * Handler for `omcodex serve [--port 4321] [--foreground]`
 */
export async function serveCommand(options: ServeCommandOptions): Promise<void> {
  const port = options.port !== undefined ? Number(options.port) : DEFAULT_PORT;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${options.port}`);
    process.exit(1);
  }

  const cwd = options._projectRoot ?? process.cwd();
  // When _projectRoot is explicitly set (test isolation), skip the npm fallback
  // so real build artifacts do not interfere with tests expecting a missing build.
  const buildDirOpts: FindServeBuildDirOptions = {
    skipNpmFallback: options._projectRoot !== undefined,
  };

  if (options.foreground === true) {
    runForeground(cwd, port, buildDirOpts);
    return;
  }

  const result = await startServeBackground(cwd, port, buildDirOpts, {
    stateDir: options._stateDir,
  });

  if (result.kind === 'started' || result.kind === 'already-running') {
    if (result.kind === 'already-running' && result.state.port !== port) {
      console.warn(
        i18n.t('cli.web.start.portMismatch', {
          requestedPort: port,
          actualPort: result.state.port,
        })
      );
    }
    if (result.state.portAssumed) {
      console.warn(i18n.t('cli.web.status.legacyPortAssumed', { port: result.state.port }));
    }
    console.log(i18n.t('cli.web.start.started', { port: result.state.port }));
    return;
  }

  console.error(i18n.t('cli.web.start.failed'));
  process.exit(1);
}

/**
 * Handler for `omcodex serve-stop`
 */
export async function serveStopCommand(options: { _stateDir?: string } = {}): Promise<void> {
  const stopped = await stopServe({ stateDir: options._stateDir });
  if (stopped) {
    console.log(i18n.t('cli.web.stop.stopped'));
  } else {
    console.log(i18n.t('cli.web.stop.notRunning'));
  }
}

/**
 * Run the SvelteKit server in the foreground (blocking).
 * Exits the current process with an error if the build is missing.
 */
function runForeground(
  projectRoot: string,
  port: number,
  buildDirOpts?: FindServeBuildDirOptions
): void {
  const buildDir = findServeBuildDir(projectRoot, buildDirOpts);
  if (buildDir === null) {
    console.error('Web UI build not found. Run: cd packages/serve && bun run build');
    process.exit(1);
  }

  console.log(`Web UI: http://localhost:${port}`);

  spawnSync('node', [join(buildDir, 'index.js')], {
    env: {
      ...process.env,
      OMCODEX_PORT: String(port),
      OMCODEX_HOST: 'localhost',
      OMCODEX_ORIGIN: `http://localhost:${port}`,
      OMCUSTOM_PORT: String(port),
      OMCUSTOM_HOST: 'localhost',
      OMCUSTOM_ORIGIN: `http://localhost:${port}`,
      OMX_PROJECT_ROOT: projectRoot,
    },
    stdio: 'inherit',
  });
}
