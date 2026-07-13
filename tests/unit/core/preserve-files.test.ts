import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CustomComponentConfig,
  getDefaultConfig,
  mergeConfig,
  type OmccConfig,
  saveConfig,
} from '../../../src/core/config.js';
import { getProviderLayout } from '../../../src/core/layout.js';
import { update } from '../../../src/core/updater.js';
import { copyDirectory, fileExists, validatePreserveFilePath } from '../../../src/utils/fs.js';

describe('preserveFiles feature', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-preserve-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // Helper to create config file
  async function createConfig(overrides?: Partial<OmccConfig>): Promise<void> {
    const config = getDefaultConfig();
    config.version = '0.1.0';
    config.installedAt = '2025-01-01T00:00:00Z';
    if (overrides) {
      Object.assign(config, overrides);
    }
    await saveConfig(tempDir, config);
  }

  // Helper to create directory structure
  async function createDirStructure(structure: Record<string, string>): Promise<void> {
    for (const [path, content] of Object.entries(structure)) {
      const fullPath = join(tempDir, path);
      await mkdir(join(fullPath, '..'), { recursive: true });
      await writeFile(fullPath, content);
    }
  }

  describe('config integration', () => {
    it('should include preserveFiles in default config', () => {
      const config = getDefaultConfig();

      expect(config.preserveFiles).toBeDefined();
      expect(Array.isArray(config.preserveFiles)).toBe(true);
      expect(config.preserveFiles?.length).toBe(4);
    });

    it('should include customComponents in default config', () => {
      const config = getDefaultConfig();

      expect(config.customComponents).toBeDefined();
      expect(Array.isArray(config.customComponents)).toBe(true);
      expect(config.customComponents?.length).toBe(0);
    });

    it('should merge preserveFiles arrays during config merge', () => {
      const defaults = getDefaultConfig();
      defaults.preserveFiles = ['file1.txt', 'file2.txt'];

      const overrides: Partial<OmccConfig> = {
        preserveFiles: ['file3.txt', 'file4.txt'],
      };

      const merged = mergeConfig(defaults, overrides);

      expect(merged.preserveFiles).toContain('file1.txt');
      expect(merged.preserveFiles).toContain('file2.txt');
      expect(merged.preserveFiles).toContain('file3.txt');
      expect(merged.preserveFiles).toContain('file4.txt');
      expect(merged.preserveFiles?.length).toBe(4);
    });

    it('should deduplicate preserveFiles on merge', () => {
      const defaults = getDefaultConfig();
      defaults.preserveFiles = ['file1.txt', 'file2.txt'];

      const overrides: Partial<OmccConfig> = {
        preserveFiles: ['file2.txt', 'file3.txt'], // file2.txt is duplicate
      };

      const merged = mergeConfig(defaults, overrides);

      expect(merged.preserveFiles?.length).toBe(3);
      expect(merged.preserveFiles).toContain('file1.txt');
      expect(merged.preserveFiles).toContain('file2.txt');
      expect(merged.preserveFiles).toContain('file3.txt');
    });

    it('should merge customComponents arrays during config merge', () => {
      const defaults = getDefaultConfig();
      defaults.customComponents = [
        { type: 'agent', name: 'agent1', path: '.codex/agents/agent1.md', managed: false },
      ];

      const overrides: Partial<OmccConfig> = {
        customComponents: [
          { type: 'skill', name: 'skill1', path: '.agents/skills/skill1/', managed: false },
        ],
      };

      const merged = mergeConfig(defaults, overrides);

      expect(merged.customComponents?.length).toBe(2);
      expect(merged.customComponents?.[0].name).toBe('agent1');
      expect(merged.customComponents?.[1].name).toBe('skill1');
    });

    it('should deduplicate customComponents by path on merge', () => {
      const defaults = getDefaultConfig();
      defaults.customComponents = [
        { type: 'agent', name: 'agent1', path: '.codex/agents/agent1.md', managed: false },
      ];

      const overrides: Partial<OmccConfig> = {
        customComponents: [
          {
            type: 'agent',
            name: 'agent1-updated',
            path: '.codex/agents/agent1.md',
            managed: false,
          },
          { type: 'skill', name: 'skill1', path: '.agents/skills/skill1/', managed: false },
        ],
      };

      const merged = mergeConfig(defaults, overrides);

      // Should have 2 entries (agent1 deduped by path, skill1 new)
      expect(merged.customComponents?.length).toBe(2);
      // Override should win for duplicated path
      expect(merged.customComponents?.find((c) => c.path === '.codex/agents/agent1.md')?.name).toBe(
        'agent1-updated'
      );
      expect(merged.customComponents?.find((c) => c.path === '.agents/skills/skill1/')?.name).toBe(
        'skill1'
      );
    });

    it('should handle empty preserveFiles in overrides', () => {
      const defaults = getDefaultConfig();
      defaults.preserveFiles = ['file1.txt'];

      const overrides: Partial<OmccConfig> = {
        // preserveFiles not specified
      };

      const merged = mergeConfig(defaults, overrides);

      expect(merged.preserveFiles).toEqual(['file1.txt']);
    });

    it('should handle undefined preserveFiles in defaults', () => {
      const defaults = getDefaultConfig();
      delete defaults.preserveFiles;

      const overrides: Partial<OmccConfig> = {
        preserveFiles: ['file1.txt'],
      };

      const merged = mergeConfig(defaults, overrides);

      expect(merged.preserveFiles).toEqual(['file1.txt']);
    });
  });

  describe('update with preserveFiles', () => {
    it('should preserve files listed in .omcodexrc.json preserveFiles', async () => {
      await createConfig({
        preserveFiles: ['.codex/rules/custom-rule.md'],
      });

      // Create custom file to preserve
      await createDirStructure({
        '.codex/rules/custom-rule.md': 'Custom rule content',
      });

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        provider: 'codex',
        components: ['rules'],
      });

      expect(result.success).toBe(true);

      // Verify custom file was preserved
      const customFilePath = join(tempDir, '.codex/rules/custom-rule.md');
      const exists = await fileExists(customFilePath);
      expect(exists).toBe(true);

      const content = await readFile(customFilePath, 'utf-8');
      expect(content).toBe('Custom rule content');
    });

    it('should preserve files from both .omcodexrc.json and .omcodex-customizations.json', async () => {
      await createConfig({
        preserveFiles: ['.codex/rules/from-config.md'],
      });

      // Create files to preserve
      await createDirStructure({
        '.codex/rules/from-config.md': 'From config',
        '.codex/rules/from-manifest.md': 'From manifest',
        '.omcodex-customizations.json': JSON.stringify({
          modifiedFiles: [],
          preserveFiles: ['.codex/rules/from-manifest.md'],
          customComponents: [],
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      });

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        provider: 'codex',
        components: ['rules'],
      });

      expect(result.success).toBe(true);

      // Verify both files were preserved
      const configFilePath = join(tempDir, '.codex/rules/from-config.md');
      const manifestFilePath = join(tempDir, '.codex/rules/from-manifest.md');

      expect(await fileExists(configFilePath)).toBe(true);
      expect(await fileExists(manifestFilePath)).toBe(true);

      expect(await readFile(configFilePath, 'utf-8')).toBe('From config');
      expect(await readFile(manifestFilePath, 'utf-8')).toBe('From manifest');
    });

    it('should handle directory preservation (trailing /)', async () => {
      await createConfig({
        preserveFiles: ['.codex/rules/custom/'],
      });

      // Create custom directory to preserve
      await createDirStructure({
        '.codex/rules/custom/file1.md': 'Custom file 1',
        '.codex/rules/custom/file2.md': 'Custom file 2',
      });

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        provider: 'codex',
        components: ['rules'],
      });

      expect(result.success).toBe(true);

      // Verify directory was preserved
      const file1Path = join(tempDir, '.codex/rules/custom/file1.md');
      const file2Path = join(tempDir, '.codex/rules/custom/file2.md');

      expect(await fileExists(file1Path)).toBe(true);
      expect(await fileExists(file2Path)).toBe(true);
    });

    it('should preserve custom components with managed: false', async () => {
      const customComponents: CustomComponentConfig[] = [
        {
          type: 'agent',
          name: 'custom-agent',
          path: '.codex/agents/custom-agent.md',
          managed: false,
        },
      ];

      await createConfig({ customComponents });

      // Create custom agent file
      await createDirStructure({
        '.codex/agents/custom-agent.md': 'Custom agent content',
      });

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        provider: 'codex',
        components: ['agents'],
      });

      expect(result.success).toBe(true);

      // Verify custom agent was preserved
      const customAgentPath = join(tempDir, '.codex/agents/custom-agent.md');
      expect(await fileExists(customAgentPath)).toBe(true);

      const content = await readFile(customAgentPath, 'utf-8');
      expect(content).toBe('Custom agent content');
    });

    it('should skip copy for managed:false component paths', async () => {
      const customComponents: CustomComponentConfig[] = [
        {
          type: 'skill',
          name: 'custom-skill',
          path: '.agents/skills/custom-skill/',
          managed: false,
        },
      ];

      await createConfig({ customComponents });

      // Create custom skill directory
      await createDirStructure({
        '.agents/skills/custom-skill/SKILL.md': 'Custom skill',
        '.agents/skills/custom-skill/script.sh': 'Custom script',
      });

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        provider: 'codex',
        components: ['skills'],
      });

      expect(result.success).toBe(true);

      // Verify custom skill directory was preserved
      const skillPath = join(tempDir, '.agents/skills/custom-skill/SKILL.md');
      const scriptPath = join(tempDir, '.agents/skills/custom-skill/script.sh');

      expect(await fileExists(skillPath)).toBe(true);
      expect(await fileExists(scriptPath)).toBe(true);

      expect(await readFile(skillPath, 'utf-8')).toBe('Custom skill');
      expect(await readFile(scriptPath, 'utf-8')).toBe('Custom script');
    });

    it('should handle preserveCustomizations:false option', async () => {
      await createConfig({
        preserveFiles: ['.codex/rules/custom.md'],
      });

      await createDirStructure({
        '.codex/rules/custom.md': 'Custom content',
      });

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        provider: 'codex',
        components: ['rules'],
        preserveCustomizations: false,
      });

      expect(result.success).toBe(true);
      // preserveCustomizations:false skips manifest, but still respects config.preserveFiles
      expect(result.preservedFiles.length).toBe(1);
      expect(result.preservedFiles).toContain('.codex/rules/custom.md');
    });
  });

  describe('path traversal validation', () => {
    it('should reject path traversal attempts (../../)', () => {
      const result = validatePreserveFilePath('../../etc/passwd', tempDir);

      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('outside project root');
    });

    it('should reject path traversal with more segments', () => {
      const result = validatePreserveFilePath('../other-project/.env', tempDir);

      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should reject absolute paths', () => {
      const result = validatePreserveFilePath('/absolute/path', tempDir);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Absolute paths');
    });

    it('should normalize and accept safe paths with ..', () => {
      const result = validatePreserveFilePath('./foo/../bar', tempDir);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should accept valid relative paths', () => {
      const result = validatePreserveFilePath('.codex/rules/custom.md', tempDir);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should accept directory paths', () => {
      const result = validatePreserveFilePath('.agents/skills/my-skill/', tempDir);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject empty strings', () => {
      const result = validatePreserveFilePath('', tempDir);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('empty');
    });

    it('should reject whitespace-only strings', () => {
      const result = validatePreserveFilePath('   ', tempDir);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('empty');
    });

    it('should validate complex traversal attempts', () => {
      // Try various sneaky paths
      const maliciousPaths = [
        '../../..',
        './../../../etc/passwd',
        'foo/../../..',
        './.././../sensitive',
      ];

      for (const path of maliciousPaths) {
        const result = validatePreserveFilePath(path, tempDir);
        expect(result.valid).toBe(false);
      }
    });

    it('should accept deeply nested valid paths', () => {
      const result = validatePreserveFilePath(
        '.agents/skills/my-skill/deeply/nested/file.md',
        tempDir
      );

      expect(result.valid).toBe(true);
    });
  });

  describe('copyDirectory with skipPaths', () => {
    let srcDir: string;
    let destDir: string;

    beforeEach(async () => {
      srcDir = join(tempDir, 'src');
      destDir = join(tempDir, 'dest');
      await mkdir(srcDir, { recursive: true });
      await mkdir(destDir, { recursive: true });
    });

    it('should skip files matching skipPaths', async () => {
      // Create source structure
      await writeFile(join(srcDir, 'keep.txt'), 'keep this');
      await writeFile(join(srcDir, 'skip.txt'), 'skip this');

      // Copy with skipPaths
      await copyDirectory(srcDir, destDir, {
        skipPaths: ['skip.txt'],
      });

      // Verify
      expect(await fileExists(join(destDir, 'keep.txt'))).toBe(true);
      expect(await fileExists(join(destDir, 'skip.txt'))).toBe(false);
    });

    it('should skip directories matching skipPaths (trailing /)', async () => {
      // Create source structure
      await mkdir(join(srcDir, 'keep-dir'), { recursive: true });
      await mkdir(join(srcDir, 'skip-dir'), { recursive: true });
      await writeFile(join(srcDir, 'keep-dir/file.txt'), 'keep');
      await writeFile(join(srcDir, 'skip-dir/file.txt'), 'skip');

      // Copy with skipPaths
      await copyDirectory(srcDir, destDir, {
        skipPaths: ['skip-dir/'],
      });

      // Verify
      expect(await fileExists(join(destDir, 'keep-dir/file.txt'))).toBe(true);
      expect(await fileExists(join(destDir, 'skip-dir/file.txt'))).toBe(false);
      expect(await fileExists(join(destDir, 'skip-dir'))).toBe(false);
    });

    it('should not skip when skipPaths is empty', async () => {
      // Create source structure
      await writeFile(join(srcDir, 'file1.txt'), 'content1');
      await writeFile(join(srcDir, 'file2.txt'), 'content2');

      // Copy with empty skipPaths
      await copyDirectory(srcDir, destDir, {
        skipPaths: [],
      });

      // Verify all files copied
      expect(await fileExists(join(destDir, 'file1.txt'))).toBe(true);
      expect(await fileExists(join(destDir, 'file2.txt'))).toBe(true);
    });

    it('should preserve nested skipPaths relative to the destination root', async () => {
      // Create nested source structure
      await mkdir(join(srcDir, 'dir1'), { recursive: true });
      await writeFile(join(srcDir, 'dir1/keep.txt'), 'keep');
      await writeFile(join(srcDir, 'dir1/skip.txt'), 'skip this');

      await copyDirectory(srcDir, destDir, {
        skipPaths: ['dir1/skip.txt'],
      });

      expect(await fileExists(join(destDir, 'dir1/keep.txt'))).toBe(true);
      expect(await fileExists(join(destDir, 'dir1/skip.txt'))).toBe(false);

      // What DOES work: skip the entire directory
      await rm(destDir, { recursive: true });
      await mkdir(destDir, { recursive: true });

      await copyDirectory(srcDir, destDir, {
        skipPaths: ['dir1/'], // Skip entire directory
      });

      expect(await fileExists(join(destDir, 'dir1'))).toBe(false);
    });

    it('should handle skipPaths with no matches', async () => {
      // Create source structure
      await writeFile(join(srcDir, 'file.txt'), 'content');

      // Copy with non-matching skipPaths
      await copyDirectory(srcDir, destDir, {
        skipPaths: ['nonexistent.txt'],
      });

      // Verify file was copied
      expect(await fileExists(join(destDir, 'file.txt'))).toBe(true);
    });

    it('should skip entire directory tree with trailing /', async () => {
      // Create nested source structure
      await mkdir(join(srcDir, 'skip/deep/nested'), { recursive: true });
      await writeFile(join(srcDir, 'skip/file1.txt'), 'skip1');
      await writeFile(join(srcDir, 'skip/deep/file2.txt'), 'skip2');
      await writeFile(join(srcDir, 'skip/deep/nested/file3.txt'), 'skip3');
      await writeFile(join(srcDir, 'keep.txt'), 'keep');

      // Copy with directory skipPath
      await copyDirectory(srcDir, destDir, {
        skipPaths: ['skip/'],
      });

      // Verify entire directory was skipped
      expect(await fileExists(join(destDir, 'keep.txt'))).toBe(true);
      expect(await fileExists(join(destDir, 'skip'))).toBe(false);
      expect(await fileExists(join(destDir, 'skip/file1.txt'))).toBe(false);
      expect(await fileExists(join(destDir, 'skip/deep/file2.txt'))).toBe(false);
    });

    it('should handle undefined skipPaths', async () => {
      // Create source structure
      await writeFile(join(srcDir, 'file.txt'), 'content');

      // Copy without skipPaths option
      await copyDirectory(srcDir, destDir);

      // Verify file was copied
      expect(await fileExists(join(destDir, 'file.txt'))).toBe(true);
    });
  });
});
