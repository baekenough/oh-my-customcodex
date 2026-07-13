/** CLI handlers for the `omcustomcodex web` command group. */

import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { i18n } from '../i18n/index.js';
import { getServeStatus } from './serve.js';
import { type ServeCommandOptions, serveCommand, serveStopCommand } from './serve-commands.js';

export type { ServeCommandOptions } from './serve-commands.js';

export interface BrowserOpenResult {
  ok: boolean;
  error?: string;
}

export type BrowserOpener = (url: string) => BrowserOpenResult | Promise<BrowserOpenResult>;

export interface BrowserOpenOptions {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  systemRoot?: string;
  spawnSyncImpl?: typeof spawnSync;
}

export interface WebCommandDependencies {
  stateDir?: string;
  browserOpener?: BrowserOpener;
}

function browserCommand(
  platform: NodeJS.Platform,
  url: string,
  systemRoot?: string
): { command: string; args: string[] } | null {
  switch (platform) {
    case 'darwin':
      return { command: '/usr/bin/open', args: [url] };
    case 'linux':
      return { command: 'xdg-open', args: [url] };
    case 'win32':
      return {
        command: systemRoot ? join(systemRoot, 'System32', 'rundll32.exe') : 'rundll32.exe',
        args: ['url.dll,FileProtocolHandler', url],
      };
    default:
      return null;
  }
}

/** Launch one URL through the platform browser without shell interpolation. */
export function openUrlInDefaultBrowser(
  url: string,
  options: BrowserOpenOptions = {}
): BrowserOpenResult {
  const platform = options.platform ?? process.platform;
  const invocation = browserCommand(platform, url, options.systemRoot ?? process.env.SystemRoot);
  if (invocation === null) {
    return { ok: false, error: `Unsupported platform: ${platform}` };
  }

  try {
    const result = (options.spawnSyncImpl ?? spawnSync)(invocation.command, invocation.args, {
      shell: false,
      stdio: 'ignore',
      timeout: options.timeoutMs ?? 10_000,
      windowsHide: true,
    }) as SpawnSyncReturns<Buffer>;

    if (result.error !== undefined) {
      const code = (result.error as NodeJS.ErrnoException).code;
      return {
        ok: false,
        error: code === 'ETIMEDOUT' ? 'Browser launcher timed out' : result.error.message,
      };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        error: result.signal
          ? `Browser launcher terminated by ${result.signal}`
          : `Browser launcher exited with status ${String(result.status)}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Handler for `omcustomcodex web start`. */
export async function webStartCommand(options: ServeCommandOptions): Promise<void> {
  await serveCommand(options);
}

/** Handler for `omcustomcodex web stop`. */
export async function webStopCommand(options: { _stateDir?: string } = {}): Promise<void> {
  await serveStopCommand(options);
}

/** Handler for `omcustomcodex web status`. */
export async function webStatusCommand(
  dependencies: Pick<WebCommandDependencies, 'stateDir'> = {}
): Promise<void> {
  const status = await getServeStatus({ stateDir: dependencies.stateDir });
  if (status.running && status.state !== undefined) {
    console.log(i18n.t('cli.web.status.running', { port: status.state.port }));
    if (status.state.portAssumed) {
      console.warn(i18n.t('cli.web.status.legacyPortAssumed', { port: status.state.port }));
    }
    return;
  }

  console.log(i18n.t('cli.web.status.notRunning'));
  console.log(i18n.t('cli.web.status.startHint'));
}

/** Handler for `omcustomcodex web open`. */
export async function webOpenCommand(
  options: { port?: string },
  dependencies: WebCommandDependencies = {}
): Promise<void> {
  const requestedPort = options.port === undefined ? undefined : Number(options.port);
  if (
    requestedPort !== undefined &&
    (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65_535)
  ) {
    console.error(`Invalid port: ${options.port}`);
    process.exit(1);
  }

  const status = await getServeStatus({
    stateDir: dependencies.stateDir,
    legacyPort: requestedPort,
  });
  if (!status.running || status.state === undefined || status.endpoint === undefined) {
    console.warn(i18n.t('cli.web.open.notRunningWarn'));
    return;
  }

  if (requestedPort !== undefined && requestedPort !== status.state.port) {
    console.warn(
      i18n.t('cli.web.open.portMismatch', {
        requestedPort,
        actualPort: status.state.port,
      })
    );
  }
  if (status.state.portAssumed) {
    console.warn(i18n.t('cli.web.status.legacyPortAssumed', { port: status.state.port }));
  }

  const opener = dependencies.browserOpener ?? openUrlInDefaultBrowser;
  const result = await opener(status.endpoint);
  if (!result.ok) {
    console.error(
      i18n.t('cli.web.open.failed', {
        url: status.endpoint,
        reason: result.error ?? 'unknown error',
      })
    );
    process.exitCode = 1;
    return;
  }

  console.log(i18n.t('cli.web.open.opened', { url: status.endpoint }));
}
