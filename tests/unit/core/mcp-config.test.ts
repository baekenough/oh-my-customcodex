import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkUvAvailable,
  generateMCPConfig,
  getProjectMCPConfigPath,
} from '../../../src/core/mcp-config.js';

async function hashTree(root: string): Promise<string> {
  const entries: string[] = [];
  async function walk(dir: string, prefix = ''): Promise<void> {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        entries.push(`l:${relativePath}:${await readlink(fullPath)}`);
      } else if (entry.isDirectory()) {
        entries.push(`d:${relativePath}`);
        await walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        entries.push(`f:${relativePath}:${await readFile(fullPath, 'hex')}`);
      } else {
        entries.push(`s:${relativePath}`);
      }
    }
  }
  await walk(root);
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

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
        'uv pip install --python .venv "ontology-rag @ git+https://github.com/baekenough/oh-my-customcodex.git#subdirectory=packages/ontology-rag"',
      ]);
    });

    it('pins installation to the project .venv and ignores a hostile VIRTUAL_ENV', async () => {
      const outsideVenv = await mkdtemp(join(tmpdir(), 'omcodex-mcp-hostile-venv-'));
      const previousVirtualEnv = process.env.VIRTUAL_ENV;
      try {
        await mkdir(join(tempDir, '.codex', 'ontology'), { recursive: true });
        await writeFile(join(outsideVenv, 'sentinel.txt'), 'HOSTILE-VENV-SENTINEL\n');
        const outsideBefore = await hashTree(outsideVenv);
        process.env.VIRTUAL_ENV = outsideVenv;
        let installOptions: childProcess.ExecSyncOptions | undefined;
        execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation((command, options) => {
          if (String(command).startsWith('uv pip install')) {
            installOptions = options as childProcess.ExecSyncOptions;
          }
          return Buffer.from('');
        });

        await generateMCPConfig(tempDir);

        const installCall = execSyncSpy.mock.calls.find(([command]) =>
          String(command).startsWith('uv pip install')
        );
        expect(String(installCall?.[0])).toStartWith('uv pip install --python .venv ');
        expect(installOptions?.env?.VIRTUAL_ENV).toBeUndefined();
        expect(await hashTree(outsideVenv)).toBe(outsideBefore);
        expect(await Bun.file(getProjectMCPConfigPath(tempDir)).exists()).toBe(true);
      } finally {
        if (previousVirtualEnv === undefined) delete process.env.VIRTUAL_ENV;
        else process.env.VIRTUAL_ENV = previousVirtualEnv;
        await rm(outsideVenv, { recursive: true, force: true });
      }
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

    it('rejects a config.toml symlink before running uv or overwriting outside content', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-mcp-outside-'));
      try {
        await mkdir(join(tempDir, '.codex', 'ontology'), { recursive: true });
        const outsideConfig = join(outsideDir, 'sentinel.toml');
        const original = 'outside = true\n';
        await writeFile(outsideConfig, original);
        const configPath = getProjectMCPConfigPath(tempDir);
        await symlink(outsideConfig, configPath);
        execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

        await expect(generateMCPConfig(tempDir)).rejects.toThrow('symbolic link');

        expect(execSyncSpy).not.toHaveBeenCalled();
        expect(await readFile(outsideConfig, 'utf-8')).toBe(original);
        expect((await lstat(configPath)).isSymbolicLink()).toBe(true);
        await expect(lstat(join(tempDir, '.venv'))).rejects.toThrow();
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects a hard-linked config.toml before running uv or changing either tree', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-mcp-config-hardlink-outside-'));
      try {
        const codexDir = join(tempDir, '.codex');
        await mkdir(join(codexDir, 'ontology'), { recursive: true });
        const outsideConfig = join(outsideDir, 'sentinel.toml');
        await writeFile(outsideConfig, 'OUTSIDE-CONFIG-SENTINEL\n');
        const configPath = getProjectMCPConfigPath(tempDir);
        await link(outsideConfig, configPath);
        const before = {
          config: await hashTree(codexDir),
          outside: await hashTree(outsideDir),
        };
        execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

        await expect(generateMCPConfig(tempDir)).rejects.toThrow('multiple hard links');

        expect(execSyncSpy).not.toHaveBeenCalled();
        expect(await hashTree(codexDir)).toBe(before.config);
        expect(await hashTree(outsideDir)).toBe(before.outside);
        expect(await readFile(outsideConfig, 'utf-8')).toBe('OUTSIDE-CONFIG-SENTINEL\n');
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects a .venv symlink before running uv or changing its outside target', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-mcp-venv-outside-'));
      try {
        await mkdir(join(tempDir, '.codex', 'ontology'), { recursive: true });
        await writeFile(join(outsideDir, 'sentinel.txt'), 'VENV-OUTSIDE-SENTINEL\n');
        const venvLink = join(tempDir, '.venv');
        await symlink(outsideDir, venvLink);
        execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

        await expect(generateMCPConfig(tempDir)).rejects.toThrow('symbolic link directory segment');

        expect(execSyncSpy).not.toHaveBeenCalled();
        expect(await readFile(join(outsideDir, 'sentinel.txt'), 'utf-8')).toBe(
          'VENV-OUTSIDE-SENTINEL\n'
        );
        expect((await lstat(venvLink)).isSymbolicLink()).toBe(true);
        expect(await Bun.file(getProjectMCPConfigPath(tempDir)).exists()).toBe(false);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects a nested .venv directory symlink atomically before running uv', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-mcp-nested-venv-outside-'));
      try {
        const codexDir = join(tempDir, '.codex');
        const venvDir = join(tempDir, '.venv');
        await mkdir(join(codexDir, 'ontology'), { recursive: true });
        await mkdir(venvDir);
        await writeFile(join(venvDir, 'sentinel.txt'), 'VENV-SENTINEL\n');
        await writeFile(join(outsideDir, 'sentinel.txt'), 'OUTSIDE-SENTINEL\n');
        await symlink(outsideDir, join(venvDir, 'bin'));

        const before = {
          config: await hashTree(codexDir),
          venv: await hashTree(venvDir),
          outside: await hashTree(outsideDir),
        };
        execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

        await expect(generateMCPConfig(tempDir)).rejects.toThrow('symbolic link escapes .venv');

        expect(execSyncSpy).not.toHaveBeenCalled();
        expect(await hashTree(codexDir)).toBe(before.config);
        expect(await hashTree(venvDir)).toBe(before.venv);
        expect(await hashTree(outsideDir)).toBe(before.outside);
        expect(await Bun.file(getProjectMCPConfigPath(tempDir)).exists()).toBe(false);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('allows standard internal and external-interpreter virtualenv symlinks', async () => {
      const interpreterDir = await mkdtemp(join(tmpdir(), 'omcodex-mcp-interpreter-'));
      try {
        await mkdir(join(tempDir, '.codex', 'ontology'), { recursive: true });
        const venvDir = join(tempDir, '.venv');
        await mkdir(join(venvDir, 'bin'), { recursive: true });
        await mkdir(join(venvDir, 'lib'));
        const interpreterPath = join(interpreterDir, 'python3.12');
        await writeFile(interpreterPath, '#!/usr/bin/env python3\n');
        await symlink(interpreterPath, join(venvDir, 'bin', 'python'));
        await symlink('python', join(venvDir, 'bin', 'python3'));
        await symlink('lib', join(venvDir, 'lib64'));
        execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

        await generateMCPConfig(tempDir);

        expect(execSyncSpy).toHaveBeenCalledTimes(4);
        expect(await Bun.file(getProjectMCPConfigPath(tempDir)).exists()).toBe(true);
      } finally {
        await rm(interpreterDir, { recursive: true, force: true });
      }
    });

    it('rejects special files inside .venv before running uv', async () => {
      await mkdir(join(tempDir, '.codex', 'ontology'), { recursive: true });
      const venvDir = join(tempDir, '.venv');
      await mkdir(venvDir);
      const fifoPath = join(venvDir, 'unsafe.fifo');
      const mkfifo = Bun.spawnSync(['mkfifo', fifoPath]);
      expect(mkfifo.exitCode).toBe(0);
      execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

      await expect(generateMCPConfig(tempDir)).rejects.toThrow('special files are not allowed');

      expect(execSyncSpy).not.toHaveBeenCalled();
      expect((await lstat(fifoPath)).isFIFO()).toBe(true);
      expect(await Bun.file(getProjectMCPConfigPath(tempDir)).exists()).toBe(false);
    });

    it('rejects hard-linked regular files inside .venv atomically before running uv', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'omcodex-mcp-hardlink-outside-'));
      try {
        const codexDir = join(tempDir, '.codex');
        const venvDir = join(tempDir, '.venv');
        await mkdir(join(codexDir, 'ontology'), { recursive: true });
        await mkdir(join(venvDir, 'bin'), { recursive: true });
        const outsideFile = join(outsideDir, 'activate');
        await writeFile(outsideFile, 'OUTSIDE-ACTIVATE-SENTINEL\n');
        await link(outsideFile, join(venvDir, 'bin', 'activate'));
        const before = {
          config: await hashTree(codexDir),
          venv: await hashTree(venvDir),
          outside: await hashTree(outsideDir),
        };
        execSyncSpy = spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

        await expect(generateMCPConfig(tempDir)).rejects.toThrow(
          'hard-linked files are not allowed'
        );

        expect(execSyncSpy).not.toHaveBeenCalled();
        expect(await hashTree(codexDir)).toBe(before.config);
        expect(await hashTree(venvDir)).toBe(before.venv);
        expect(await hashTree(outsideDir)).toBe(before.outside);
        expect(await readFile(outsideFile, 'utf-8')).toBe('OUTSIDE-ACTIVATE-SENTINEL\n');
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });
});
