import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import * as childProcess from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('does not probe uv when ontology MCP is already configured', async () => {
    const originalCwd = process.cwd();
    const tempDir = await mkdtemp(join(tmpdir(), 'omcodex-init-mcp-configured-'));
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    const execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => {
      throw new Error('uv should not be probed for an already configured project');
    });
    execSyncSpy.mockClear();

    try {
      await mkdir(join(tempDir, '.codex', 'ontology'), { recursive: true });
      await writeFile(
        join(tempDir, '.codex', 'config.toml'),
        '[mcp_servers.ontology-rag]\ncommand = "uv"\nargs = []\n'
      );
      process.chdir(tempDir);

      const successfulInstall: InstallResult = {
        success: true,
        installedPath: tempDir,
        installedComponents: [],
        skippedComponents: [],
        backedUpPaths: [],
        warnings: [],
      };

      const result = await initCommand(
        { yes: true },
        {
          install: async () => successfulInstall,
        }
      );

      expect(result.success).toBe(true);
      expect(execSyncSpy).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
      execSyncSpy.mockRestore();
      logSpy.mockRestore();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
