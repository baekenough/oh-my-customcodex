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
    setActiveCliCommandName('omcodex');
  });

  it('detects omcustomx from the invoked binary path', () => {
    expect(detectCliCommandName(['node', '/usr/local/bin/omcustomx'])).toBe('omcustomx');
    expect(detectCliCommandName(['node', 'C:\\tools\\omcustomx.cmd'])).toBe('omcustomx');
    expect(detectCliCommandName(['node', '/usr/local/bin/omcustomcodex'])).toBe('omcustomcodex');
  });

  it('rewrites standalone omcodex command references for alias output', () => {
    setActiveCliCommandName('omcustomx');

    expect(i18n.t('cli.update.runInitFirst')).toContain("'omcustomx init'");
    expect(i18n.t('cli.web.status.startHint')).toContain('omcustomx web start');
    expect(rewriteCliCommandReferences('See .omcodex.lock.json and run omcodex doctor')).toBe(
      'See .omcodex.lock.json and run omcustomx doctor'
    );
  });

  it('uses the active command name in commander help output', () => {
    const program = createProgram('omcustomx');
    const help = program.helpInformation().replace(/\s+/g, ' ');

    expect(program.name()).toBe('omcustomx');
    expect(help).toContain('Usage: omcustomx');
    expect(help).toContain('(Deprecated) Start the Web UI server');
    expect(help).toContain('omcustomx web start');
  });

  it('publishes extended binary aliases', async () => {
    const packageJson = JSON.parse(await readFile(PACKAGE_JSON_PATH, 'utf-8')) as {
      bin?: Record<string, string>;
    };

    expect(packageJson.bin?.omcustomx).toBe('./dist/cli/index.js');
    expect(packageJson.bin?.omcustomcodex).toBe('./dist/cli/index.js');
  });
});
