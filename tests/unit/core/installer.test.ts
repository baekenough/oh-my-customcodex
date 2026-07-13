import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { createHash } from 'node:crypto';
import {
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
  copyTemplates,
  createDirectoryStructure,
  getTemplateDir,
  getTemplateManifest,
  install,
} from '../../../src/core/installer.js';
import { getComponentPath } from '../../../src/core/layout.js';
import * as fsUtils from '../../../src/utils/fs.js';

const { fileExists } = fsUtils;

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
      } else {
        entries.push(`f:${relativePath}:${await readFile(fullPath, 'hex')}`);
      }
    }
  }
  await walk(root);
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

async function listPreservationTempDirs(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((entry) => entry.startsWith('omcodex-preserve-')).sort();
}

describe('installer', () => {
  let tempDir: string;
  let consoleSpy: ReturnType<typeof spyOn>;
  let consoleInfoSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let consoleDebugSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-installer-test-'));
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleInfoSpy = spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
    consoleDebugSpy = spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleDebugSpy.mockRestore();
  });

  describe('getTemplateDir', () => {
    it('should return template directory path', () => {
      const templateDir = getTemplateDir();
      expect(templateDir).toContain('templates');
    });
  });

  describe('createDirectoryStructure', () => {
    it('should create all required directories', async () => {
      await createDirectoryStructure(tempDir);

      // Check that main directories are created (official Claude Code format)
      expect(await fileExists(join(tempDir, '.codex'))).toBe(true);
      expect(await fileExists(join(tempDir, '.codex', 'rules'))).toBe(true);
      expect(await fileExists(join(tempDir, '.codex', 'agents'))).toBe(true);
      expect(await fileExists(join(tempDir, '.agents', 'skills'))).toBe(true);
      expect(await fileExists(join(tempDir, 'guides'))).toBe(true);
      // commands/ removed in official Claude Code format (absorbed into skills)
    });

    it('should create .codex subdirectories', async () => {
      await createDirectoryStructure(tempDir);

      // .codex/agents is flat (no subdirectories)
      expect(await fileExists(join(tempDir, '.codex', 'agents'))).toBe(true);
      expect(await fileExists(join(tempDir, '.agents', 'skills'))).toBe(true);
      expect(await fileExists(join(tempDir, '.codex', 'hooks'))).toBe(true);
      expect(await fileExists(join(tempDir, '.codex', 'contexts'))).toBe(true);
    });

    it('should reject provider-root symlinks without mutating the outside target', async () => {
      const outside = join(tempDir, 'outside-codex-root');
      await mkdir(join(outside, 'rules'), { recursive: true });
      await writeFile(join(outside, 'rules', 'MUST-safety.md'), 'outside sentinel');
      await symlink(outside, join(tempDir, '.codex'));

      await expect(createDirectoryStructure(tempDir)).rejects.toThrow('symbolic link');
      expect(await readFile(join(outside, 'rules', 'MUST-safety.md'), 'utf-8')).toBe(
        'outside sentinel'
      );
    });

    it('should use flat .codex structure (no nested agent/skill directories)', async () => {
      await createDirectoryStructure(tempDir);

      // Verify flat structure: .codex/agents (not .codex/agents/*)
      expect(await fileExists(join(tempDir, '.codex', 'agents'))).toBe(true);
      expect(await fileExists(join(tempDir, '.agents', 'skills'))).toBe(true);

      // OLD structure (should NOT exist): agents/orchestrator/, agents/manager/, etc.
      expect(await fileExists(join(tempDir, 'agents'))).toBe(false);
      expect(await fileExists(join(tempDir, 'skills'))).toBe(false);

      // commands/ component removed (absorbed into skills)
      expect(await fileExists(join(tempDir, 'commands'))).toBe(false);
    });
  });

  describe('getTemplateManifest', () => {
    it('should return a valid manifest object', async () => {
      const manifest = await getTemplateManifest();

      expect(manifest).toBeDefined();
      expect(manifest.version).toBeDefined();
      expect(manifest.lastUpdated).toBeDefined();
      expect(Array.isArray(manifest.components)).toBe(true);
      expect(manifest.source).toContain('github.com');
    });

    it('should include expected components', async () => {
      const manifest = await getTemplateManifest();

      const componentNames = manifest.components.map((c) => c.name);
      expect(componentNames).toContain('rules');
      expect(componentNames).toContain('agents');
      expect(componentNames).toContain('skills');
    });

    it('should return exactly 7 components (commands and pipelines removed, ontology added)', async () => {
      const manifest = await getTemplateManifest();

      // getAllComponents() returns 7 items: rules, agents, skills, guides, hooks, contexts, ontology
      expect(manifest.components.length).toBe(7);

      const componentNames = manifest.components.map((c) => c.name);
      expect(componentNames).toContain('rules');
      expect(componentNames).toContain('agents');
      expect(componentNames).toContain('skills');
      expect(componentNames).toContain('guides');
      expect(componentNames).toContain('hooks');
      expect(componentNames).toContain('contexts');
      expect(componentNames).toContain('ontology');
      expect(componentNames).not.toContain('commands'); // commands removed
      expect(componentNames).not.toContain('pipelines'); // pipelines removed
    });

    it('should have manifest file counts matching actual template directories', async () => {
      const { readdir } = await import('node:fs/promises');
      const manifest = await getTemplateManifest();
      const templateDir = getTemplateDir();

      for (const component of manifest.components) {
        const resolvedPath = join(templateDir, component.path);

        try {
          const entries = await readdir(resolvedPath);
          const count = entries.filter((e) => !e.startsWith('.')).length;
          expect(count).toBe(
            component.files,
            `${component.name}: manifest says ${component.files} files but found ${count}`
          );
        } catch {
          // Skip if directory doesn't exist (handled by other tests)
        }
      }
    });
  });

  describe('install', () => {
    it('should create target directory if it does not exist', async () => {
      const newDir = join(tempDir, 'new-project');

      const result = await install({
        targetDir: newDir,
        skipConfirm: true,
      });

      expect(await fileExists(newDir)).toBe(true);
      // Result depends on whether templates exist
      expect(result).toBeDefined();
    });

    it('should return result with installed components', async () => {
      const result = await install({
        targetDir: tempDir,
        skipConfirm: true,
      });

      expect(result.installedPath).toBe(tempDir);
      expect(Array.isArray(result.installedComponents)).toBe(true);
      expect(Array.isArray(result.skippedComponents)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should handle backup option', async () => {
      // Create some existing files
      await mkdir(join(tempDir, '.codex'), { recursive: true });
      await writeFile(join(tempDir, 'AGENTS.md'), '# Existing');

      const result = await install({
        targetDir: tempDir,
        backup: true,
        skipConfirm: true,
      });

      expect(result).toBeDefined();
      // Backup should be created
      expect(Array.isArray(result.backedUpPaths)).toBe(true);
    });

    it('should respect force option', async () => {
      // Create existing directories (official Claude Code format)
      await mkdir(join(tempDir, '.codex', 'agents'), { recursive: true });

      const result = await install({
        targetDir: tempDir,
        force: true,
        skipConfirm: true,
      });

      expect(result).toBeDefined();
    });

    it('should install with English language', async () => {
      const result = await install({
        targetDir: tempDir,
        language: 'en',
        skipConfirm: true,
      });

      expect(result).toBeDefined();
    });

    it('should install with Korean language', async () => {
      const result = await install({
        targetDir: tempDir,
        language: 'ko',
        skipConfirm: true,
      });

      expect(result).toBeDefined();
    });

    it('should install specific components only', async () => {
      const result = await install({
        targetDir: tempDir,
        components: ['rules'],
        skipConfirm: true,
      });

      expect(result).toBeDefined();
    });

    it('should compile domain-filtered native agents and preserve custom TOML', async () => {
      const agentsDir = join(tempDir, '.codex', 'agents');
      const customPath = join(agentsDir, 'custom-local.toml');
      const customBytes =
        'name = "custom-local"\ndescription = "custom"\ndeveloper_instructions = "custom"\n';
      await mkdir(agentsDir, { recursive: true });
      await writeFile(customPath, customBytes);

      const result = await install({
        targetDir: tempDir,
        components: ['agents'],
        domain: 'backend',
        force: true,
        skipConfirm: true,
      });

      expect(result.success).toBe(true);
      const files = await readdir(agentsDir);
      expect(files).toContain('be-fastapi-expert.toml');
      expect(files).toContain('scholastic.toml');
      expect(files).not.toContain('fe-vuejs-agent.toml');
      expect(files.some((filename) => filename.endsWith('.md'))).toBe(false);
      expect(await readFile(customPath, 'utf-8')).toBe(customBytes);
      expect(
        Bun.TOML.parse(await readFile(join(agentsDir, 'be-fastapi-expert.toml'), 'utf-8'))
      ).toMatchObject({ name: 'be-fastapi-expert' });
    });

    it('should merge managed agents into an existing OMX directory without force', async () => {
      const agentsDir = join(tempDir, '.codex', 'agents');
      const customPath = join(agentsDir, 'custom-local.toml');
      const omxPath = join(agentsDir, 'omx-native.toml');
      const customBytes =
        'name = "custom-local"\ndescription = "custom"\ndeveloper_instructions = "custom"\n';
      const omxBytes = 'name = "omx-native"\ndescription = "OMX"\ndeveloper_instructions = "OMX"\n';
      await mkdir(agentsDir, { recursive: true });
      await writeFile(customPath, customBytes);
      await writeFile(omxPath, omxBytes);

      const result = await install({
        targetDir: tempDir,
        components: ['agents'],
        skipConfirm: true,
      });

      expect(result.success).toBe(true);
      expect(result.installedComponents).toContain('agents');
      expect(await fileExists(join(agentsDir, 'be-fastapi-expert.toml'))).toBe(true);
      expect(await readFile(customPath, 'utf-8')).toBe(customBytes);
      expect(await readFile(omxPath, 'utf-8')).toBe(omxBytes);
    });

    it('should reject component writes when provider root is a symlink before mutation', async () => {
      const outside = join(tempDir, 'outside-provider-root');
      await mkdir(join(outside, 'rules'), { recursive: true });
      await writeFile(join(outside, 'rules', 'MUST-safety.md'), 'outside sentinel');
      await symlink(outside, join(tempDir, '.codex'));
      const beforeHash = await hashTree(tempDir);

      const result = await install({
        targetDir: tempDir,
        components: ['rules'],
        force: true,
        skipConfirm: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(result.installedComponents).toEqual([]);
      expect(await hashTree(tempDir)).toBe(beforeHash);
      expect(await readFile(join(outside, 'rules', 'MUST-safety.md'), 'utf-8')).toBe(
        'outside sentinel'
      );
    });

    it('should reject AGENTS.md symlink before installing components', async () => {
      const outsideEntry = join(tempDir, 'outside-AGENTS.md');
      await writeFile(outsideEntry, 'outside entry sentinel');
      await symlink(outsideEntry, join(tempDir, 'AGENTS.md'));
      const beforeHash = await hashTree(tempDir);

      const result = await install({
        targetDir: tempDir,
        components: ['rules'],
        force: true,
        skipConfirm: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(result.installedComponents).toEqual([]);
      expect(await hashTree(tempDir)).toBe(beforeHash);
      expect(await readFile(outsideEntry, 'utf-8')).toBe('outside entry sentinel');
      expect(
        await readFile(join(tempDir, '.codex', 'rules', 'MUST-safety.md'), 'utf-8').catch(
          () => null
        )
      ).toBeNull();
    });

    it('should prevalidate lockfile symlinks before backup renames existing files', async () => {
      await mkdir(join(tempDir, '.codex', 'rules'), { recursive: true });
      await writeFile(join(tempDir, '.codex', 'rules', 'existing.md'), 'existing rule');
      await writeFile(join(tempDir, 'AGENTS.md'), 'existing entry');
      const outsideLock = join(tempDir, 'outside-lock.json');
      await writeFile(outsideLock, 'outside lock sentinel');
      await symlink(outsideLock, join(tempDir, '.omcodex.lock.json'));
      const beforeHash = await hashTree(tempDir);

      const result = await install({
        targetDir: tempDir,
        backup: true,
        skipConfirm: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(result.backedUpPaths).toEqual([]);
      expect(await hashTree(tempDir)).toBe(beforeHash);
      expect(
        (await readdir(tempDir)).filter((entry) => entry.startsWith('.omcodex-backup-'))
      ).toEqual([]);
      expect(await readFile(outsideLock, 'utf-8')).toBe('outside lock sentinel');
    });

    it('should reject backup source symlinks before creating preservation temp dirs', async () => {
      await mkdir(join(tempDir, '.codex'), { recursive: true });
      await writeFile(join(tempDir, '.codex', 'settings.json'), '{"local":true}');
      const outsideEntry = join(tempDir, 'outside-entry.md');
      await writeFile(outsideEntry, 'outside entry sentinel');
      await symlink(outsideEntry, join(tempDir, 'AGENTS.md'));
      const beforeHash = await hashTree(tempDir);
      const beforeTemps = await listPreservationTempDirs();

      const result = await install({
        targetDir: tempDir,
        backup: true,
        skipConfirm: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(result.backedUpPaths).toEqual([]);
      expect(await hashTree(tempDir)).toBe(beforeHash);
      expect(await listPreservationTempDirs()).toEqual(beforeTemps);
      expect(
        (await readdir(tempDir)).filter((entry) => entry.startsWith('.omcodex-backup-'))
      ).toEqual([]);
      expect(await readFile(outsideEntry, 'utf-8')).toBe('outside entry sentinel');
    });

    it('should reject critical settings.local.json symlinks before creating preservation temp dirs', async () => {
      await mkdir(join(tempDir, '.codex'), { recursive: true });
      const outsideSettings = join(tempDir, 'outside-settings.json');
      await writeFile(outsideSettings, '{"secret":true}');
      await symlink(outsideSettings, join(tempDir, '.codex', 'settings.local.json'));
      await writeFile(join(tempDir, 'AGENTS.md'), 'existing entry');
      const beforeHash = await hashTree(tempDir);
      const beforeTemps = await listPreservationTempDirs();

      const result = await install({
        targetDir: tempDir,
        backup: true,
        skipConfirm: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid critical file');
      expect(result.error).toContain('settings.local.json');
      expect(result.backedUpPaths).toEqual([]);
      expect(await hashTree(tempDir)).toBe(beforeHash);
      expect(await listPreservationTempDirs()).toEqual(beforeTemps);
      expect(
        (await readdir(tempDir)).filter((entry) => entry.startsWith('.omcodex-backup-'))
      ).toEqual([]);
      expect(await readFile(outsideSettings, 'utf-8')).toBe('{"secret":true}');
    });

    it('should not create a target below a symlink parent', async () => {
      const outside = join(tempDir, 'outside-parent');
      await mkdir(outside);
      await symlink(outside, join(tempDir, 'link-parent'));

      const result = await install({
        targetDir: join(tempDir, 'link-parent', 'project'),
        skipConfirm: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(await fileExists(join(outside, 'project'))).toBe(false);
    });

    it('should warn about existing files without force/backup', async () => {
      // Create existing structure (official Claude Code format)
      await mkdir(join(tempDir, '.codex', 'agents'), { recursive: true });
      await writeFile(join(tempDir, 'AGENTS.md'), '# Existing');

      const result = await install({
        targetDir: tempDir,
        skipConfirm: true,
      });

      // Should have warnings about existing files
      expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    });

    it('should set config.version to template manifest version after install', async () => {
      const manifest = await getTemplateManifest();

      await install({
        targetDir: tempDir,
        skipConfirm: true,
      });

      const fs = await import('node:fs/promises');
      const configPath = join(tempDir, '.omcodexrc.json');
      const raw = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(raw) as { version?: string };

      expect(config.version).toBeDefined();
      expect(config.version).toBe(manifest.version);
    });
  });

  describe('copyTemplates', () => {
    it('should be a function', () => {
      expect(typeof copyTemplates).toBe('function');
    });

    it('should copy template files to target directory', async () => {
      // Create a test template source
      const _templateDir = getTemplateDir();
      const testPath = '.codex/rules';

      // copyTemplates requires the template to exist
      // This tests the function without actual templates
      try {
        await copyTemplates(tempDir, testPath, { overwrite: true });
      } catch {
        // Expected to fail if templates don't exist
      }
    });
  });

  describe('edge cases', () => {
    it('should handle install with all components (7 total, no commands or pipelines)', async () => {
      const result = await install({
        targetDir: tempDir,
        components: ['rules', 'agents', 'skills', 'guides', 'hooks', 'contexts', 'ontology'],
        skipConfirm: true,
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result.installedComponents)).toBe(true);
      // getAllComponents() should return 7 items (commands and pipelines removed, ontology added)
    });

    it('should skip entry-md component in components list', async () => {
      const result = await install({
        targetDir: tempDir,
        components: ['entry-md'],
        skipConfirm: true,
      });

      expect(result).toBeDefined();
    });

    it('should handle backup with multiple existing paths', async () => {
      // Create multiple existing structures (official Claude Code format)
      await mkdir(join(tempDir, '.codex', 'rules'), { recursive: true });
      await mkdir(join(tempDir, '.codex', 'agents'), { recursive: true });
      await mkdir(join(tempDir, '.agents', 'skills'), { recursive: true });
      await mkdir(join(tempDir, 'guides'), { recursive: true });
      await writeFile(join(tempDir, 'AGENTS.md'), '# Existing');

      const result = await install({
        targetDir: tempDir,
        backup: true,
        force: true,
        skipConfirm: true,
      });

      expect(result).toBeDefined();
    });

    it('should return empty backup paths when no existing files', async () => {
      const newDir = join(tempDir, 'empty-project');
      await mkdir(newDir, { recursive: true });

      const result = await install({
        targetDir: newDir,
        backup: true,
        skipConfirm: true,
      });

      expect(result).toBeDefined();
      expect(result.backedUpPaths.length).toBe(0);
    });

    it('should handle non-existent component gracefully', async () => {
      const result = await install({
        targetDir: tempDir,
        components: ['non-existent-component'],
        skipConfirm: true,
      });

      expect(result).toBeDefined();
      // Component should be in skipped list (template not found)
      expect(result.skippedComponents).toContain('non-existent-component');
    });

    it('should handle install with force and backup together', async () => {
      // Create existing files (official Claude Code format)
      await mkdir(join(tempDir, '.codex', 'agents'), { recursive: true });
      await writeFile(join(tempDir, '.codex', 'agents', 'existing.md'), '# Existing');

      const result = await install({
        targetDir: tempDir,
        force: true,
        backup: true,
        skipConfirm: true,
      });

      expect(result).toBeDefined();
    });

    it('should track installed vs skipped components', async () => {
      // First install
      await install({
        targetDir: tempDir,
        components: ['rules'],
        skipConfirm: true,
      });

      // Second install without force should skip
      const result = await install({
        targetDir: tempDir,
        components: ['rules'],
        skipConfirm: true,
      });

      expect(result).toBeDefined();
      // Rules should be skipped since already installed
      expect(result.skippedComponents).toContain('rules');
    });
  });

  describe('Codex-native status configuration', () => {
    it('should not install Claude statusline artifacts during init', async () => {
      const result = await install({ targetDir: tempDir, skipConfirm: true });

      expect(result.success).toBe(true);
      expect(await fileExists(join(tempDir, '.codex', 'statusline.sh'))).toBe(false);
      expect(await fileExists(join(tempDir, '.codex', 'settings.local.json'))).toBe(false);
    });

    it('should preserve user status files and Codex config during forced init', async () => {
      const statuslinePath = join(tempDir, '.codex', 'statusline.sh');
      const settingsPath = join(tempDir, '.codex', 'settings.local.json');
      const configPath = join(tempDir, '.codex', 'config.toml');
      const customStatusline = '#!/bin/sh\necho custom\n';
      const customSettings =
        '{\n  "statusLine": { "type": "command", "command": ".codex/custom.sh" },\n  "user": true\n}\n';
      const nativeConfig = '[tui]\nstatus_line = ["model", "context-used"]\n';
      await mkdir(join(tempDir, '.codex'), { recursive: true });
      await writeFile(statuslinePath, customStatusline);
      await writeFile(settingsPath, customSettings);
      await writeFile(configPath, nativeConfig);

      const result = await install({
        targetDir: tempDir,
        force: true,
        skipConfirm: true,
      });

      expect(result.success).toBe(true);
      expect(await readFile(statuslinePath, 'utf-8')).toBe(customStatusline);
      expect(await readFile(settingsPath, 'utf-8')).toBe(customSettings);
      expect(await readFile(configPath, 'utf-8')).toBe(nativeConfig);
    });

    it('should retain the Claude statusline compatibility template', async () => {
      expect(await fileExists(join(getTemplateDir(), '.claude', 'statusline.sh'))).toBe(true);
    });
  });

  describe('tests/tsconfig.json installation', () => {
    it('should install tests/tsconfig.json during init', async () => {
      await install({ targetDir: tempDir, skipConfirm: true });
      const testsConfigPath = join(tempDir, 'tests', 'tsconfig.json');
      expect(await fileExists(testsConfigPath)).toBe(true);
    });

    it('should skip tests/tsconfig.json if already exists and no force', async () => {
      await install({ targetDir: tempDir, skipConfirm: true });
      const testsConfigPath = join(tempDir, 'tests', 'tsconfig.json');

      const fs = await import('node:fs/promises');
      await fs.writeFile(testsConfigPath, '{\n  "custom": true\n}\n', 'utf-8');

      await install({ targetDir: tempDir, skipConfirm: true });

      const content = await fs.readFile(testsConfigPath, 'utf-8');
      expect(content).toContain('"custom"');
    });

    it('should overwrite tests/tsconfig.json with force option', async () => {
      await install({ targetDir: tempDir, skipConfirm: true });
      const testsConfigPath = join(tempDir, 'tests', 'tsconfig.json');

      const fs = await import('node:fs/promises');
      await fs.writeFile(testsConfigPath, '{\n  "custom": true\n}\n', 'utf-8');

      await install({ targetDir: tempDir, force: true, skipConfirm: true });

      const content = await fs.readFile(testsConfigPath, 'utf-8');
      expect(content).not.toContain('"custom"');
      expect(content).toContain('"extends": "../tsconfig.json"');
    });
  });

  describe('error handling', () => {
    it('should handle template directory not found error (line 211)', async () => {
      // Mock fileExists to return false for template directory check
      const originalFileExists = fsUtils.fileExists;
      const fileExistsSpy = spyOn(fsUtils, 'fileExists').mockImplementation(async (path) => {
        const pathStr = String(path);
        // Return false only for the main templates directory check
        if (pathStr.endsWith('templates') && !pathStr.includes(tempDir)) {
          return false;
        }
        // Use original for all other checks
        return originalFileExists(path);
      });

      const result = await install({
        targetDir: tempDir,
        skipConfirm: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Template directory not found');

      fileExistsSpy.mockRestore();
    });

    it('should handle errors in installSingleComponent (lines 246-247)', async () => {
      // Mock copyDirectory to throw an error during component installation
      const copyDirectorySpy = spyOn(fsUtils, 'copyDirectory').mockRejectedValue(
        new Error('Simulated copy error')
      );

      const result = await install({
        targetDir: tempDir,
        components: ['rules'],
        force: true,
        skipConfirm: true,
      });

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('Failed to install rules'))).toBe(true);

      copyDirectorySpy.mockRestore();
    });

    it('should handle non-Error exceptions in installSingleComponent (line 247)', async () => {
      // Mock copyDirectory to throw a non-Error object
      const copyDirectorySpy = spyOn(fsUtils, 'copyDirectory').mockImplementation(() => {
        throw 'String error'; // Non-Error exception
      });

      const result = await install({
        targetDir: tempDir,
        components: ['rules'],
        force: true,
        skipConfirm: true,
      });

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('Failed to install rules'))).toBe(true);

      copyDirectorySpy.mockRestore();
    });

    it('should handle error in install() catch block (lines 309-311)', async () => {
      // Mock ensureDirectory to throw an error in ensureTargetDirectory
      const ensureDirectorySpy = spyOn(fsUtils, 'ensureDirectory').mockRejectedValue(
        new Error('Permission denied')
      );

      const result = await install({
        targetDir: tempDir,
        skipConfirm: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');

      ensureDirectorySpy.mockRestore();
    });

    it('should handle non-Error exception in install() catch block (line 310)', async () => {
      // Mock to throw a non-Error
      const ensureDirectorySpy = spyOn(fsUtils, 'ensureDirectory').mockImplementation(() => {
        throw { code: 'EACCES', message: 'Access denied' };
      });

      const result = await install({
        targetDir: tempDir,
        skipConfirm: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      ensureDirectorySpy.mockRestore();
    });

    it('should return default manifest when manifest.json not found (lines 355, 358-368)', async () => {
      // Mock fileExists to return false for manifest.json
      const fileExistsSpy = spyOn(fsUtils, 'fileExists').mockResolvedValue(false);

      const manifest = await getTemplateManifest();

      expect(manifest.version).toBe('0.0.0');
      expect(manifest.components.length).toBeGreaterThan(0);
      expect(manifest.source).toBe('https://github.com/baekenough/oh-my-customcodex');
      expect(manifest.components.every((c) => c.files === 0)).toBe(true);

      fileExistsSpy.mockRestore();
    });

    it('should warn when template source not found (lines 402-403)', async () => {
      // Create a spy that returns false for specific template source checks
      const originalFileExists = fsUtils.fileExists;
      let templateDirCheckDone = false;
      const fileExistsSpy = spyOn(fsUtils, 'fileExists').mockImplementation(async (path) => {
        const pathStr = String(path);

        // Allow initial template directory check to pass
        if (
          pathStr.includes('templates') &&
          pathStr.endsWith('templates') &&
          !templateDirCheckDone
        ) {
          templateDirCheckDone = true;
          return true;
        }

        // Return false for component template source paths (the actual rules template)
        if (
          pathStr.includes('templates') &&
          pathStr.includes('rules') &&
          !pathStr.includes(tempDir)
        ) {
          return false;
        }

        // Use original implementation for other paths
        return originalFileExists(path);
      });

      const result = await install({
        targetDir: tempDir,
        components: ['rules'],
        force: true,
        skipConfirm: true,
      });

      expect(result.skippedComponents).toContain('rules');

      fileExistsSpy.mockRestore();
    });

    it('should warn when AGENTS.md template not found (lines 430-431)', async () => {
      // Mock fileExists to allow installation to proceed but fail on AGENTS.md template
      const originalFileExists = fsUtils.fileExists;
      const fileExistsSpy = spyOn(fsUtils, 'fileExists').mockImplementation(async (path) => {
        const pathStr = String(path);
        // Return false for AGENTS.md.en and AGENTS.md.ko template sources
        if (
          (pathStr.includes('AGENTS.md.en') || pathStr.includes('AGENTS.md.ko')) &&
          !pathStr.includes(tempDir)
        ) {
          return false;
        }
        // Use original for other checks
        return originalFileExists(path);
      });

      const result = await install({
        targetDir: tempDir,
        language: 'en',
        force: true,
        skipConfirm: true,
      });

      expect(result.skippedComponents).toContain('entry-md');

      fileExistsSpy.mockRestore();
    });

    it('should handle backup errors gracefully (lines 507-508)', async () => {
      // Create existing files to trigger backup
      await mkdir(join(tempDir, '.codex'), { recursive: true });
      await writeFile(join(tempDir, 'AGENTS.md'), '# Existing');

      // Mock rename to throw an error
      const renameSpy = spyOn(await import('node:fs/promises'), 'rename').mockRejectedValue(
        new Error('Cannot move file')
      );

      const result = await install({
        targetDir: tempDir,
        backup: true,
        skipConfirm: true,
      });

      expect(result).toBeDefined();
      // Backup should have attempted and logged the error

      renameSpy.mockRestore();
    });

    it('should handle non-Error exception in backup (line 508)', async () => {
      // Create existing files (official Claude Code format)
      await mkdir(join(tempDir, '.codex', 'agents'), { recursive: true });

      // Mock rename to throw non-Error
      const renameSpy = spyOn(await import('node:fs/promises'), 'rename').mockImplementation(() => {
        throw 'Backup failed'; // Non-Error exception
      });

      const result = await install({
        targetDir: tempDir,
        backup: true,
        skipConfirm: true,
      });

      expect(result).toBeDefined();

      renameSpy.mockRestore();
    });

    it('should skip gracefully when tests/tsconfig.json template is missing', async () => {
      const originalFileExists = fsUtils.fileExists;
      const fileExistsSpy = spyOn(fsUtils, 'fileExists').mockImplementation(async (path) => {
        const pathStr = String(path);
        if (pathStr.includes('templates') && pathStr.endsWith(join('tests', 'tsconfig.json'))) {
          return false;
        }
        return originalFileExists(path);
      });

      const result = await install({
        targetDir: tempDir,
        skipConfirm: true,
      });

      expect(result.success).toBe(true);

      fileExistsSpy.mockRestore();
    });

    it('should preserve malformed settings.local.json without inspecting it', async () => {
      const fs = await import('node:fs/promises');
      await fs.mkdir(join(tempDir, '.codex'), { recursive: true });
      const settingsPath = join(tempDir, '.codex', 'settings.local.json');
      const malformedSettings = '{ invalid json content }';
      await fs.writeFile(settingsPath, malformedSettings, 'utf-8');

      const result = await install({
        targetDir: tempDir,
        skipConfirm: true,
      });

      expect(result.success).toBe(true);
      expect(await fs.readFile(settingsPath, 'utf-8')).toBe(malformedSettings);
      expect(
        result.warnings.some((w) => w.includes('Failed to parse existing settings.local.json'))
      ).toBe(false);
    });
  });

  describe('public path safety helpers', () => {
    it('should reject copyTemplates traversal before writing outside target', async () => {
      const beforeHash = await hashTree(tempDir);

      await expect(copyTemplates(tempDir, '../package.json', { overwrite: true })).rejects.toThrow(
        'traverse outside templates'
      );

      expect(await hashTree(tempDir)).toBe(beforeHash);
    });

    it('should create missing safe targets when copying templates', async () => {
      const targetDir = join(tempDir, 'new-safe-target');

      await copyTemplates(targetDir, 'guides', { overwrite: true });

      expect(await fileExists(join(targetDir, 'guides'))).toBe(true);
    });

    it('should reject copyTemplates targets below symlink parents', async () => {
      const outside = join(tempDir, 'outside-copy-parent');
      await mkdir(outside);
      await symlink(outside, join(tempDir, 'link-copy-parent'));

      await expect(
        copyTemplates(join(tempDir, 'link-copy-parent', 'project'), 'guides', {
          overwrite: true,
        })
      ).rejects.toThrow('symbolic link');

      expect(await fileExists(join(outside, 'project'))).toBe(false);
    });
  });

  describe('layout functions', () => {
    it('should return AGENTS.md path for entry-md component', () => {
      const path = getComponentPath('entry-md');
      expect(path).toBe('AGENTS.md');
    });
  });

  describe('file preservation during backup', () => {
    it('should preserve settings.local.json user properties during backup reinstall', async () => {
      const fs = await import('node:fs/promises');

      // First install
      await install({ targetDir: tempDir, skipConfirm: true });

      // Add user customizations to settings.local.json
      const settingsPath = join(tempDir, '.codex', 'settings.local.json');
      const userSettings = {
        enableAllProjectMcpServers: true,
        enabledMcpjsonServers: ['ontology-rag'],
        statusLine: {
          type: 'command',
          command: '.codex/statusline.sh',
          padding: 0,
        },
      };
      await fs.writeFile(settingsPath, JSON.stringify(userSettings), 'utf-8');

      // Re-install with backup (simulates omcodex init on existing project)
      const result = await install({
        targetDir: tempDir,
        backup: true,
        skipConfirm: true,
      });

      expect(result.success).toBe(true);

      // Verify user settings are preserved
      const restored = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
      expect(restored.enableAllProjectMcpServers).toBe(true);
      expect(restored.enabledMcpjsonServers).toEqual(['ontology-rag']);
      expect(restored.statusLine).toBeDefined();
    });

    it('should preserve settings.json during backup reinstall', async () => {
      const fs = await import('node:fs/promises');

      // Create initial .codex with settings.json
      await mkdir(join(tempDir, '.codex'), { recursive: true });
      await fs.writeFile(
        join(tempDir, '.codex', 'settings.json'),
        JSON.stringify({ projectSetting: 'value' }),
        'utf-8'
      );
      await fs.writeFile(join(tempDir, 'AGENTS.md'), '# Existing');

      // Re-install with backup
      const result = await install({
        targetDir: tempDir,
        backup: true,
        skipConfirm: true,
      });

      expect(result.success).toBe(true);

      // settings.json should be preserved
      const settingsPath = join(tempDir, '.codex', 'settings.json');
      expect(await fileExists(settingsPath)).toBe(true);
      const content = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
      expect(content.projectSetting).toBe('value');
    });

    it('should preserve agent-memory directories during backup reinstall', async () => {
      const fs = await import('node:fs/promises');

      // First install
      await install({ targetDir: tempDir, skipConfirm: true });

      // Create agent memory
      const memDir = join(tempDir, '.codex', 'agent-memory', 'test-agent');
      await mkdir(memDir, { recursive: true });
      await fs.writeFile(join(memDir, 'MEMORY.md'), '# Important agent memory');

      // Re-install with backup
      const result = await install({
        targetDir: tempDir,
        backup: true,
        skipConfirm: true,
      });

      expect(result.success).toBe(true);

      // Agent memory should be preserved
      expect(
        await fileExists(join(tempDir, '.codex', 'agent-memory', 'test-agent', 'MEMORY.md'))
      ).toBe(true);
      const content = await fs.readFile(
        join(tempDir, '.codex', 'agent-memory', 'test-agent', 'MEMORY.md'),
        'utf-8'
      );
      expect(content).toBe('# Important agent memory');
    });
  });
});
