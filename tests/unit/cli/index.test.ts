import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProgram } from '../../../src/cli/index.js';
import { i18n, initI18n } from '../../../src/i18n/index.js';
import {
  detectCliCommandName,
  rewriteCliCommandReferences,
  setActiveCliCommandName,
} from '../../../src/utils/cli-command-name.js';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON_PATH = join(TEST_DIR, '../../../package.json');

describe('cli command aliases', () => {
  beforeEach(async () => {
    await initI18n('en');
    setActiveCliCommandName('omcustomcodex');
  });

  it('detects omcustomcodex from the invoked binary path', () => {
    expect(detectCliCommandName(['node', '/usr/local/bin/omcustomcodex'])).toBe('omcustomcodex');
    expect(detectCliCommandName(['node', 'C:\\tools\\omcustomcodex.cmd'])).toBe('omcustomcodex');
  });

  it('rewrites standalone command references to the active canonical name', () => {
    setActiveCliCommandName('omcustomcodex');

    expect(i18n.t('cli.update.runInitFirst')).toContain("'omcustomcodex init'");
    expect(i18n.t('cli.web.status.startHint')).toContain('omcustomcodex web start');
    expect(rewriteCliCommandReferences('See .omcodex.lock.json and run omcodex doctor')).toBe(
      'See .omcodex.lock.json and run omcustomcodex doctor'
    );
    expect(rewriteCliCommandReferences('Run omcustom doctor if the old package is installed')).toBe(
      'Run omcustomcodex doctor if the old package is installed'
    );
  });

  it('uses the active command name in commander help output', () => {
    const program = createProgram('omcustomcodex');
    const help = program.helpInformation().replace(/\s+/g, ' ');

    expect(program.name()).toBe('omcustomcodex');
    expect(help).toContain('Usage: omcustomcodex');
    expect(help).toContain('(Deprecated) Start the Web UI server');
    expect(help).toContain('omcustomcodex web start');
  });

  it('publishes only the non-conflicting binary aliases', async () => {
    const packageJson = JSON.parse(await readFile(PACKAGE_JSON_PATH, 'utf-8')) as {
      bin?: Record<string, string>;
    };

    expect(packageJson.bin?.omcustom).toBeUndefined();
    expect(packageJson.bin?.omcustomx).toBeUndefined();
    expect(packageJson.bin?.omcodex).toBeUndefined();
    expect(packageJson.bin?.omcustomcodex).toBe('./dist/cli/index.js');
  });

  it('does not run preflight network/cache work before update --dry-run', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'omcodex-cli-dry-run-'));
    const homeDir = join(tempDir, 'home');
    const fakeBin = join(tempDir, 'fake-bin');
    const invocationLog = join(tempDir, 'invocations.log');

    try {
      await mkdir(homeDir, { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      for (const command of ['npm', 'brew']) {
        await writeFile(
          join(fakeBin, command),
          `#!/bin/sh\necho ${command} "$@" >> "${invocationLog}"\nexit 42\n`,
          { mode: 0o755 }
        );
      }
      await writeFile(
        join(tempDir, '.omcodexrc.json'),
        JSON.stringify({ configVersion: 0, version: '0.1.0', language: 'en' })
      );

      const result = Bun.spawnSync({
        cmd: [process.execPath, join(TEST_DIR, '../../../src/cli/index.ts'), 'update', '--dry-run'],
        cwd: tempDir,
        env: {
          ...process.env,
          HOME: homeDir,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          OMCODEX_SKIP_SELF_UPDATE: 'true',
          OMCUSTOM_SKIP_SELF_UPDATE: 'true',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(result.exitCode).toBe(0);
      expect(await readFile(invocationLog, 'utf-8').catch(() => '')).toBe('');
      expect(
        await readFile(join(homeDir, '.oh-my-customcodex', 'preflight-cache.json'), 'utf-8').catch(
          () => null
        )
      ).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('sets a failing exit code when snapshot initialization fails', async () => {
    const previousExitCode = process.exitCode;
    const tempDir = await mkdtemp(join(tmpdir(), 'omcodex-cli-snapshot-'));
    const missingPath = join(tempDir, 'missing');

    try {
      const result = Bun.spawnSync({
        cmd: [
          process.execPath,
          join(TEST_DIR, '../../../src/cli/index.ts'),
          '--skip-version-check',
          'init',
          '--yes',
          '--from-snapshot',
          missingPath,
        ],
        cwd: tempDir,
        env: {
          ...process.env,
          OMCODEX_SKIP_SELF_UPDATE: 'true',
          OMCUSTOM_SKIP_SELF_UPDATE: 'true',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const stderr = result.stderr.toString();

      expect(result.exitCode).toBe(1);
      expect(stderr).toContain('Snapshot path not found');
      expect(stderr).toContain(missingPath);
      expect(process.exitCode).toBe(previousExitCode);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
