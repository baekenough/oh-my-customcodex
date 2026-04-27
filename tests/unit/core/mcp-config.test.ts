import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as childProcess from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkUvAvailable,
  generateMCPConfig,
  getProjectMCPConfigPath,
} from '../../../src/core/mcp-config.js';

describe('mcp-config', () => {
  let tempDir: string;
  let execSyncSpy: ReturnType<typeof spyOn>;
  let consoleInfoSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let consoleDebugSpy: ReturnType<typeof spyOn>;
  let consoleLogSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-mcp-config-test-'));
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleInfoSpy = spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
    consoleDebugSpy = spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(async () => {
    execSyncSpy?.mockRestore();
    consoleLogSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleDebugSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('checkUvAvailable', () => {
    it('returns true when uv is available', async () => {
      execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

      const result = await checkUvAvailable();

      expect(result).toBe(true);
      expect(execSyncSpy).toHaveBeenCalledWith('uv --version', { stdio: 'pipe' });
      expect(execSyncSpy).toHaveBeenCalledWith('uv python find 3.12', { stdio: 'pipe' });
    });

    it('returns false when uv is unavailable or Python 3.12 cannot be found', async () => {
      execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation((command) => {
        if (String(command) === 'uv --version') return Buffer.from('');
        throw new Error('Python 3.12 not found');
      });

      const result = await checkUvAvailable();

      expect(result).toBe(false);
    });

    it('returns false when execSync throws a non-Error value', async () => {
      execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => {
        throw 'uv failed';
      });

      const result = await checkUvAvailable();

      expect(result).toBe(false);
    });
  });

  describe('generateMCPConfig', () => {
    it('does not create config when ontology directory is absent', async () => {
      await generateMCPConfig(tempDir);

      const configPath = getProjectMCPConfigPath(tempDir);
      expect(await Bun.file(configPath).exists()).toBe(false);
    });

    it('creates .codex/config.toml when ontology directory exists', async () => {
      await mkdir(join(tempDir, '.codex', 'ontology'), { recursive: true });
      execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

      await generateMCPConfig(tempDir);

      const configPath = getProjectMCPConfigPath(tempDir);
      const content = await readFile(configPath, 'utf-8');

      expect(content).toContain('[mcp_servers.ontology-rag]');
      expect(content).toContain('command = "uv"');
      expect(content).toContain(
        'args = ["run", "--no-project", "--python", ".venv", "python", "-m", "ontology_rag.mcp_server"]'
      );
      expect(content).toContain('[mcp_servers.ontology-rag.env]');
      expect(content).toContain('ONTOLOGY_DIR = ".codex/ontology"');
    });

    it('creates config.toml inside the .codex directory when needed', async () => {
      await mkdir(join(tempDir, '.codex', 'ontology'), { recursive: true });
      execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

      await generateMCPConfig(tempDir);

      expect(await Bun.file(getProjectMCPConfigPath(tempDir)).exists()).toBe(true);
    });

    it('checks uv and installs ontology-rag via execSync', async () => {
      await mkdir(join(tempDir, '.codex', 'ontology'), { recursive: true });
      const seenCommands: string[] = [];
      execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation((command) => {
        seenCommands.push(String(command));
        return Buffer.from('');
      });

      await generateMCPConfig(tempDir);

      expect(seenCommands).toEqual([
        'uv --version',
        'uv python find 3.12',
        'uv venv --python 3.12 .venv',
        'uv pip install "ontology-rag @ git+https://github.com/baekenough/oh-my-customcodex.git#subdirectory=packages/ontology-rag"',
      ]);
    });

    it('warns and skips config creation when uv is unavailable', async () => {
      await mkdir(join(tempDir, '.codex', 'ontology'), { recursive: true });
      execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => {
        throw new Error('uv not found');
      });

      await generateMCPConfig(tempDir);

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(await Bun.file(getProjectMCPConfigPath(tempDir)).exists()).toBe(false);
    });

    it('warns and skips config creation when ontology-rag installation fails', async () => {
      await mkdir(join(tempDir, '.codex', 'ontology'), { recursive: true });
      execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation((command) => {
        if (String(command) === 'uv --version') return Buffer.from('');
        if (String(command) === 'uv python find 3.12') return Buffer.from('');
        throw new Error('install failed');
      });

      await generateMCPConfig(tempDir);

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(await Bun.file(getProjectMCPConfigPath(tempDir)).exists()).toBe(false);
    });

    it('appends ontology-rag config to an existing .codex/config.toml', async () => {
      await mkdir(join(tempDir, '.codex', 'ontology'), { recursive: true });
      const configPath = getProjectMCPConfigPath(tempDir);
      await writeFile(
        configPath,
        'model = "gpt-5.4"\n\n[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]\n',
        'utf-8'
      );
      execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

      await generateMCPConfig(tempDir);

      const content = await readFile(configPath, 'utf-8');
      expect(content).toContain('model = "gpt-5.4"');
      expect(content).toContain('[mcp_servers.context7]');
      expect(content).toContain('[mcp_servers.ontology-rag]');
    });

    it('does not overwrite an existing ontology-rag config block', async () => {
      await mkdir(join(tempDir, '.codex', 'ontology'), { recursive: true });
      const configPath = getProjectMCPConfigPath(tempDir);
      const existingBlock = [
        '[mcp_servers.ontology-rag]',
        'command = "custom-python"',
        'args = ["--custom"]',
        '',
        '[mcp_servers.ontology-rag.env]',
        'ONTOLOGY_DIR = "custom-ontology"',
        'CUSTOM_FLAG = "enabled"',
        '',
      ].join('\n');
      await writeFile(configPath, existingBlock, 'utf-8');
      execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

      await generateMCPConfig(tempDir);

      const content = await readFile(configPath, 'utf-8');
      expect(content).toBe(existingBlock);
      expect(content.match(/\[mcp_servers\.ontology-rag\]/g)?.length).toBe(1);
    });

    it('writes a clean block when config.toml does not yet exist', async () => {
      await mkdir(join(tempDir, '.codex', 'ontology'), { recursive: true });
      execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

      await generateMCPConfig(tempDir);

      const content = await readFile(getProjectMCPConfigPath(tempDir), 'utf-8');
      expect(content.startsWith('[mcp_servers.ontology-rag]')).toBe(true);
      expect(content.endsWith('"\n')).toBe(true);
    });
  });
});
