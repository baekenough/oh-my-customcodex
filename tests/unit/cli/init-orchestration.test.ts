import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { initCommand } from '../../../src/cli/init.js';
import type { InstallOptions, InstallResult } from '../../../src/core/installer.js';

describe('init OMX orchestration', () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('requires project provisioning and does not report success when install fails', async () => {
    let capturedOptions: InstallOptions | undefined;
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

    try {
      const failedInstall: InstallResult = {
        success: false,
        installedPath: process.cwd(),
        installedComponents: [],
        skippedComponents: [],
        backedUpPaths: [],
        warnings: [],
        error: 'OMX project setup remains incomplete',
      };

      const result = await initCommand(
        { yes: true },
        {
          install: async (options) => {
            capturedOptions = options;
            return failedInstall;
          },
        }
      );

      expect(capturedOptions?.provisionOmxProject).toBe(true);
      expect(result.success).toBe(false);
      expect(result.errors).toContain('OMX project setup remains incomplete');
      expect(logSpy.mock.calls.flat().join('\n')).not.toContain('Codex setup complete');
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
