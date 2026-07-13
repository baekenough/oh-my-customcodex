import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openUrlInDefaultBrowser,
  webOpenCommand,
  webStartCommand,
  webStatusCommand,
  webStopCommand,
} from '../../../src/cli/web-commands.js';
import { initI18n } from '../../../src/i18n/index.js';

type SpawnSync = typeof import('node:child_process').spawnSync;

function successfulSpawn(
  calls: Array<{ command: string; args: readonly string[]; options: Record<string, unknown> }>
): SpawnSync {
  return ((command: string, args: readonly string[], options: Record<string, unknown>) => {
    calls.push({ command, args, options });
    return {
      pid: 123,
      output: [null, null, null],
      stdout: null,
      stderr: null,
      status: 0,
      signal: null,
    };
  }) as SpawnSync;
}

describe('web commands', () => {
  let stateDir: string;
  let stateFile: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  async function writeState(port: number, pid = process.pid): Promise<void> {
    await writeFile(
      stateFile,
      JSON.stringify({
        version: 1,
        pid,
        port,
        projectRoot: stateDir,
        startedAt: '2026-07-13T00:00:00.000Z',
      })
    );
  }

  beforeEach(async () => {
    await initI18n('en');
    stateDir = await mkdtemp(join(tmpdir(), 'omcodex-web-command-test-'));
    stateFile = join(stateDir, '.omcodex-serve.pid');
    process.exitCode = 0;
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    // Bun keeps the first non-zero exitCode when it is reset to undefined.
    process.exitCode = 0;
    await rm(stateDir, { recursive: true, force: true });
  });

  describe('browser launcher', () => {
    it('uses exact shell-free macOS argv and keeps metacharacters in one argument', () => {
      const calls: Array<{
        command: string;
        args: readonly string[];
        options: Record<string, unknown>;
      }> = [];
      const url = 'http://localhost:4321/?x=$HOME;echo pwned';
      expect(
        openUrlInDefaultBrowser(url, {
          platform: 'darwin',
          spawnSyncImpl: successfulSpawn(calls),
        })
      ).toEqual({ ok: true });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ command: '/usr/bin/open', args: [url] });
      expect(calls[0]?.options.shell).toBe(false);
    });

    it('uses xdg-open on Linux', () => {
      const calls: Array<{
        command: string;
        args: readonly string[];
        options: Record<string, unknown>;
      }> = [];
      openUrlInDefaultBrowser('http://localhost:4321', {
        platform: 'linux',
        spawnSyncImpl: successfulSpawn(calls),
      });
      expect(calls[0]).toMatchObject({
        command: 'xdg-open',
        args: ['http://localhost:4321'],
      });
    });

    it('uses direct rundll32 argv on Windows', () => {
      const calls: Array<{
        command: string;
        args: readonly string[];
        options: Record<string, unknown>;
      }> = [];
      openUrlInDefaultBrowser('http://localhost:4321', {
        platform: 'win32',
        systemRoot: 'C:\\Windows',
        spawnSyncImpl: successfulSpawn(calls),
      });
      expect(calls[0]).toMatchObject({
        command: join('C:\\Windows', 'System32', 'rundll32.exe'),
        args: ['url.dll,FileProtocolHandler', 'http://localhost:4321'],
      });
    });

    it('rejects unsupported platforms before spawning', () => {
      expect(openUrlInDefaultBrowser('http://localhost:4321', { platform: 'aix' })).toEqual({
        ok: false,
        error: 'Unsupported platform: aix',
      });
    });

    it('reports non-zero and timeout results', () => {
      const nonzero = (() => ({ status: 7, signal: null })) as SpawnSync;
      expect(
        openUrlInDefaultBrowser('http://localhost:4321', {
          platform: 'linux',
          spawnSyncImpl: nonzero,
        }).error
      ).toContain('status 7');

      const timedOut = (() => {
        const error = new Error('timed out') as NodeJS.ErrnoException;
        error.code = 'ETIMEDOUT';
        return { status: null, signal: 'SIGTERM', error };
      }) as SpawnSync;
      expect(
        openUrlInDefaultBrowser('http://localhost:4321', {
          platform: 'linux',
          spawnSyncImpl: timedOut,
        })
      ).toEqual({ ok: false, error: 'Browser launcher timed out' });
    });
  });

  describe('web status', () => {
    it('prints not-running status and start hint without state', async () => {
      await webStatusCommand({ stateDir });
      const output = consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('not running');
      expect(output).toContain('omcustomcodex web start');
      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    });

    it('uses the persisted port instead of the current process environment', async () => {
      const previous = process.env.OMCODEX_PORT;
      process.env.OMCODEX_PORT = '4321';
      try {
        await writeState(9876);
        await webStatusCommand({ stateDir });
        expect(consoleLogSpy.mock.calls.flat().join(' ')).toContain('9876');
        expect(consoleLogSpy.mock.calls.flat().join(' ')).not.toContain('4321');
      } finally {
        if (previous === undefined) delete process.env.OMCODEX_PORT;
        else process.env.OMCODEX_PORT = previous;
      }
    });
  });

  describe('web open', () => {
    it('validates only an explicitly supplied port', async () => {
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      try {
        await expect(webOpenCommand({ port: 'nope' }, { stateDir })).rejects.toThrow(
          'process.exit called'
        );
        await expect(webOpenCommand({}, { stateDir })).resolves.toBeUndefined();
      } finally {
        exitSpy.mockRestore();
      }
    });

    it('preserves the actionable no-server warning without invoking a browser', async () => {
      let opened = false;
      await webOpenCommand(
        {},
        {
          stateDir,
          browserOpener: () => {
            opened = true;
            return { ok: true };
          },
        }
      );
      expect(consoleWarnSpy.mock.calls.flat().join(' ')).toContain('not');
      expect(opened).toBe(false);
    });

    it('opens the persisted custom port across an independent invocation', async () => {
      await writeState(9345);
      let openedUrl = '';
      await webOpenCommand(
        {},
        {
          stateDir,
          browserOpener: (url) => {
            openedUrl = url;
            return { ok: true };
          },
        }
      );
      expect(openedUrl).toBe('http://localhost:9345');
      expect(consoleLogSpy.mock.calls.flat().join(' ')).toContain('9345');
    });

    it('warns on an explicit mismatch and still opens the authoritative endpoint', async () => {
      await writeState(9345);
      let openedUrl = '';
      await webOpenCommand(
        { port: '4321' },
        {
          stateDir,
          browserOpener: (url) => {
            openedUrl = url;
            return { ok: true };
          },
        }
      );
      expect(openedUrl).toBe('http://localhost:9345');
      expect(consoleWarnSpy.mock.calls.flat().join(' ')).toContain('9345');
    });

    it('sets a failing exit code and diagnostic when browser launch fails', async () => {
      await writeState(9345);
      await webOpenCommand(
        {},
        {
          stateDir,
          browserOpener: () => ({ ok: false, error: 'launcher missing' }),
        }
      );
      expect(process.exitCode).toBe(1);
      expect(consoleErrorSpy.mock.calls.flat().join(' ')).toContain('launcher missing');
    });
  });

  describe('delegated start and stop', () => {
    it('reports a missing isolated build as a failed start', async () => {
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      try {
        await expect(
          webStartCommand({ port: '9000', _projectRoot: stateDir, _stateDir: stateDir })
        ).rejects.toThrow('process.exit called');
        expect(consoleErrorSpy.mock.calls.flat().join(' ')).toContain('Failed');
      } finally {
        exitSpy.mockRestore();
      }
    });

    it('reports not running when stopped without state', async () => {
      await webStopCommand({ _stateDir: stateDir });
      expect(consoleLogSpy.mock.calls.flat().join(' ')).toContain('not running');
    });
  });
});
