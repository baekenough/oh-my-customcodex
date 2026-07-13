import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = join(import.meta.dirname, '..', '..');
const CLI_ENTRY = join(REPOSITORY_ROOT, 'src', 'cli', 'index.ts');
const WEB_COMMANDS_MODULE = pathToFileURL(
  join(REPOSITORY_ROOT, 'src', 'cli', 'web-commands.ts')
).href;
const I18N_MODULE = pathToFileURL(join(REPOSITORY_ROOT, 'src', 'i18n', 'index.ts')).href;

const roots: string[] = [];

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Could not reserve a port');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}

async function waitForReachability(url: string, reachable: boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (reachable && response.ok) return;
    } catch {
      if (!reachable) return;
    }
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for ${url} to become ${reachable ? 'reachable' : 'stopped'}`);
}

function runCli(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): ReturnType<typeof spawnSync> {
  return spawnSync('bun', [CLI_ENTRY, ...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: 15_000,
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('cross-process Web lifecycle', () => {
  it('persists a custom port for status, injected open, and stop', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omcodex-web-lifecycle-'));
    roots.push(root);
    const home = join(root, 'home');
    const project = join(root, 'project');
    const buildDir = join(project, 'packages', 'serve', 'build');
    await Promise.all([mkdir(home, { recursive: true }), mkdir(buildDir, { recursive: true })]);
    await writeFile(
      join(buildDir, 'index.js'),
      `import { createServer } from 'node:http';
const port = Number(process.env.OMCODEX_PORT);
createServer((_request, response) => response.end('ready')).listen(port, 'localhost');
`
    );

    const port = await reservePort();
    const url = `http://localhost:${port}`;
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      NO_COLOR: '1',
    };
    delete env.OMCODEX_PORT;
    delete env.OMCUSTOM_PORT;

    try {
      const started = runCli(['web', 'start', '--port', String(port)], { cwd: project, env });
      expect(started.status).toBe(0);
      expect(`${started.stdout}\n${started.stderr}`).toContain(String(port));
      await waitForReachability(url, true);

      const status = runCli(['web', 'status'], { cwd: project, env });
      expect(status.status).toBe(0);
      expect(`${status.stdout}\n${status.stderr}`).toContain(String(port));

      const openScript = `
        import { webOpenCommand } from ${JSON.stringify(WEB_COMMANDS_MODULE)};
        import { initI18n } from ${JSON.stringify(I18N_MODULE)};
        await initI18n('en');
        await webOpenCommand({}, {
          stateDir: process.env.TEST_STATE_DIR,
          browserOpener: (url) => { console.log('TEST_OPEN=' + url); return { ok: true }; }
        });
      `;
      const opened = spawnSync('bun', ['-e', openScript], {
        cwd: project,
        env: { ...env, TEST_STATE_DIR: home },
        encoding: 'utf8',
        timeout: 15_000,
      });
      expect(opened.status).toBe(0);
      expect(`${opened.stdout}\n${opened.stderr}`).toContain(`TEST_OPEN=${url}`);

      const stopped = runCli(['web', 'stop'], { cwd: project, env });
      expect(stopped.status).toBe(0);
      await waitForReachability(url, false);
      expect(existsSync(join(home, '.omcodex-serve.pid'))).toBe(false);
    } finally {
      if (existsSync(join(home, '.omcodex-serve.pid'))) {
        runCli(['web', 'stop'], { cwd: project, env });
      }
    }
  });
});
