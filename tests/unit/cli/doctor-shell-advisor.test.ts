import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CheckResult,
  checkManagedShellAdvisor,
  doctorCommand,
} from '../../../src/cli/doctor.js';
import { initI18n } from '../../../src/i18n/index.js';

describe('doctor --require-shell-advisor focused gate', () => {
  let projectRoot: string;
  let originalCwd: typeof process.cwd;
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    await initI18n('en');
    projectRoot = await mkdtemp(join(tmpdir(), 'omcodex-doctor-shell-advisor-'));
    originalCwd = process.cwd;
    process.cwd = () => projectRoot;
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    consoleSpy.mockRestore();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('runs only the focused check and succeeds only for runnable readiness', async () => {
    let inventoryCalls = 0;
    const focusedPass: CheckResult = {
      name: 'Managed shell advisor',
      status: 'pass',
      message: 'Managed shell advisor is runnable.',
      fixable: false,
    };

    const result = await doctorCommand(
      { requireShellAdvisor: true },
      {
        runAllChecks: async () => {
          inventoryCalls += 1;
          return [];
        },
        checkManagedShellAdvisor: () => focusedPass,
      }
    );

    expect(result.success).toBe(true);
    expect(result.checks).toEqual([focusedPass]);
    expect(inventoryCalls).toBe(0);
  });

  it('fails closed with state-specific safe remediation and no sensitive internals', () => {
    const states = [
      ['missing', 'omcustomcodex update --hooks'],
      ['integrity-failed', 'omcustomcodex update --hooks --force-overwrite-all'],
      ['assets-modified', 'omcustomcodex update --hooks --force-overwrite-all'],
      ['inactive', 'user-level'],
      ['approval-needed', '/hooks'],
      ['unverified', 'could not be verified'],
    ] as const;

    for (const [status, remediation] of states) {
      const result = checkManagedShellAdvisor(projectRoot, {
        assess: () => ({
          status,
          ready: false,
          projectRoot,
          codexProjectRoot: projectRoot,
          installed: status !== 'missing',
          discovered: 0,
        }),
      });
      const rendered = [result.message, ...(result.details ?? [])].join('\n');

      expect(result.status).toBe('fail');
      expect(rendered).toContain(remediation);
      expect(rendered).not.toMatch(/sha256|currentHash|repo_root=|credential/i);
    }

    const missing = checkManagedShellAdvisor(projectRoot, {
      assess: () => ({
        status: 'missing',
        ready: false,
        projectRoot,
        codexProjectRoot: projectRoot,
        installed: false,
        discovered: 0,
      }),
    });
    expect(missing.message).not.toContain('--force-overwrite-all');

    const inactive = checkManagedShellAdvisor(projectRoot, {
      assess: () => ({
        status: 'inactive',
        ready: false,
        projectRoot,
        codexProjectRoot: projectRoot,
        installed: true,
        discovered: 0,
      }),
    });
    expect(inactive.message).toContain('[features] hooks = true');
    expect(inactive.message).toContain('trust the project');
    expect(inactive.message).toContain('/hooks');
    expect(inactive.message).toContain('never written automatically');

    const runnable = checkManagedShellAdvisor(projectRoot, {
      assess: () => ({
        status: 'runnable',
        ready: true,
        projectRoot,
        codexProjectRoot: projectRoot,
        installed: true,
        discovered: 1,
      }),
    });
    expect(runnable.status).toBe('pass');
  });

  it('detects a source checkout and never recommends mutating tracked hook assets', async () => {
    await writeFile(
      join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'oh-my-customcodex', version: '1.0.31' })
    );

    const missing = checkManagedShellAdvisor(projectRoot, {
      assess: () => ({
        status: 'missing',
        ready: false,
        projectRoot,
        codexProjectRoot: projectRoot,
        installed: false,
        discovered: 0,
      }),
    });
    expect(missing.message).toContain('source checkout');
    expect(missing.message).toContain('registry-only');
    expect(missing.message).toContain('omcustomcodex update --hooks');
    expect(missing.message).not.toContain('installNativeCodexHooks');

    const modified = checkManagedShellAdvisor(projectRoot, {
      assess: () => ({
        status: 'assets-modified',
        ready: false,
        projectRoot,
        codexProjectRoot: projectRoot,
        installed: true,
        discovered: 0,
      }),
    });
    expect(modified.message).toContain('tracked source');
    expect(modified.message).not.toContain('--force-overwrite-all');
    expect(modified.message).not.toContain('installNativeCodexHooks');
  });
});
