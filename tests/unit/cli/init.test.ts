import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../../../src/core/installer.js';

describe('init command', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-init-test-'));
  });

  afterEach(async () => {
    // Clean up temporary directory
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('basic initialization', () => {
    it('should create AGENTS.md in target directory', async () => {
      const result = await install({
        targetDir: tempDir,
        language: 'en',
      });

      expect(result.success).toBe(true);

      // Verify AGENTS.md exists
      const claudeMdPath = join(tempDir, 'AGENTS.md');
      const claudeMdStats = await stat(claudeMdPath);
      expect(claudeMdStats.isFile()).toBe(true);

      // Verify content has correct structure (English template)
      const content = await readFile(claudeMdPath, 'utf-8');
      expect(content).toContain('AI Agent System');
      expect(content).toContain('oh-my-customcodex');
    });

    it('should create .codex directory structure', async () => {
      const result = await install({
        targetDir: tempDir,
        language: 'en',
      });

      expect(result.success).toBe(true);

      // Verify .codex directory exists
      const claudeDir = join(tempDir, '.codex');
      const claudeDirStats = await stat(claudeDir);
      expect(claudeDirStats.isDirectory()).toBe(true);

      // Verify .codex/rules/ exists
      const rulesDir = join(tempDir, '.codex', 'rules');
      const rulesDirStats = await stat(rulesDir);
      expect(rulesDirStats.isDirectory()).toBe(true);

      // Verify .codex/hooks/ exists
      const hooksDir = join(tempDir, '.codex', 'hooks');
      const hooksDirStats = await stat(hooksDir);
      expect(hooksDirStats.isDirectory()).toBe(true);

      // Verify .codex/contexts/ exists
      const contextsDir = join(tempDir, '.codex', 'contexts');
      const contextsDirStats = await stat(contextsDir);
      expect(contextsDirStats.isDirectory()).toBe(true);
    });

    it('should create agents directory structure', async () => {
      const result = await install({
        targetDir: tempDir,
        language: 'en',
      });

      expect(result.success).toBe(true);

      // Verify agents directory exists (official Codex-native format: .codex/agents)
      const agentsDir = join(tempDir, '.codex', 'agents');
      const agentsDirStats = await stat(agentsDir);
      expect(agentsDirStats.isDirectory()).toBe(true);
    });

    it('should create skills directory structure', async () => {
      const result = await install({
        targetDir: tempDir,
        language: 'en',
      });

      expect(result.success).toBe(true);

      // Verify skills directory exists (official Codex-native format: .agents/skills)
      const skillsDir = join(tempDir, '.agents', 'skills');
      const skillsDirStats = await stat(skillsDir);
      expect(skillsDirStats.isDirectory()).toBe(true);
    });

    it('should install skills-sh-search skill', async () => {
      const result = await install({
        targetDir: tempDir,
        language: 'en',
      });

      expect(result.success).toBe(true);

      // Verify skills-sh-search skill is installed with valid SKILL.md
      const skillMdPath = join(tempDir, '.agents', 'skills', 'skills-sh-search', 'SKILL.md');
      const skillMdStats = await stat(skillMdPath);
      expect(skillMdStats.isFile()).toBe(true);

      const { readFile } = await import('node:fs/promises');
      const content = await readFile(skillMdPath, 'utf-8');
      expect(content).toContain('name: skills-sh-search');
      expect(content).toContain('skills.sh');
    });

    it('should create guides directory', async () => {
      const result = await install({
        targetDir: tempDir,
        language: 'en',
      });

      expect(result.success).toBe(true);

      // Verify guides directory exists
      const guidesDir = join(tempDir, 'guides');
      const guidesDirStats = await stat(guidesDir);
      expect(guidesDirStats.isDirectory()).toBe(true);
    });

    // commands/ removed in official Codex-native format (absorbed into skills)
  });

  describe('--lang option', () => {
    it('should create English AGENTS.md when lang is en', async () => {
      const result = await install({
        targetDir: tempDir,
        language: 'en',
      });

      expect(result.success).toBe(true);

      const claudeMdPath = join(tempDir, 'AGENTS.md');
      const content = await readFile(claudeMdPath, 'utf-8');

      // English version should contain English text
      expect(content).toContain('AI Agent System');
      expect(content).toContain('STOP AND READ BEFORE EVERY RESPONSE');
      // Should NOT contain Korean text
      expect(content).not.toContain('AI 에이전트 시스템');
    });

    it('should create Korean AGENTS.md when lang is ko', async () => {
      const result = await install({
        targetDir: tempDir,
        language: 'ko',
      });

      expect(result.success).toBe(true);

      const claudeMdPath = join(tempDir, 'AGENTS.md');
      const content = await readFile(claudeMdPath, 'utf-8');

      // Korean version should contain Korean text
      expect(content).toContain('AI 에이전트 시스템');
      expect(content).toContain('모든 응답 전 반드시 확인');
      // Should NOT contain English header
      expect(content).not.toContain('# AI Agent System');
    });
  });

  describe('--force option', () => {
    it('should overwrite existing AGENTS.md when force is true', async () => {
      // Create existing AGENTS.md with different content
      const existingContent = '# Existing AGENTS.md\n\nThis is existing content.';
      const claudeMdPath = join(tempDir, 'AGENTS.md');
      await writeFile(claudeMdPath, existingContent);

      // Install with force=true
      const result = await install({
        targetDir: tempDir,
        language: 'en',
        force: true,
      });

      expect(result.success).toBe(true);

      // Verify AGENTS.md was overwritten
      const content = await readFile(claudeMdPath, 'utf-8');
      expect(content).toContain('AI Agent System');
      expect(content).not.toContain('This is existing content');
    });

    it('should overwrite existing .codex directory when force is true', async () => {
      // Create existing .codex directory with a custom file
      const claudeDir = join(tempDir, '.codex');
      const rulesDir = join(claudeDir, 'rules');
      await import('node:fs/promises').then((fs) => fs.mkdir(rulesDir, { recursive: true }));
      const customRulePath = join(rulesDir, 'CUSTOM-rule.md');
      await writeFile(customRulePath, '# Custom Rule');

      // Install with force=true
      const result = await install({
        targetDir: tempDir,
        language: 'en',
        force: true,
      });

      expect(result.success).toBe(true);

      // Verify .codex directory exists and has template files
      const ruleFiles = await readdir(rulesDir);
      // Should have standard rule files from templates
      expect(ruleFiles.length).toBeGreaterThan(0);
    });
  });

  describe('without --force option', () => {
    it('should not overwrite existing AGENTS.md without force flag', async () => {
      // Create existing AGENTS.md
      const existingContent = '# Existing AGENTS.md\n\nThis is existing content.';
      const claudeMdPath = join(tempDir, 'AGENTS.md');
      await writeFile(claudeMdPath, existingContent);

      // Install without force
      const result = await install({
        targetDir: tempDir,
        language: 'en',
        force: false,
        backup: false,
      });

      // Should succeed but with warnings
      expect(result.success).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Existing files found');

      // Verify AGENTS.md was NOT overwritten
      const content = await readFile(claudeMdPath, 'utf-8');
      expect(content).toContain('This is existing content');
      expect(content).not.toContain('AI Agent System');
    });

    it('should skip existing directories without force flag', async () => {
      // Create existing .codex directory with custom content
      const claudeDir = join(tempDir, '.codex');
      const rulesDir = join(claudeDir, 'rules');
      await import('node:fs/promises').then((fs) => fs.mkdir(rulesDir, { recursive: true }));
      const customRulePath = join(rulesDir, 'CUSTOM-rule.md');
      const customContent = '# My Custom Rule';
      await writeFile(customRulePath, customContent);

      // Install without force
      const result = await install({
        targetDir: tempDir,
        language: 'en',
        force: false,
        backup: false,
      });

      expect(result.success).toBe(true);

      // Verify custom file is preserved (not overwritten)
      const content = await readFile(customRulePath, 'utf-8');
      expect(content).toBe(customContent);
    });

    it('should add warning when existing files are found', async () => {
      // Create existing AGENTS.md
      const claudeMdPath = join(tempDir, 'AGENTS.md');
      await writeFile(claudeMdPath, '# Existing');

      // Install without force
      const result = await install({
        targetDir: tempDir,
        language: 'en',
        force: false,
        backup: false,
      });

      // Check warnings
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('AGENTS.md'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('--force'))).toBe(true);
    });
  });

  describe('--backup option', () => {
    it('should backup existing files when backup is true', async () => {
      // Create existing AGENTS.md
      const existingContent = '# Existing AGENTS.md';
      const claudeMdPath = join(tempDir, 'AGENTS.md');
      await writeFile(claudeMdPath, existingContent);

      // Install with backup=true
      const result = await install({
        targetDir: tempDir,
        language: 'en',
        backup: true,
      });

      expect(result.success).toBe(true);
      expect(result.backedUpPaths.length).toBeGreaterThan(0);

      // Verify backup directory was created
      const entries = await readdir(tempDir);
      const backupDir = entries.find((e) => e.startsWith('.codex-backup-'));
      expect(backupDir).toBeDefined();

      // Verify AGENTS.md was overwritten with new content
      const content = await readFile(claudeMdPath, 'utf-8');
      expect(content).toContain('AI Agent System');
    });
  });

  describe('installedComponents tracking', () => {
    it('should track installed entry-md component', async () => {
      const result = await install({
        targetDir: tempDir,
        language: 'en',
      });

      expect(result.success).toBe(true);
      // AGENTS.md should always be installed in a fresh directory
      expect(result.installedComponents).toContain('entry-md');
    });

    it('should track skipped components when they already exist', async () => {
      // Create existing AGENTS.md
      const claudeMdPath = join(tempDir, 'AGENTS.md');
      await writeFile(claudeMdPath, '# Existing');

      const result = await install({
        targetDir: tempDir,
        language: 'en',
        force: false,
        backup: false,
      });

      expect(result.success).toBe(true);
      expect(result.skippedComponents).toContain('entry-md');
    });

    it('should install components with force=true even when directories exist', async () => {
      // First install creates the directory structure
      await install({ targetDir: tempDir, language: 'en' });

      // Second install with force should re-install all components
      const result = await install({
        targetDir: tempDir,
        language: 'en',
        force: true,
      });

      expect(result.success).toBe(true);
      // With force, all components should be in installedComponents
      expect(result.installedComponents).toContain('entry-md');
      expect(result.installedComponents).toContain('rules');
      expect(result.installedComponents).toContain('agents');
    });
  });
});
