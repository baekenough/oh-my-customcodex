import { beforeEach, describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
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
});
