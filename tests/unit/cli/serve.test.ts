import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_PORT,
  findServeBuildDir,
  getServeStatus,
  isServeRunning,
  persistServeState,
  type ServeStateV1,
  startServeBackground,
  stopServe,
} from '../../../src/cli/serve.js';

async function withLongRunningChild<T>(callback: (pid: number) => Promise<T>): Promise<T> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  if (child.pid === undefined) throw new Error('Expected a child PID');

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try {
    return await callback(child.pid);
  } finally {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      // The lifecycle code may already have stopped it.
    }
    await Promise.race([exited, Bun.sleep(1_000)]);
  }
}

describe('serve.ts', () => {
  let tempDir: string;
  let stateFile: string;
  let legacyStateFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-serve-test-'));
    stateFile = join(tempDir, '.omcodex-serve.pid');
    legacyStateFile = join(tempDir, '.omcustom-serve.pid');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('exports the default port', () => {
    expect(DEFAULT_PORT).toBe(4321);
  });

  describe('findServeBuildDir', () => {
    it('returns null when the isolated build is absent', () => {
      expect(findServeBuildDir(tempDir, { skipNpmFallback: true })).toBeNull();
    });

    it('returns a local build containing index.js', async () => {
      const buildDir = join(tempDir, 'packages', 'serve', 'build');
      await mkdir(buildDir, { recursive: true });
      await writeFile(join(buildDir, 'index.js'), '// build output');
      expect(findServeBuildDir(tempDir)).toBe(buildDir);
    });

    it('does not accept a build directory without index.js', async () => {
      await mkdir(join(tempDir, 'packages', 'serve', 'build'), { recursive: true });
      expect(findServeBuildDir(tempDir, { skipNpmFallback: true })).toBeNull();
    });

    it('uses the package build fallback when available', async () => {
      const serveModuleDir = join(import.meta.dirname, '..', '..', '..', 'src', 'cli');
      const packageBuild = join(serveModuleDir, '..', '..', 'packages', 'serve', 'build');
      const packageIndex = join(packageBuild, 'index.js');
      const directoryExisted = existsSync(packageBuild);
      const indexExisted = existsSync(packageIndex);
      if (!directoryExisted) await mkdir(packageBuild, { recursive: true });
      if (!indexExisted) await writeFile(packageIndex, '// package build');

      try {
        expect(findServeBuildDir(tempDir)).toBe(packageBuild);
      } finally {
        if (!indexExisted) await rm(packageIndex, { force: true });
        if (!directoryExisted) await rm(packageBuild, { recursive: true, force: true });
      }
    });
  });

  describe('versioned lifecycle state', () => {
    const state = (pid: number, port = 9876): ServeStateV1 => ({
      version: 1,
      pid,
      port,
      projectRoot: '/tmp/project',
      startedAt: '2026-07-13T00:00:00.000Z',
    });

    it('round-trips the authoritative endpoint with mode 0600 and no temp residue', async () => {
      await persistServeState(state(process.pid), { stateDir: tempDir });

      const status = await getServeStatus({ stateDir: tempDir });
      expect(status.running).toBe(true);
      expect(status.state?.source).toBe('v1');
      expect(status.state?.port).toBe(9876);
      expect(status.state?.portAssumed).toBe(false);
      expect(status.endpoint).toBe('http://localhost:9876');
      expect((await stat(stateFile)).mode & 0o777).toBe(0o600);
      expect((await readdir(tempDir)).filter((name) => name.includes('.tmp-'))).toEqual([]);
    });

    it('accepts canonical numeric state with an explicit assumed port', async () => {
      await writeFile(stateFile, String(process.pid));
      const status = await getServeStatus({ stateDir: tempDir, legacyPort: 8123 });
      expect(status.state).toMatchObject({
        pid: process.pid,
        port: 8123,
        source: 'legacy-current',
        portAssumed: true,
      });
      expect(status.diagnostics).toContain('legacy-port-assumed');
    });

    it('accepts the legacy filename and compatibility environment port', async () => {
      const previous = process.env.OMCODEX_PORT;
      process.env.OMCODEX_PORT = '7654';
      try {
        await writeFile(legacyStateFile, String(process.pid));
        const status = await getServeStatus({ stateDir: tempDir });
        expect(status.state).toMatchObject({ port: 7654, source: 'legacy-file' });
      } finally {
        if (previous === undefined) delete process.env.OMCODEX_PORT;
        else process.env.OMCODEX_PORT = previous;
      }
    });

    it('strictly rejects malformed JSON and removes it', async () => {
      await writeFile(
        stateFile,
        JSON.stringify({ ...state(process.pid), projectRoot: 'relative/project' })
      );
      const status = await getServeStatus({ stateDir: tempDir });
      expect(status.running).toBe(false);
      expect(status.diagnostics).toContain('invalid-state-removed');
      expect(await Bun.file(stateFile).exists()).toBe(false);
    });

    it('removes stale V1 state', async () => {
      await persistServeState(state(999_999_999), { stateDir: tempDir });
      const status = await getServeStatus({
        stateDir: tempDir,
        processExists: () => false,
      });
      expect(status.running).toBe(false);
      expect(status.diagnostics).toContain('stale-state-removed');
      expect(await Bun.file(stateFile).exists()).toBe(false);
    });

    it('does not claim cleanup succeeded when state removal is denied', async () => {
      await writeFile(stateFile, 'invalid-state');
      const accessDenied = new Error('permission denied') as NodeJS.ErrnoException;
      accessDenied.code = 'EACCES';

      await expect(
        getServeStatus({
          stateDir: tempDir,
          unlinkFile: async () => {
            throw accessDenied;
          },
        })
      ).rejects.toMatchObject({ code: 'EACCES' });
      expect(await Bun.file(stateFile).exists()).toBe(true);
    });

    it('keeps isServeRunning as a compatibility wrapper', async () => {
      await persistServeState(state(process.pid), { stateDir: tempDir });
      expect(await isServeRunning({ stateDir: tempDir })).toBe(true);
    });
  });

  describe('start and stop', () => {
    it('rejects a fractional port before spawning or persisting state', async () => {
      const result = await startServeBackground(
        tempDir,
        4321.5,
        { skipNpmFallback: true },
        { stateDir: tempDir }
      );
      expect(result.kind).toBe('failed');
      expect(await Bun.file(stateFile).exists()).toBe(false);
    });

    it('returns missing-build instead of pretending to start', async () => {
      const result = await startServeBackground(
        tempDir,
        DEFAULT_PORT,
        { skipNpmFallback: true },
        { stateDir: tempDir }
      );
      expect(result).toEqual({ kind: 'missing-build' });
    });

    it('returns the persisted actual port when already running', async () => {
      await persistServeState(
        {
          version: 1,
          pid: process.pid,
          port: 7444,
          projectRoot: tempDir,
          startedAt: new Date().toISOString(),
        },
        { stateDir: tempDir }
      );

      const result = await startServeBackground(
        tempDir,
        7555,
        { skipNpmFallback: true },
        { stateDir: tempDir }
      );
      expect(result.kind).toBe('already-running');
      if (result.kind === 'already-running') expect(result.state.port).toBe(7444);
    });

    it('persists a custom-port child and removes state when stopped', async () => {
      const buildDir = join(tempDir, 'packages', 'serve', 'build');
      await mkdir(buildDir, { recursive: true });
      await writeFile(join(buildDir, 'index.js'), 'setInterval(() => {}, 1000);');

      const result = await startServeBackground(
        tempDir,
        7333,
        { skipNpmFallback: true },
        { stateDir: tempDir, now: () => new Date('2026-07-13T00:00:00.000Z') }
      );
      expect(result.kind).toBe('started');
      expect(JSON.parse(await readFile(stateFile, 'utf8'))).toMatchObject({
        version: 1,
        port: 7333,
        projectRoot: tempDir,
      });
      expect(await stopServe({ stateDir: tempDir })).toBe(true);
      expect(await Bun.file(stateFile).exists()).toBe(false);
    });

    it('stops legacy state and cleans both files', async () => {
      await withLongRunningChild(async (pid) => {
        await writeFile(stateFile, String(pid));
        await writeFile(legacyStateFile, String(pid));
        expect(await stopServe({ stateDir: tempDir })).toBe(true);
        expect(await Bun.file(stateFile).exists()).toBe(false);
        expect(await Bun.file(legacyStateFile).exists()).toBe(false);
      });
    });

    it('returns false and cleans invalid state', async () => {
      await writeFile(stateFile, 'not-state');
      expect(await stopServe({ stateDir: tempDir })).toBe(false);
      expect(await Bun.file(stateFile).exists()).toBe(false);
    });
  });
});
