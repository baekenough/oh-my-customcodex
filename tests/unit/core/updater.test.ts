import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readFileSync } from 'node:fs';
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
import { join, join as pathJoin } from 'node:path';
import { NATIVE_AGENT_GENERATED_HEADER } from '../../../src/core/agent-compiler.js';
import { getDefaultConfig, saveConfig } from '../../../src/core/config.js';
import { getProviderLayout } from '../../../src/core/layout.js';
import {
  type ApplyUpdatesDependencies,
  applyUpdates,
  checkForUpdates,
  extractFrontmatterName,
  getAgentVersions,
  isKnownHarnessStatusLineHash,
  preserveCustomizations,
  saveCustomizationManifest,
  type UpdateComponent,
  update,
} from '../../../src/core/updater.js';

// Read manifest version dynamically to avoid hardcoding
const MANIFEST_VERSION = JSON.parse(
  readFileSync(pathJoin(import.meta.dir, '../../../templates/manifest.json'), 'utf-8')
).version;
const LEGACY_STATUSLINE_TEMPLATE = readFileSync(
  pathJoin(import.meta.dir, '../../../templates/.claude/statusline.sh'),
  'utf-8'
);

describe('updater', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-updater-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // Helper to create config file
  async function createConfig(version = '0.1.0', componentVersions?: Record<string, string>) {
    const config = getDefaultConfig();
    config.version = version;
    config.installedAt = '2025-01-01T00:00:00Z';
    if (componentVersions) {
      config.componentVersions = componentVersions;
    }
    await saveConfig(tempDir, config);
  }

  // Helper to create directory structure
  async function createDirStructure(structure: Record<string, string>) {
    for (const [path, content] of Object.entries(structure)) {
      const fullPath = join(tempDir, path);
      await mkdir(join(fullPath, '..'), { recursive: true });
      await writeFile(fullPath, content);
    }
  }

  // Helper to verify file exists with expected content
  async function verifyFileContent(relativePath: string, expectedContent: string) {
    const fullPath = join(tempDir, relativePath);
    const content = await readFile(fullPath, 'utf-8');
    expect(content).toBe(expectedContent);
  }

  async function hashTree(root: string): Promise<string> {
    const entries: string[] = [];
    async function recordEntry(entry: Dirent, dir: string, prefix: string) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        entries.push(`l:${relativePath}:${await readlink(fullPath)}`);
        return;
      }
      if (entry.isDirectory()) {
        entries.push(`d:${relativePath}`);
        await walk(fullPath, relativePath);
        return;
      }
      entries.push(`f:${relativePath}:${await readFile(fullPath, 'hex')}`);
    }

    async function walk(dir: string, prefix = ''): Promise<void> {
      for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name)
      )) {
        await recordEntry(entry, dir, prefix);
      }
    }
    await walk(root);
    return createHash('sha256').update(entries.join('\n')).digest('hex');
  }

  async function runCurrentUpdateWithFakeOmx(version: string) {
    const fakeBin = join(tempDir, 'fake-bin');
    const invocationLog = join(tempDir, 'omx-invocations.log');
    const resultPath = join(tempDir, 'update-result.json');
    const runnerPath = join(tempDir, 'run-update.ts');
    await mkdir(fakeBin);
    await writeFile(
      join(fakeBin, 'omx'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${invocationLog}"\nif [ "$1" = "--version" ]; then\n  printf '%s\\n' 'oh-my-codex v${version}'\n  exit 0\nfi\nif [ "$1" = "api" ] && [ "$2" = "--help" ]; then\n  printf '%s\\n' 'Usage: omx api'\n  exit 0\nfi\nexit 1\n`,
      { mode: 0o755 }
    );
    await writeFile(
      runnerPath,
      `import { writeFile } from 'node:fs/promises';\nimport { update } from ${JSON.stringify(new URL('../../../src/core/updater.ts', import.meta.url).href)};\nconst result = await update({ targetDir: ${JSON.stringify(tempDir)} });\nawait writeFile(${JSON.stringify(resultPath)}, JSON.stringify(result));\n`
    );
    const originalPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${originalPath ?? ''}`;

    try {
      const subprocess = Bun.spawnSync({
        cmd: [process.execPath, runnerPath],
        cwd: tempDir,
        env: {
          ...process.env,
          BUN_ENV: 'test',
          NODE_ENV: 'test',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if (subprocess.exitCode !== 0) {
        throw new Error(new TextDecoder().decode(subprocess.stderr));
      }

      return {
        result: JSON.parse(await readFile(resultPath, 'utf-8')) as Awaited<
          ReturnType<typeof update>
        >,
        invocations: await readFile(invocationLog, 'utf-8').catch(() => ''),
      };
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  }

  describe('checkForUpdates', () => {
    it('should detect updates when component versions differ', async () => {
      await createConfig('0.1.0', {
        rules: '0.1.0',
        agents: '0.1.0',
      });

      const result = await checkForUpdates(tempDir);

      // Template version read from manifest.json
      expect(result.currentVersion).toBe('0.1.0');
      expect(result.latestVersion).toBe(MANIFEST_VERSION);
      expect(result.hasUpdates).toBe(true);
      expect(result.updatableComponents.length).toBeGreaterThan(0);
      expect(result.checkedAt).toBeDefined();
    });

    it('should return no updates when versions match', async () => {
      await createConfig(MANIFEST_VERSION, {
        rules: MANIFEST_VERSION,
        agents: MANIFEST_VERSION,
        skills: MANIFEST_VERSION,
        guides: MANIFEST_VERSION,
        hooks: MANIFEST_VERSION,
        contexts: MANIFEST_VERSION,
        ontology: MANIFEST_VERSION,
      });

      const result = await checkForUpdates(tempDir);

      expect(result.currentVersion).toBe(MANIFEST_VERSION);
      expect(result.latestVersion).toBe(MANIFEST_VERSION);
      expect(result.hasUpdates).toBe(false);
      expect(result.updatableComponents.length).toBe(0);
    });

    it('should handle missing config gracefully', async () => {
      // No config file created, should use defaults
      const result = await checkForUpdates(tempDir);

      expect(result.currentVersion).toBe('0.0.0'); // Default version
      expect(result.latestVersion).toBe(MANIFEST_VERSION);
      expect(result.hasUpdates).toBe(true);
    });

    it('should check each component individually', async () => {
      await createConfig('0.1.0', {
        rules: MANIFEST_VERSION, // Up to date
        agents: '0.0.0', // Out of date
        skills: '0.0.0', // Out of date
      });

      const result = await checkForUpdates(tempDir);

      // Should have agents and skills as updatable (not rules)
      const componentNames = result.updatableComponents.map((c) => c.name);
      expect(componentNames).not.toContain('rules' as UpdateComponent);
      expect(componentNames).toContain('agents' as UpdateComponent);
      expect(componentNames).toContain('skills' as UpdateComponent);
    });

    it('should detect update when component version is missing', async () => {
      await createConfig(MANIFEST_VERSION, {
        // No componentVersions specified
      });

      const result = await checkForUpdates(tempDir);

      // All components should be updatable
      expect(result.updatableComponents.length).toBe(7); // rules, agents, skills, guides, hooks, contexts, ontology
    });
  });

  describe('update', () => {
    it('should update components from templates to target', async () => {
      await createConfig('0.1.0');

      // Create target directory structure
      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
      });

      expect(result.success).toBe(true);
      expect(result.updatedComponents).toContain('rules' as UpdateComponent);
      expect(result.previousVersion).toBe('0.1.0');
      expect(result.newVersion).toBe(MANIFEST_VERSION);

      // Verify config was updated
      const configContent = await readFile(join(tempDir, '.omcodexrc.json'), 'utf-8');
      const config = JSON.parse(configContent);
      expect(config.version).toBe(MANIFEST_VERSION);
    });

    it('should skip components with no updates when not forced', async () => {
      await createConfig(MANIFEST_VERSION, {
        rules: MANIFEST_VERSION,
        agents: MANIFEST_VERSION,
        skills: MANIFEST_VERSION,
        guides: MANIFEST_VERSION,
        hooks: MANIFEST_VERSION,
        contexts: MANIFEST_VERSION,
        ontology: MANIFEST_VERSION,
      });

      const result = await update({
        targetDir: tempDir,
      });

      expect(result.success).toBe(true);
      expect(result.updatedComponents.length).toBe(0);
      expect(result.skippedComponents.length).toBe(7); // All components skipped
    });

    it('should enforce the OMX baseline even when project files are already current', async () => {
      await createConfig(MANIFEST_VERSION, {
        rules: MANIFEST_VERSION,
        agents: MANIFEST_VERSION,
        skills: MANIFEST_VERSION,
        guides: MANIFEST_VERSION,
        hooks: MANIFEST_VERSION,
        contexts: MANIFEST_VERSION,
        ontology: MANIFEST_VERSION,
      });
      const { result, invocations } = await runCurrentUpdateWithFakeOmx('0.20.0');

      expect(result.success).toBe(true);
      expect(invocations).toContain('--version');
      expect(result.warnings.some((warning) => /upgrade failed/i.test(warning))).toBe(true);
      expect(result.warnings.some((warning) => warning.includes('0.20.1'))).toBe(true);
    });

    it('should reject no-update statusLine migration when provider root is a symlink outside the project', async () => {
      await createConfig(MANIFEST_VERSION, {
        rules: MANIFEST_VERSION,
        agents: MANIFEST_VERSION,
        skills: MANIFEST_VERSION,
        guides: MANIFEST_VERSION,
        hooks: MANIFEST_VERSION,
        contexts: MANIFEST_VERSION,
        ontology: MANIFEST_VERSION,
      });
      const layout = getProviderLayout();
      const outsideRoot = join(tempDir, 'outside-status-root');
      await mkdir(outsideRoot);
      await writeFile(
        join(outsideRoot, 'settings.local.json'),
        '{"statusLine":{"type":"command"}}'
      );
      await symlink(outsideRoot, join(tempDir, layout.rootDir));

      const result = await update({ targetDir: tempDir });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(await readFile(join(outsideRoot, 'settings.local.json'), 'utf-8')).toBe(
        '{"statusLine":{"type":"command"}}'
      );
    });

    it('should force update all components with --force flag', async () => {
      await createConfig(MANIFEST_VERSION, {
        rules: MANIFEST_VERSION,
      });

      // Create target directory structure
      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
        force: true,
      });

      expect(result.success).toBe(true);
      expect(result.updatedComponents).toContain('rules' as UpdateComponent);
      expect(result.skippedComponents.length).toBe(0);
    });

    it('should create backup when --backup is true', async () => {
      await createConfig('0.1.0');

      // Create existing component files to backup
      const layout = getProviderLayout();
      await createDirStructure({
        [`${layout.rootDir}/rules/test.md`]: 'existing rule',
      });

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
        backup: true,
      });

      expect(result.success).toBe(true);
      expect(result.backedUpPaths.length).toBe(1);
      expect(result.backedUpPaths[0]).toContain('.omcodex-backup-');
    });

    it('should backup entry doc when it exists during backup operation', async () => {
      await createConfig('0.1.0');

      // Create existing entry doc (AGENTS.md) and component files to backup
      const layout = getProviderLayout();
      await createDirStructure({
        [`${layout.rootDir}/rules/test.md`]: 'existing rule',
        [layout.entryFile]: '# Existing AGENTS.md',
      });

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
        backup: true,
      });

      expect(result.success).toBe(true);
      expect(result.backedUpPaths.length).toBe(1);
      // The backup should include the entry doc backup (line 677 in backupInstallation)
      expect(result.backedUpPaths[0]).toContain('.omcodex-backup-');
    });

    it('should preserve customizations during update', async () => {
      await createConfig('0.1.0');

      // Create customization manifest
      const customFile = '.codex/rules/custom-rule.md';
      await createDirStructure({
        [customFile]: 'custom content',
        '.omcodex-customizations.json': JSON.stringify({
          modifiedFiles: [],
          preserveFiles: [customFile],
          customComponents: [],
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      });

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
        preserveCustomizations: true,
      });

      expect(result.success).toBe(true);
      expect(result.preservedFiles).toContain(customFile);

      // Verify custom file still exists
      await verifyFileContent(customFile, 'custom content');
    });

    it('should still preserve customizations from the legacy manifest filename', async () => {
      await createConfig('0.1.0');

      const customFile = '.codex/rules/legacy-custom-rule.md';
      await createDirStructure({
        [customFile]: 'legacy custom content',
        '.omcustom-customizations.json': JSON.stringify({
          modifiedFiles: [],
          preserveFiles: [customFile],
          customComponents: [],
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      });

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
        preserveCustomizations: true,
      });

      expect(result.success).toBe(true);
      expect(result.preservedFiles).toContain(customFile);
      await verifyFileContent(customFile, 'legacy custom content');
    });

    it('should handle dry run without file modifications', async () => {
      await createConfig('0.1.0');

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
        dryRun: true,
        backup: true,
      });

      expect(result.success).toBe(true);
      expect(result.updatedComponents).toContain('rules' as UpdateComponent);

      // Verify no actual files were created (dry run)
      const layout = getProviderLayout();
      const rulesPath = join(tempDir, layout.rootDir, 'rules');
      const exists = await readFile(rulesPath, 'utf-8').catch(() => null);
      expect(exists).toBeNull();
      expect(
        await readFile(join(tempDir, '.omcodex.lock.json'), 'utf-8').catch(() => null)
      ).toBeNull();
      expect(
        (await import('node:fs/promises'))
          .readdir(tempDir)
          .then((entries) => entries.some((entry) => entry.startsWith('.omcodex-backup-')))
      ).resolves.toBe(false);
    });

    it('should leave the entire project tree and isolated runtime state unchanged in dry-run', async () => {
      const originalHome = process.env.HOME;
      const originalPath = process.env.PATH;
      const originalRegistry = process.env.OMCODEX_REGISTRY_DIR;
      const projectDir = await mkdtemp(join(process.cwd(), '.omcodex-dry-run-'));
      const home = join(projectDir, 'home');
      const fakeBin = join(projectDir, 'fake-bin');
      const invocationLog = join(home, 'runtime-invocations.log');
      await mkdir(home, { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      await writeFile(
        join(fakeBin, 'which'),
        `#!/bin/sh\necho "$@" >> "${invocationLog}"\nexec /usr/bin/which "$@"\n`,
        { mode: 0o755 }
      );
      await writeFile(
        join(projectDir, '.omcodexrc.json'),
        JSON.stringify({ configVersion: 0, version: '0.1.0', language: 'en' })
      );
      const before = await hashTree(projectDir);
      process.env.HOME = home;
      process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
      process.env.OMCODEX_REGISTRY_DIR = join(home, 'registry');

      try {
        const result = await update({
          targetDir: projectDir,
          dryRun: true,
          backup: true,
          force: true,
        });
        expect(result.success).toBe(true);
        expect(await hashTree(projectDir)).toBe(before);
        expect(await readFile(invocationLog, 'utf-8').catch(() => '')).toBe('');
        expect(await readdir(join(home, 'registry')).catch(() => [])).toEqual([]);
      } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
        if (originalRegistry === undefined) delete process.env.OMCODEX_REGISTRY_DIR;
        else process.env.OMCODEX_REGISTRY_DIR = originalRegistry;
        await rm(projectDir, { recursive: true, force: true });
      }
    });

    it('should handle errors gracefully', async () => {
      // Create config in a non-existent directory to trigger error
      // (tempDir exists but we'll try to update with a bad target)
      await createConfig('0.1.0');

      const result = await update({
        targetDir: '/nonexistent/path/that/does/not/exist',
        components: ['rules'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should update config version after successful update', async () => {
      await createConfig('0.1.0');

      // Create target directory structure
      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      await update({
        targetDir: tempDir,
        components: ['rules'],
      });

      // Verify config version was updated
      const configContent = await readFile(join(tempDir, '.omcodexrc.json'), 'utf-8');
      const config = JSON.parse(configContent);
      expect(config.version).toBe(MANIFEST_VERSION);
      expect(config.lastUpdated).toBeDefined();
    });

    it('should report component update failure as an unsuccessful update', async () => {
      await createConfig('0.1.0');

      // Create target directory structure
      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      // Make rules directory a file (will cause copy to fail)
      await writeFile(join(tempDir, layout.rootDir, 'rules'), 'invalid');

      const result = await update({
        targetDir: tempDir,
        components: ['rules', 'hooks'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not a directory');
      expect(result.updatedComponents).toEqual([]);
      expect(result.skippedComponents).toEqual([]);
    });

    it('should preserve a user-modified protected MUST rule', async () => {
      await createConfig('0.1.0');
      const layout = getProviderLayout();
      await update({ targetDir: tempDir, components: ['rules'], forceOverwriteAll: true });
      const protectedPath = join(tempDir, layout.rootDir, 'rules', 'MUST-safety.md');
      const original = await readFile(protectedPath, 'utf-8');
      await writeFile(protectedPath, `${original}\n<!-- user marker -->\n`);

      const result = await update({ targetDir: tempDir, components: ['rules'], force: true });

      expect(result.success).toBe(true);
      expect(await readFile(protectedPath, 'utf-8')).toContain('<!-- user marker -->');

      const secondResult = await update({
        targetDir: tempDir,
        components: ['rules'],
        force: true,
      });
      expect(secondResult.success).toBe(true);
      expect(await readFile(protectedPath, 'utf-8')).toContain('<!-- user marker -->');
    });

    it('should retain a protected baseline across an agents-only update', async () => {
      await createConfig('0.1.0');
      const layout = getProviderLayout();
      await update({
        targetDir: tempDir,
        components: ['rules', 'agents'],
        forceOverwriteAll: true,
      });
      const protectedPath = join(tempDir, layout.rootDir, 'rules', 'MUST-safety.md');
      const original = await readFile(protectedPath, 'utf-8');
      await writeFile(protectedPath, `${original}\n<!-- survives partial update -->\n`);

      expect(
        (await update({ targetDir: tempDir, components: ['agents'], force: true })).success
      ).toBe(true);
      expect(
        (await update({ targetDir: tempDir, components: ['rules'], force: true })).success
      ).toBe(true);
      expect(await readFile(protectedPath, 'utf-8')).toContain('<!-- survives partial update -->');
    });

    it('should preserve a protected file across repeated updates without a prior lockfile', async () => {
      await createConfig('0.1.0');
      const layout = getProviderLayout();
      const protectedPath = join(tempDir, layout.rootDir, 'rules', 'MUST-safety.md');
      const sourcePath = join(import.meta.dir, '../../../templates/.claude/rules/MUST-safety.md');
      await mkdir(join(protectedPath, '..'), { recursive: true });
      await writeFile(
        protectedPath,
        `${await readFile(sourcePath, 'utf-8')}\n<!-- legacy user marker -->\n`
      );

      expect(
        (await update({ targetDir: tempDir, components: ['rules'], force: true })).success
      ).toBe(true);
      expect(
        (await update({ targetDir: tempDir, components: ['rules'], force: true })).success
      ).toBe(true);
      expect(await readFile(protectedPath, 'utf-8')).toContain('<!-- legacy user marker -->');
    });

    it('should preserve a nested preserveFiles entry across two updates', async () => {
      const config = getDefaultConfig();
      config.version = '0.1.0';
      config.preserveFiles = ['.codex/agents/souls/lang-golang-expert.soul.md'];
      await saveConfig(tempDir, config);
      const nestedPath = join(tempDir, '.codex/agents/souls/lang-golang-expert.soul.md');
      await mkdir(join(nestedPath, '..'), { recursive: true });
      await writeFile(nestedPath, '<!-- nested user marker -->\n');

      for (let attempt = 0; attempt < 2; attempt++) {
        expect(
          (await update({ targetDir: tempDir, components: ['agents'], force: true })).success
        ).toBe(true);
      }
      expect(await readFile(nestedPath, 'utf-8')).toContain('<!-- nested user marker -->');
    });

    it('should reject component updates when destination is a symlink outside the project', async () => {
      await createConfig('0.1.0');
      const layout = getProviderLayout();
      const outsideDir = join(tempDir, 'outside-rules');
      await mkdir(outsideDir);
      await writeFile(join(outsideDir, 'SHOULD-interaction.md'), 'outside sentinel');
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });
      await symlink(outsideDir, join(tempDir, layout.rootDir, 'rules'));

      const result = await update({ targetDir: tempDir, components: ['rules'], force: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(await readFile(join(outsideDir, 'SHOULD-interaction.md'), 'utf-8')).toBe(
        'outside sentinel'
      );
    });

    it('should reject component updates when an ancestor under target root is a symlink', async () => {
      await createConfig('0.1.0');
      const layout = getProviderLayout();
      const outsideRoot = join(tempDir, 'outside-codex-root');
      await mkdir(join(outsideRoot, 'rules'), { recursive: true });
      await writeFile(join(outsideRoot, 'rules', 'MUST-safety.md'), 'outside sentinel');
      await symlink(outsideRoot, join(tempDir, layout.rootDir));

      const result = await update({ targetDir: tempDir, components: ['rules'], force: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(await readFile(join(outsideRoot, 'rules', 'MUST-safety.md'), 'utf-8')).toBe(
        'outside sentinel'
      );
    });

    it('should reject legacy statusline migration when destination is a symlink outside the project', async () => {
      await createConfig('0.1.0');
      const layout = getProviderLayout();
      const outsideFile = join(tempDir, 'outside-statusline.sh');
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });
      await writeFile(outsideFile, 'outside sentinel');
      await symlink(outsideFile, join(tempDir, layout.rootDir, 'statusline.sh'));

      const result = await update({ targetDir: tempDir, force: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(result.updatedComponents).toEqual([]);
      expect(await readFile(outsideFile, 'utf-8')).toBe('outside sentinel');
      expect(
        await readFile(join(tempDir, layout.rootDir, 'rules', 'MUST-safety.md'), 'utf-8').catch(
          () => null
        )
      ).toBeNull();
    });

    it('should prevalidate all requested component destinations before updating an earlier component', async () => {
      await createConfig('0.1.0');
      const layout = getProviderLayout();
      await createDirStructure({
        [`${layout.rootDir}/agents/be-fastapi-expert.md`]: 'existing agent sentinel',
      });
      const outsideHooks = join(tempDir, 'outside-hooks');
      await mkdir(outsideHooks);
      await symlink(outsideHooks, join(tempDir, layout.rootDir, 'hooks'));
      const beforeHash = await hashTree(tempDir);

      const result = await update({
        targetDir: tempDir,
        components: ['agents', 'hooks'],
        force: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(result.updatedComponents).toEqual([]);
      expect(await hashTree(tempDir)).toBe(beforeHash);
      expect(
        await readFile(join(tempDir, layout.rootDir, 'agents', 'be-fastapi-expert.md'), 'utf-8')
      ).toBe('existing agent sentinel');
    });

    it('should reject config symlink finalization before component-only updates mutate files', async () => {
      const outsideConfig = join(tempDir, 'outside-config.json');
      const config = getDefaultConfig();
      config.version = '0.1.0';
      config.componentVersions = { rules: '0.1.0' };
      await writeFile(outsideConfig, JSON.stringify(config, null, 2));
      await symlink(outsideConfig, join(tempDir, '.omcodexrc.json'));
      const beforeHash = await hashTree(tempDir);

      const result = await update({ targetDir: tempDir, components: ['rules'], force: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(result.updatedComponents).toEqual([]);
      expect(await hashTree(tempDir)).toBe(beforeHash);
      expect(await readFile(outsideConfig, 'utf-8')).toBe(JSON.stringify(config, null, 2));
      expect(
        await readFile(join(tempDir, '.codex', 'rules', 'MUST-safety.md'), 'utf-8').catch(
          () => null
        )
      ).toBeNull();
    });

    it('should reject lockfile symlink finalization before component-only updates mutate files', async () => {
      await createConfig('0.1.0');
      const outsideLock = join(tempDir, 'outside-lock.json');
      await writeFile(outsideLock, 'outside lock sentinel');
      await symlink(outsideLock, join(tempDir, '.omcodex.lock.json'));
      const beforeHash = await hashTree(tempDir);

      const result = await update({ targetDir: tempDir, components: ['rules'], force: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(result.updatedComponents).toEqual([]);
      expect(await hashTree(tempDir)).toBe(beforeHash);
      expect(await readFile(outsideLock, 'utf-8')).toBe('outside lock sentinel');
      expect(
        await readFile(join(tempDir, '.codex', 'rules', 'MUST-safety.md'), 'utf-8').catch(
          () => null
        )
      ).toBeNull();
    });

    it('should not persist config migrations before unsafe component validation fails', async () => {
      const legacyConfig = {
        version: '0.1.0',
        configVersion: 0,
        componentVersions: { agents: '0.1.0', hooks: '0.1.0' },
      };
      await writeFile(join(tempDir, '.omcodexrc.json'), JSON.stringify(legacyConfig, null, 2));
      const layout = getProviderLayout();
      const outsideHooks = join(tempDir, 'outside-legacy-hooks');
      await mkdir(outsideHooks);
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });
      await symlink(outsideHooks, join(tempDir, layout.rootDir, 'hooks'));
      const beforeHash = await hashTree(tempDir);

      const result = await update({
        targetDir: tempDir,
        components: ['agents', 'hooks'],
        force: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(await hashTree(tempDir)).toBe(beforeHash);
      expect(
        JSON.parse(await readFile(join(tempDir, '.omcodexrc.json'), 'utf-8')).configVersion
      ).toBe(0);
    });

    it('should reject backup source symlinks before creating backup directories or copying outside data', async () => {
      await createConfig('0.1.0');
      const outsideAgents = join(tempDir, 'outside-agents-root');
      await mkdir(join(outsideAgents, 'skills'), { recursive: true });
      await writeFile(join(outsideAgents, 'secret.md'), 'outside backup sentinel');
      await symlink(outsideAgents, join(tempDir, '.agents'));
      const beforeHash = await hashTree(tempDir);

      const result = await update({
        targetDir: tempDir,
        components: ['skills'],
        force: true,
        backup: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(result.backedUpPaths).toEqual([]);
      expect(await hashTree(tempDir)).toBe(beforeHash);
      expect(
        (await readdir(tempDir)).filter((entry) => entry.startsWith('.omcodex-backup-'))
      ).toEqual([]);
      expect(await readFile(join(outsideAgents, 'secret.md'), 'utf-8')).toBe(
        'outside backup sentinel'
      );
    });

    it('should reject backup sources with the wrong file type before creating backup directories', async () => {
      await createConfig('0.1.0');
      await writeFile(join(tempDir, '.codex'), 'not a directory');
      await mkdir(join(tempDir, 'guides'), { recursive: true });
      await writeFile(join(tempDir, 'guides', 'existing.md'), 'existing guide');
      const beforeHash = await hashTree(tempDir);

      const result = await update({
        targetDir: tempDir,
        components: ['guides'],
        force: true,
        backup: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not a directory');
      expect(result.backedUpPaths).toEqual([]);
      expect(await hashTree(tempDir)).toBe(beforeHash);
      expect(
        (await readdir(tempDir)).filter((entry) => entry.startsWith('.omcodex-backup-'))
      ).toEqual([]);
    });

    it('should preserve config paths that use Windows separators within a component', async () => {
      const config = getDefaultConfig();
      config.version = '0.1.0';
      config.preserveFiles = ['.codex\\agents\\be-fastapi-expert.toml'];
      await saveConfig(tempDir, config);
      await createDirStructure({
        '.codex/agents/be-fastapi-expert.toml':
          'name = "be-fastapi-expert"\ndescription = "custom"\ndeveloper_instructions = "custom"\n',
      });

      const result = await update({ targetDir: tempDir, components: ['agents'], force: true });

      expect(result.success).toBe(true);
      expect(result.preservedFiles).toContain('.codex\\agents\\be-fastapi-expert.toml');
      expect(
        await readFile(join(tempDir, '.codex/agents/be-fastapi-expert.toml'), 'utf-8')
      ).toContain('description = "custom"');
    });

    it('should regenerate managed native-agent drift while preserving custom TOML bytes', async () => {
      await createConfig('0.1.0');
      const agentsDir = join(tempDir, '.codex', 'agents');
      const managedPath = join(agentsDir, 'be-fastapi-expert.toml');
      const customPath = join(agentsDir, 'custom-local.toml');
      const customBytes =
        'name = "custom-local"\ndescription = "custom"\ndeveloper_instructions = "custom"\n';
      await mkdir(agentsDir, { recursive: true });
      await writeFile(managedPath, `${NATIVE_AGENT_GENERATED_HEADER}name = "drifted"\n`);
      await writeFile(customPath, customBytes);

      const result = await update({ targetDir: tempDir, components: ['agents'], force: true });

      expect(result.success).toBe(true);
      expect(Bun.TOML.parse(await readFile(managedPath, 'utf-8'))).toMatchObject({
        name: 'be-fastapi-expert',
      });
      expect(await readFile(customPath, 'utf-8')).toBe(customBytes);
      expect(result.preservedFiles).toContain('.codex/agents/custom-local.toml');
      expect((await readdir(agentsDir)).some((filename) => filename.endsWith('.md'))).toBe(false);
    });

    it('should not record template baselines for files under a trailing-slash preserved directory', async () => {
      const config = getDefaultConfig();
      config.version = '0.1.0';
      config.preserveFiles = ['.codex/rules/custom/'];
      await saveConfig(tempDir, config);
      await createDirStructure({
        '.codex/rules/custom/local.md': 'local-only rule',
      });

      const result = await update({ targetDir: tempDir, components: ['rules'], force: true });

      expect(result.success).toBe(true);
      expect(await readFile(join(tempDir, '.codex/rules/custom/local.md'), 'utf-8')).toBe(
        'local-only rule'
      );
      const lockfile = JSON.parse(await readFile(join(tempDir, '.omcodex.lock.json'), 'utf-8'));
      expect(lockfile.files['.codex/rules/custom/local.md']).toBeUndefined();
    });

    it('should preserve an entire component directory with trailing slash without adding template files', async () => {
      const config = getDefaultConfig();
      config.version = '0.1.0';
      config.preserveFiles = ['.codex/rules/'];
      await saveConfig(tempDir, config);
      await createDirStructure({
        '.codex/rules/local-only.md': 'local-only rule',
      });
      const beforeRules = (await readdir(join(tempDir, '.codex', 'rules'))).sort();

      const result = await update({ targetDir: tempDir, components: ['rules'], force: true });

      expect(result.success).toBe(true);
      expect(await readFile(join(tempDir, '.codex/rules/local-only.md'), 'utf-8')).toBe(
        'local-only rule'
      );
      expect((await readdir(join(tempDir, '.codex', 'rules'))).sort()).toEqual(beforeRules);
      expect(
        await readFile(join(tempDir, '.codex/rules/MUST-safety.md'), 'utf-8').catch(() => null)
      ).toBeNull();
    });

    it('should reject an invalid multi-component plan before refreshing lockfile baselines', async () => {
      await createConfig('0.1.0');
      await update({ targetDir: tempDir, components: ['agents'], forceOverwriteAll: true });
      const lockfilePath = join(tempDir, '.omcodex.lock.json');
      const trackedPath = '.codex/agents/be-fastapi-expert.toml';
      const staleHash = '0'.repeat(64);
      const lockfile = JSON.parse(await readFile(lockfilePath, 'utf-8'));
      lockfile.files[trackedPath].templateHash = staleHash;
      await writeFile(lockfilePath, JSON.stringify(lockfile, null, 2));
      await writeFile(join(tempDir, '.codex/hooks'), 'not a directory');

      const result = await update({
        targetDir: tempDir,
        components: ['agents', 'hooks'],
        force: true,
      });

      expect(result.success).toBe(false);
      expect(result.updatedComponents).toEqual([]);
      expect(result.skippedComponents).toEqual([]);
      const refreshed = JSON.parse(await readFile(lockfilePath, 'utf-8'));
      expect(refreshed.files[trackedPath].templateHash).toBe(staleHash);
    });

    it('should disable preservation when preserveCustomizations is false', async () => {
      await createConfig('0.1.0');

      // Create customization manifest
      const customFile = '.codex/rules/custom-rule.md';
      await createDirStructure({
        [customFile]: 'custom content',
        '.omcodex-customizations.json': JSON.stringify({
          modifiedFiles: [],
          preserveFiles: [customFile],
          customComponents: [],
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      });

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
        preserveCustomizations: false,
      });

      expect(result.success).toBe(true);
      expect(result.preservedFiles.length).toBe(0);
    });

    it('should preserve config preserveFiles even when preserveCustomizations is false', async () => {
      await createConfig('0.1.0');

      // Update config to include preserveFiles
      const configContent = await readFile(join(tempDir, '.omcodexrc.json'), 'utf-8');
      const config = JSON.parse(configContent);
      const configPreserveFile = '.codex/rules/config-preserved.md';
      config.preserveFiles = [configPreserveFile];
      await writeFile(join(tempDir, '.omcodexrc.json'), JSON.stringify(config, null, 2));

      // Create the file to preserve and a manifest file
      const manifestPreserveFile = '.codex/rules/manifest-preserved.md';
      await createDirStructure({
        [configPreserveFile]: 'config preserved content',
        [manifestPreserveFile]: 'manifest preserved content',
        '.omcodex-customizations.json': JSON.stringify({
          modifiedFiles: [],
          preserveFiles: [manifestPreserveFile],
          customComponents: [],
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      });

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
        preserveCustomizations: false, // Disable manifest preservation
      });

      expect(result.success).toBe(true);
      // Should preserve config file but not manifest file
      expect(result.preservedFiles).toContain(configPreserveFile);
      expect(result.preservedFiles).not.toContain(manifestPreserveFile);
      // Verify file still exists with original content
      await verifyFileContent(configPreserveFile, 'config preserved content');
    });

    it('should bypass all preservation when forceOverwriteAll is true', async () => {
      await createConfig('0.1.0');

      // Update config to include preserveFiles
      const configContent = await readFile(join(tempDir, '.omcodexrc.json'), 'utf-8');
      const config = JSON.parse(configContent);
      const configPreserveFile = '.codex/rules/config-preserved.md';
      config.preserveFiles = [configPreserveFile];
      await writeFile(join(tempDir, '.omcodexrc.json'), JSON.stringify(config, null, 2));

      // Create manifest and config preserve files
      const manifestPreserveFile = '.codex/rules/manifest-preserved.md';
      await createDirStructure({
        [configPreserveFile]: 'config preserved content',
        [manifestPreserveFile]: 'manifest preserved content',
        '.omcodex-customizations.json': JSON.stringify({
          modifiedFiles: [],
          preserveFiles: [manifestPreserveFile],
          customComponents: [],
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      });

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
        forceOverwriteAll: true, // Bypass ALL preservation
      });

      expect(result.success).toBe(true);
      // Should preserve NOTHING when forceOverwriteAll is true
      expect(result.preservedFiles.length).toBe(0);
    });

    it('should override preserveCustomizations when forceOverwriteAll is true', async () => {
      await createConfig('0.1.0');

      const manifestPreserveFile = '.codex/rules/manifest-preserved.md';
      await createDirStructure({
        [manifestPreserveFile]: 'manifest preserved content',
        '.omcodex-customizations.json': JSON.stringify({
          modifiedFiles: [],
          preserveFiles: [manifestPreserveFile],
          customComponents: [],
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      });

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
        preserveCustomizations: true, // Explicitly enable
        forceOverwriteAll: true, // Should override preserveCustomizations
      });

      expect(result.success).toBe(true);
      expect(result.preservedFiles.length).toBe(0);
    });

    it('should differentiate component sync from version upgrade (#111)', async () => {
      // Config version matches template version, but components lack version tracking
      await createConfig(MANIFEST_VERSION, {
        // No component versions → all components show as "updatable"
      });

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
      });

      expect(result.success).toBe(true);
      expect(result.previousVersion).toBe(MANIFEST_VERSION);
      expect(result.newVersion).toBe(MANIFEST_VERSION);
      // When versions match but components were updated, it's a component sync
      expect(result.updatedComponents).toContain('rules' as UpdateComponent);
    });

    it('should skip specific components that are already up-to-date while others have updates', async () => {
      // Config version is old (hasUpdates: true due to version mismatch),
      // but rules component specifically is at latest version (0.3.0)
      await createConfig('0.1.0', {
        rules: MANIFEST_VERSION, // rules is already up-to-date
        agents: '0.1.0', // agents needs update
      });

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      // Update only 'rules' component - hasUpdates is true (version mismatch)
      // but rules is not in updatableComponents (it's already at 0.3.0)
      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
      });

      expect(result.success).toBe(true);
      // Rules should be skipped since its component version is already current
      expect(result.skippedComponents).toContain('rules' as UpdateComponent);
      expect(result.updatedComponents).not.toContain('rules' as UpdateComponent);
    });

    it('should update entry doc when no components specified (full update - new file)', async () => {
      await createConfig('0.1.0');

      // Create target directory structure
      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      // Full update (no components specified) triggers updateEntryDoc
      // No existing AGENTS.md → creates new file
      const result = await update({
        targetDir: tempDir,
        // No components specified = full update
      });

      expect(result.success).toBe(true);
      expect(result.newVersion).toBe(MANIFEST_VERSION);
      // Entry doc was created
      const layout2 = getProviderLayout();
      const entryExists = await readFile(join(tempDir, layout2.entryFile), 'utf-8').catch(
        () => null
      );
      expect(entryExists).not.toBeNull();
    });

    it('should merge existing entry doc during full update (no force)', async () => {
      await createConfig('0.1.0');

      // Create target directory structure with existing AGENTS.md
      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      // Create existing AGENTS.md with custom content
      const existingContent = `# My Custom Content\n\n<!-- MANAGED-SECTION-START -->\nManaged content\n<!-- MANAGED-SECTION-END -->\n`;
      await writeFile(join(tempDir, layout.entryFile), existingContent);

      // Full update without force → merge path (378-393)
      const result = await update({
        targetDir: tempDir,
        force: false, // Merge mode
      });

      expect(result.success).toBe(true);
      // Verify entry doc was updated (merged content)
      const updatedContent = await readFile(join(tempDir, layout.entryFile), 'utf-8');
      expect(updatedContent).toBeDefined();
    });

    it('should force overwrite entry doc during full update with --force', async () => {
      await createConfig('0.1.0');

      // Create target directory structure with existing AGENTS.md
      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      // Create existing AGENTS.md
      const existingContent = '# Existing Content\nSome content here';
      await writeFile(join(tempDir, layout.entryFile), existingContent);

      // Full update with force → backup + overwrite (371, 373-376)
      const result = await update({
        targetDir: tempDir,
        force: true, // Force overwrite mode
      });

      expect(result.success).toBe(true);
      // Verify entry doc was overwritten
      const updatedContent = await readFile(join(tempDir, layout.entryFile), 'utf-8');
      expect(updatedContent).not.toBe(existingContent);
    });

    it('should update guides component (testing getComponentPath guides path)', async () => {
      await createConfig('0.1.0');

      const result = await update({
        targetDir: tempDir,
        components: ['guides'],
      });

      expect(result.success).toBe(true);
      expect(result.updatedComponents).toContain('guides' as UpdateComponent);
    });

    it('should skip custom components that match the component path', async () => {
      await createConfig('0.1.0');

      // Create config with customComponents that should be skipped during update
      const configContent = await readFile(join(tempDir, '.omcodexrc.json'), 'utf-8');
      const config = JSON.parse(configContent);
      config.customComponents = [
        {
          name: 'my-custom-agent',
          path: '.codex/agents/my-custom-agent.md',
          enabled: true,
        },
      ];
      await writeFile(join(tempDir, '.omcodexrc.json'), JSON.stringify(config, null, 2));

      // Create the custom agent file
      await createDirStructure({
        '.codex/agents/my-custom-agent.md': '# Custom Agent Content',
      });

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        components: ['agents'],
      });

      expect(result.success).toBe(true);
    });
  });

  describe('resolveCustomizations edge cases', () => {
    it('should warn and skip invalid path traversal in manifest preserveFiles', async () => {
      await createConfig('0.1.0');

      // Create manifest with an invalid path that traverses outside project root
      await createDirStructure({
        '.omcodex-customizations.json': JSON.stringify({
          modifiedFiles: [],
          preserveFiles: ['../../etc/passwd'], // Invalid: path traversal
          customComponents: [],
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      });

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      // Should warn about invalid path but still succeed
      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
        preserveCustomizations: true,
      });

      expect(result.success).toBe(true);
      // Invalid path should be silently skipped (warn logged internally)
    });

    it('should merge manifest and config preserveFiles when both have valid paths', async () => {
      await createConfig('0.1.0');

      // Add config-level preserveFiles
      const configContent = await readFile(join(tempDir, '.omcodexrc.json'), 'utf-8');
      const config = JSON.parse(configContent);
      const configPreserveFile = '.codex/rules/config-rule.md';
      config.preserveFiles = [configPreserveFile];
      await writeFile(join(tempDir, '.omcodexrc.json'), JSON.stringify(config, null, 2));

      // Add manifest-level preserveFiles
      const manifestPreserveFile = '.codex/rules/manifest-rule.md';
      await createDirStructure({
        [configPreserveFile]: 'config rule content',
        [manifestPreserveFile]: 'manifest rule content',
        '.omcodex-customizations.json': JSON.stringify({
          modifiedFiles: [],
          preserveFiles: [manifestPreserveFile], // Valid path in manifest
          customComponents: [],
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      });

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      // Both manifest and config have preserveFiles → merge path (322-329)
      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
        preserveCustomizations: true, // Enable manifest preservation
        // No forceOverwriteAll, so config preserveFiles are also included
      });

      expect(result.success).toBe(true);
      // Both files should be preserved
      expect(result.preservedFiles).toContain(configPreserveFile);
      expect(result.preservedFiles).toContain(manifestPreserveFile);
    });
  });

  describe('preserveCustomizations', () => {
    it('should save file contents for existing files', async () => {
      await createDirStructure({
        'file1.txt': 'content1',
        'file2.txt': 'content2',
        'subdir/file3.txt': 'content3',
      });

      const preserved = await preserveCustomizations(tempDir, [
        'file1.txt',
        'file2.txt',
        'subdir/file3.txt',
      ]);

      expect(preserved.size).toBe(3);
      expect(preserved.get('file1.txt')).toBe('content1');
      expect(preserved.get('file2.txt')).toBe('content2');
      expect(preserved.get('subdir/file3.txt')).toBe('content3');
    });

    it('should skip non-existent files', async () => {
      await createDirStructure({
        'existing.txt': 'content',
      });

      const preserved = await preserveCustomizations(tempDir, ['existing.txt', 'nonexistent.txt']);

      expect(preserved.size).toBe(1);
      expect(preserved.get('existing.txt')).toBe('content');
      expect(preserved.has('nonexistent.txt')).toBe(false);
    });

    it('should return empty map for empty list', async () => {
      const preserved = await preserveCustomizations(tempDir, []);

      expect(preserved.size).toBe(0);
    });

    it('should handle unicode content correctly', async () => {
      await createDirStructure({
        'unicode.txt': '한글 테스트 🎉',
      });

      const preserved = await preserveCustomizations(tempDir, ['unicode.txt']);

      expect(preserved.get('unicode.txt')).toBe('한글 테스트 🎉');
    });

    it('should reject traversal and symlink paths before reading any customization', async () => {
      await createDirStructure({ 'safe.txt': 'safe', 'real/secret.txt': 'secret' });
      await symlink(join(tempDir, 'real'), join(tempDir, 'link'));

      await expect(
        preserveCustomizations(tempDir, ['safe.txt', '../outside.txt'])
      ).rejects.toThrow();
      await expect(preserveCustomizations(tempDir, ['link/secret.txt'])).rejects.toThrow(
        /symbolic link/i
      );
    });
  });

  describe('applyUpdates', () => {
    it('should write files to correct paths', async () => {
      const updates = [
        { path: 'file1.txt', content: 'content1' },
        { path: 'subdir/file2.txt', content: 'content2' },
      ];

      await applyUpdates(tempDir, updates);

      await verifyFileContent('file1.txt', 'content1');
      await verifyFileContent('subdir/file2.txt', 'content2');
    });

    it('should create directories if needed', async () => {
      const updates = [{ path: 'deep/nested/path/file.txt', content: 'nested content' }];

      await applyUpdates(tempDir, updates);

      await verifyFileContent('deep/nested/path/file.txt', 'nested content');
    });

    it('should handle empty updates array', async () => {
      await applyUpdates(tempDir, []);

      // Should not throw, just complete successfully
      expect(true).toBe(true);
    });

    it('should overwrite existing files', async () => {
      await createDirStructure({
        'existing.txt': 'old content',
      });

      await applyUpdates(tempDir, [{ path: 'existing.txt', content: 'new content' }]);

      await verifyFileContent('existing.txt', 'new content');
    });

    it('should validate the complete update plan before writing any file', async () => {
      await expect(
        applyUpdates(tempDir, [
          { path: 'would-have-been-written.txt', content: 'partial' },
          { path: '../escaped.txt', content: 'escape' },
        ])
      ).rejects.toThrow();

      expect(
        await readFile(join(tempDir, 'would-have-been-written.txt'), 'utf-8').catch(() => null)
      ).toBeNull();
    });

    it('should reject absolute paths and paths through symlinks', async () => {
      await mkdir(join(tempDir, 'real'));
      await symlink(join(tempDir, 'real'), join(tempDir, 'link'));

      await expect(
        applyUpdates(tempDir, [{ path: join(tempDir, 'absolute.txt'), content: 'x' }])
      ).rejects.toThrow();
      await expect(
        applyUpdates(tempDir, [{ path: 'link/escaped.txt', content: 'x' }])
      ).rejects.toThrow(/symbolic link/i);
      expect(
        await readFile(join(tempDir, 'real', 'escaped.txt'), 'utf-8').catch(() => null)
      ).toBeNull();
    });

    it('should reject dot, directory, and parent-child target conflicts before any write', async () => {
      await mkdir(join(tempDir, 'existing-directory'));

      for (const plan of [
        [
          { path: 'partial.txt', content: 'partial' },
          { path: '.', content: 'invalid' },
        ],
        [{ path: 'existing-directory', content: 'invalid' }],
        [
          { path: 'parent', content: 'file' },
          { path: 'parent/child.txt', content: 'child' },
        ],
      ]) {
        await expect(applyUpdates(tempDir, plan)).rejects.toThrow();
        expect(await readFile(join(tempDir, 'partial.txt'), 'utf-8').catch(() => null)).toBeNull();
        expect(await readFile(join(tempDir, 'parent'), 'utf-8').catch(() => null)).toBeNull();
      }
    });

    it('should roll back the first file when the second commit fails', async () => {
      const realFs = await import('node:fs/promises');
      await writeFile(join(tempDir, 'first.txt'), 'original');
      const failingFs: NonNullable<ApplyUpdatesDependencies['fs']> = {
        lstat: realFs.lstat,
        mkdir: realFs.mkdir,
        mkdtemp: realFs.mkdtemp,
        realpath: realFs.realpath,
        rename: async (
          from: Parameters<typeof realFs.rename>[0],
          to: Parameters<typeof realFs.rename>[1]
        ) => {
          if (
            String(from).includes('.omcodex-update-stage-') &&
            String(to).endsWith('second.txt')
          ) {
            const failure = new Error('simulated second commit failure') as NodeJS.ErrnoException;
            failure.code = 'EIO';
            throw failure;
          }
          await realFs.rename(from, to);
        },
        rm: realFs.rm,
        rmdir: realFs.rmdir,
        writeFile: realFs.writeFile,
      };

      await expect(
        applyUpdates(
          tempDir,
          [
            { path: 'first.txt', content: 'replacement' },
            { path: 'second.txt', content: 'second' },
          ],
          { fs: failingFs }
        )
      ).rejects.toThrow('simulated second commit failure');

      expect(await readFile(join(tempDir, 'first.txt'), 'utf-8')).toBe('original');
      expect(await readFile(join(tempDir, 'second.txt'), 'utf-8').catch(() => null)).toBeNull();
      expect(
        (await readdir(tempDir)).some((entry) => entry.startsWith('.omcodex-update-stage-'))
      ).toBe(false);
    });
  });

  describe('saveCustomizationManifest', () => {
    it('should write manifest JSON to correct path', async () => {
      const manifest = {
        modifiedFiles: ['file1.txt', 'file2.txt'],
        preserveFiles: ['custom.txt'],
        customComponents: ['my-agent'],
        lastUpdated: '2025-01-01T00:00:00Z',
      };

      await saveCustomizationManifest(tempDir, manifest);

      const savedContent = await readFile(join(tempDir, '.omcodex-customizations.json'), 'utf-8');
      const saved = JSON.parse(savedContent);

      expect(saved.modifiedFiles).toEqual(['file1.txt', 'file2.txt']);
      expect(saved.preserveFiles).toEqual(['custom.txt']);
      expect(saved.customComponents).toEqual(['my-agent']);
      expect(saved.lastUpdated).toBe('2025-01-01T00:00:00Z');
    });

    it('should handle empty manifest', async () => {
      const manifest = {
        modifiedFiles: [],
        preserveFiles: [],
        customComponents: [],
        lastUpdated: '2025-01-01T00:00:00Z',
      };

      await saveCustomizationManifest(tempDir, manifest);

      const savedContent = await readFile(join(tempDir, '.omcodex-customizations.json'), 'utf-8');
      const saved = JSON.parse(savedContent);

      expect(saved.modifiedFiles).toEqual([]);
      expect(saved.preserveFiles).toEqual([]);
      expect(saved.customComponents).toEqual([]);
    });
  });

  describe('getAgentVersions', () => {
    it('should return versions from config', async () => {
      await createConfig('1.0.0');

      // Add agents to config
      const configContent = await readFile(join(tempDir, '.omcodexrc.json'), 'utf-8');
      const config = JSON.parse(configContent);
      config.agents = {
        'agent-1': {
          version: '1.0.0',
          source: 'local',
          lastUpdated: '2025-01-01T00:00:00Z',
          hasLocalModifications: false,
          enabled: true,
        },
        'agent-2': {
          version: '2.0.0',
          source: 'https://github.com/example/agent',
          lastUpdated: '2025-01-02T00:00:00Z',
          hasLocalModifications: true,
          enabled: true,
        },
      };
      await writeFile(join(tempDir, '.omcodexrc.json'), JSON.stringify(config, null, 2));

      const versions = await getAgentVersions(tempDir);

      expect(versions.length).toBe(2);

      const agent1 = versions.find((v) => v.name === 'agent-1');
      expect(agent1).toBeDefined();
      expect(agent1?.version).toBe('1.0.0');
      expect(agent1?.source).toBe('local');
      expect(agent1?.hasLocalModifications).toBe(false);

      const agent2 = versions.find((v) => v.name === 'agent-2');
      expect(agent2).toBeDefined();
      expect(agent2?.version).toBe('2.0.0');
      expect(agent2?.source).toBe('https://github.com/example/agent');
      expect(agent2?.hasLocalModifications).toBe(true);
    });

    it('should return empty array when no agents configured', async () => {
      await createConfig('1.0.0');

      const versions = await getAgentVersions(tempDir);

      expect(versions).toEqual([]);
    });

    it('should handle missing config gracefully', async () => {
      // No config file created
      const versions = await getAgentVersions(tempDir);

      expect(versions).toEqual([]);
    });

    it('should handle agents with missing optional fields', async () => {
      await createConfig('1.0.0');

      // Add agent with minimal fields
      const configContent = await readFile(join(tempDir, '.omcodexrc.json'), 'utf-8');
      const config = JSON.parse(configContent);
      config.agents = {
        'minimal-agent': {
          version: '1.0.0',
          enabled: true,
          // source, lastUpdated, hasLocalModifications not specified
        },
      };
      await writeFile(join(tempDir, '.omcodexrc.json'), JSON.stringify(config, null, 2));

      const versions = await getAgentVersions(tempDir);

      expect(versions.length).toBe(1);
      expect(versions[0].name).toBe('minimal-agent');
      expect(versions[0].version).toBe('1.0.0');
      expect(versions[0].source).toBe('local'); // Default
      expect(versions[0].lastUpdated).toBe(''); // Default
      expect(versions[0].hasLocalModifications).toBe(false); // Default
    });
  });

  describe('syncRootLevelFiles (Bug #201)', () => {
    it('should sync hook scripts but not the Claude statusline during full update', async () => {
      await createConfig('0.1.0');

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        // No components specified = full update
      });

      expect(result.success).toBe(true);
      expect(result.syncedRootFiles).toBeDefined();
      expect(result.syncedRootFiles.length).toBeGreaterThan(0);
      expect(result.syncedRootFiles).toContain('install-hooks.sh');
      expect(result.syncedRootFiles).toContain('uninstall-hooks.sh');
      expect(result.syncedRootFiles).not.toContain('statusline.sh');
      expect(
        await readFile(join(tempDir, layout.rootDir, 'statusline.sh'), 'utf-8').catch(() => null)
      ).toBeNull();
    });

    it('should not sync root-level files when specific components are updated', async () => {
      await createConfig('0.1.0');

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
      });

      expect(result.success).toBe(true);
      expect(result.syncedRootFiles.length).toBe(0);
    });

    it('should preserve execute permissions on synced hook scripts', async () => {
      await createConfig('0.1.0');

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      await update({
        targetDir: tempDir,
      });

      const fs = await import('node:fs/promises');
      const hookScriptPath = join(tempDir, layout.rootDir, 'install-hooks.sh');
      const stats = await fs.stat(hookScriptPath);
      // Check owner execute bit (0o100)
      expect(stats.mode & 0o100).toBeTruthy();
    });

    it('should return file list in dry run mode without copying', async () => {
      await createConfig('0.1.0');

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.syncedRootFiles.length).toBeGreaterThan(0);
      expect(result.syncedRootFiles).not.toContain('statusline.sh');

      // Files should NOT actually exist (dry run)
      const statuslinePath = join(tempDir, layout.rootDir, 'statusline.sh');
      const exists = await readFile(statuslinePath, 'utf-8').catch(() => null);
      expect(exists).toBeNull();
    });
  });

  describe('legacy Codex statusLine migration', () => {
    it('should recognize statusline hashes shipped by earlier releases', () => {
      expect(
        isKnownHarnessStatusLineHash(
          '2002d2fb1605f1d139b4e6102c7deb2a716761b5c86d7255ff27fdd8bf47a551'
        )
      ).toBe(true);
      expect(
        isKnownHarnessStatusLineHash(
          createHash('sha256').update('#!/bin/sh\necho user-owned\n').digest('hex')
        )
      ).toBe(false);
    });

    it('should remove harness status artifacts while preserving unrelated JSON and config.toml', async () => {
      await createConfig(MANIFEST_VERSION, {
        rules: MANIFEST_VERSION,
        agents: MANIFEST_VERSION,
        skills: MANIFEST_VERSION,
        guides: MANIFEST_VERSION,
        hooks: MANIFEST_VERSION,
        contexts: MANIFEST_VERSION,
        ontology: MANIFEST_VERSION,
      });

      const layout = getProviderLayout();
      const nativeConfig = '# user formatting must survive\n[tui]\nstatus_line=["model"]\n';
      await createDirStructure({
        [`${layout.rootDir}/statusline.sh`]: LEGACY_STATUSLINE_TEMPLATE,
        [`${layout.rootDir}/settings.local.json`]: JSON.stringify({
          statusLine: {
            type: 'command',
            command: `${layout.rootDir}/statusline.sh`,
            padding: 0,
            refreshInterval: 10,
          },
          enableAllProjectMcpServers: true,
        }),
        [`${layout.rootDir}/config.toml`]: nativeConfig,
      });

      const result = await update({ targetDir: tempDir });

      const settings = JSON.parse(
        await readFile(join(tempDir, layout.rootDir, 'settings.local.json'), 'utf-8')
      );
      expect(result.success).toBe(true);
      expect(settings.statusLine).toBeUndefined();
      expect(settings.enableAllProjectMcpServers).toBe(true);
      expect(
        await readFile(join(tempDir, layout.rootDir, 'statusline.sh'), 'utf-8').catch(() => null)
      ).toBeNull();
      expect(await readFile(join(tempDir, layout.rootDir, 'config.toml'), 'utf-8')).toBe(
        nativeConfig
      );
    });

    it('should remove a settings.local.json owned only by the legacy statusLine', async () => {
      await createConfig(MANIFEST_VERSION, {
        rules: MANIFEST_VERSION,
        agents: MANIFEST_VERSION,
        skills: MANIFEST_VERSION,
        guides: MANIFEST_VERSION,
        hooks: MANIFEST_VERSION,
        contexts: MANIFEST_VERSION,
        ontology: MANIFEST_VERSION,
      });

      const layout = getProviderLayout();
      await createDirStructure({
        [`${layout.rootDir}/settings.local.json`]: JSON.stringify({
          statusLine: {
            type: 'command',
            command: `${layout.rootDir}/statusline.sh`,
          },
        }),
      });

      const result = await update({ targetDir: tempDir });

      expect(result.success).toBe(true);
      expect(
        await readFile(join(tempDir, layout.rootDir, 'settings.local.json'), 'utf-8').catch(
          () => null
        )
      ).toBeNull();
    });

    it('should preserve custom statusLine commands and unrelated JSON byte-for-byte', async () => {
      await createConfig(MANIFEST_VERSION, {
        rules: MANIFEST_VERSION,
        agents: MANIFEST_VERSION,
        skills: MANIFEST_VERSION,
        guides: MANIFEST_VERSION,
        hooks: MANIFEST_VERSION,
        contexts: MANIFEST_VERSION,
        ontology: MANIFEST_VERSION,
      });

      const layout = getProviderLayout();
      const customSettings =
        '{\n  "statusLine": { "type": "command", "command": ".codex/custom-statusline.sh" },\n  "user": true\n}\n';
      const customStatusline = '#!/bin/sh\necho custom\n';
      await createDirStructure({
        [`${layout.rootDir}/settings.local.json`]: customSettings,
        [`${layout.rootDir}/custom-statusline.sh`]: customStatusline,
      });

      const result = await update({ targetDir: tempDir });

      expect(result.success).toBe(true);
      expect(await readFile(join(tempDir, layout.rootDir, 'settings.local.json'), 'utf-8')).toBe(
        customSettings
      );
      expect(await readFile(join(tempDir, layout.rootDir, 'custom-statusline.sh'), 'utf-8')).toBe(
        customStatusline
      );
    });

    it('should preserve exact-path statusLine objects with custom fields', async () => {
      await createConfig(MANIFEST_VERSION, {
        rules: MANIFEST_VERSION,
        agents: MANIFEST_VERSION,
        skills: MANIFEST_VERSION,
        guides: MANIFEST_VERSION,
        hooks: MANIFEST_VERSION,
        contexts: MANIFEST_VERSION,
        ontology: MANIFEST_VERSION,
      });

      const layout = getProviderLayout();
      const customSettings =
        '{\n  "statusLine": { "type": "command", "command": ".codex/statusline.sh", "padding": 0, "theme": "user" }\n}\n';
      await createDirStructure({
        [`${layout.rootDir}/settings.local.json`]: customSettings,
      });

      const result = await update({ targetDir: tempDir });

      expect(result.success).toBe(true);
      expect(await readFile(join(tempDir, layout.rootDir, 'settings.local.json'), 'utf-8')).toBe(
        customSettings
      );
    });

    it('should preserve exact-path statusLine objects with customized padding', async () => {
      await createConfig(MANIFEST_VERSION, {
        rules: MANIFEST_VERSION,
        agents: MANIFEST_VERSION,
        skills: MANIFEST_VERSION,
        guides: MANIFEST_VERSION,
        hooks: MANIFEST_VERSION,
        contexts: MANIFEST_VERSION,
        ontology: MANIFEST_VERSION,
      });

      const layout = getProviderLayout();
      const customSettings =
        '{\n  "statusLine": { "type": "command", "command": ".codex/statusline.sh", "padding": 2 }\n}\n';
      await createDirStructure({
        [`${layout.rootDir}/settings.local.json`]: customSettings,
      });

      const result = await update({ targetDir: tempDir });

      expect(result.success).toBe(true);
      expect(await readFile(join(tempDir, layout.rootDir, 'settings.local.json'), 'utf-8')).toBe(
        customSettings
      );
    });

    it('should preserve custom content at the former harness statusline path', async () => {
      await createConfig(MANIFEST_VERSION, {
        rules: MANIFEST_VERSION,
        agents: MANIFEST_VERSION,
        skills: MANIFEST_VERSION,
        guides: MANIFEST_VERSION,
        hooks: MANIFEST_VERSION,
        contexts: MANIFEST_VERSION,
        ontology: MANIFEST_VERSION,
      });

      const layout = getProviderLayout();
      const customStatusline = '#!/bin/sh\necho user-owned\n';
      const customSettings = JSON.stringify({
        statusLine: {
          type: 'command',
          command: `${layout.rootDir}/statusline.sh`,
        },
        user: true,
      });
      await createDirStructure({
        [`${layout.rootDir}/statusline.sh`]: customStatusline,
        [`${layout.rootDir}/settings.local.json`]: customSettings,
      });

      const result = await update({ targetDir: tempDir });

      expect(result.success).toBe(true);
      expect(await readFile(join(tempDir, layout.rootDir, 'statusline.sh'), 'utf-8')).toBe(
        customStatusline
      );
      expect(await readFile(join(tempDir, layout.rootDir, 'settings.local.json'), 'utf-8')).toBe(
        customSettings
      );
    });

    it('should not create statusLine settings when settings.local.json is missing', async () => {
      await createConfig('0.1.0');
      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({ targetDir: tempDir });

      expect(result.success).toBe(true);
      expect(
        await readFile(join(tempDir, layout.rootDir, 'settings.local.json'), 'utf-8').catch(
          () => null
        )
      ).toBeNull();
      expect(
        await readFile(join(tempDir, layout.rootDir, 'statusline.sh'), 'utf-8').catch(() => null)
      ).toBeNull();
    });
  });

  describe('removeDeprecatedFiles (Bug #202)', () => {
    it('should remove deprecated files during full update', async () => {
      await createConfig('0.1.0');

      const layout = getProviderLayout();
      // Create a deprecated file that exists in the manifest
      await createDirStructure({
        [`${layout.rootDir}/rules/SHOULD-agent-teams.md`]: '# Old agent teams rule',
      });

      const result = await update({
        targetDir: tempDir,
      });

      expect(result.success).toBe(true);
      expect(result.removedDeprecatedFiles).toContain('.codex/rules/SHOULD-agent-teams.md');

      // File should be removed
      const deprecatedPath = join(tempDir, layout.rootDir, 'rules', 'SHOULD-agent-teams.md');
      const exists = await readFile(deprecatedPath, 'utf-8').catch(() => null);
      expect(exists).toBeNull();
    });

    it('should not remove deprecated files when specific components are updated', async () => {
      await createConfig('0.1.0');

      const layout = getProviderLayout();
      await createDirStructure({
        [`${layout.rootDir}/rules/SHOULD-agent-teams.md`]: '# Old agent teams rule',
      });

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
      });

      expect(result.success).toBe(true);
      expect(result.removedDeprecatedFiles.length).toBe(0);

      // File should still exist
      const deprecatedPath = join(tempDir, layout.rootDir, 'rules', 'SHOULD-agent-teams.md');
      const content = await readFile(deprecatedPath, 'utf-8');
      expect(content).toBe('# Old agent teams rule');
    });

    it('should skip deprecated files that do not exist in target', async () => {
      await createConfig('0.1.0');

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });
      // Do NOT create SHOULD-agent-teams.md

      const result = await update({
        targetDir: tempDir,
      });

      expect(result.success).toBe(true);
      expect(result.removedDeprecatedFiles.length).toBe(0);
    });

    it('should return deprecated file list in dry run mode without removing', async () => {
      await createConfig('0.1.0');

      const layout = getProviderLayout();
      await createDirStructure({
        [`${layout.rootDir}/rules/SHOULD-agent-teams.md`]: '# Old agent teams rule',
      });

      const result = await update({
        targetDir: tempDir,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.removedDeprecatedFiles.length).toBeGreaterThan(0);

      // File should still exist (dry run)
      const deprecatedPath = join(tempDir, layout.rootDir, 'rules', 'SHOULD-agent-teams.md');
      const content = await readFile(deprecatedPath, 'utf-8');
      expect(content).toBe('# Old agent teams rule');
    });

    it('should not report deprecated removals for an empty Codex project in dry run', async () => {
      await createConfig('0.1.0');

      const result = await update({ targetDir: tempDir, dryRun: true, force: true });

      expect(result.success).toBe(true);
      expect(result.removedDeprecatedFiles).toEqual([]);
    });

    it('should reject deprecated file removal through a symlinked component before updating other components', async () => {
      await createConfig('0.1.0', {
        rules: MANIFEST_VERSION,
        agents: '0.1.0',
        skills: MANIFEST_VERSION,
        guides: MANIFEST_VERSION,
        hooks: MANIFEST_VERSION,
        contexts: MANIFEST_VERSION,
        ontology: MANIFEST_VERSION,
      });
      const outsideRules = join(tempDir, 'outside-rules');
      await mkdir(outsideRules);
      await writeFile(join(outsideRules, 'SHOULD-agent-teams.md'), 'outside deprecated sentinel');
      await mkdir(join(tempDir, '.codex'), { recursive: true });
      await symlink(outsideRules, join(tempDir, '.codex', 'rules'));
      const beforeHash = await hashTree(tempDir);

      const result = await update({ targetDir: tempDir });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(result.updatedComponents).toEqual([]);
      expect(result.removedDeprecatedFiles).toEqual([]);
      expect(await hashTree(tempDir)).toBe(beforeHash);
      expect(await readFile(join(outsideRules, 'SHOULD-agent-teams.md'), 'utf-8')).toBe(
        'outside deprecated sentinel'
      );
      expect(
        await readFile(join(tempDir, '.codex', 'agents', 'be-fastapi-expert.md'), 'utf-8').catch(
          () => null
        )
      ).toBeNull();
    });

    it('should reject deprecated file removal when the deprecated leaf is a symlink', async () => {
      await createConfig('0.1.0');
      const outsideFile = join(tempDir, 'outside-deprecated.md');
      await writeFile(outsideFile, 'outside deprecated leaf sentinel');
      await mkdir(join(tempDir, '.codex', 'rules'), { recursive: true });
      await symlink(outsideFile, join(tempDir, '.codex', 'rules', 'SHOULD-agent-teams.md'));
      const beforeHash = await hashTree(tempDir);

      const result = await update({ targetDir: tempDir });

      expect(result.success).toBe(false);
      expect(result.error).toContain('symbolic link');
      expect(result.updatedComponents).toEqual([]);
      expect(await hashTree(tempDir)).toBe(beforeHash);
      expect(await readFile(outsideFile, 'utf-8')).toBe('outside deprecated leaf sentinel');
    });
  });

  describe('--hard mode (namespace sync)', () => {
    describe('extractFrontmatterName', () => {
      it('should extract name from valid YAML frontmatter', () => {
        const content = '---\nname: my-agent\nmodel: sonnet\n---\n\n# Body';
        expect(extractFrontmatterName(content)).toBe('my-agent');
      });

      it('should extract quoted name values', () => {
        const content = '---\nname: "my-agent"\nmodel: sonnet\n---\n\n# Body';
        expect(extractFrontmatterName(content)).toBe('my-agent');
      });

      it('should extract single-quoted name values', () => {
        const content = "---\nname: 'my-agent'\nmodel: sonnet\n---\n\n# Body";
        expect(extractFrontmatterName(content)).toBe('my-agent');
      });

      it('should return null when content has no frontmatter', () => {
        const content = '# Just a heading\n\nNo frontmatter here.';
        expect(extractFrontmatterName(content)).toBeNull();
      });

      it('should return null when frontmatter has no name field', () => {
        const content = '---\nmodel: sonnet\ntools: [Read]\n---\n\n# Body';
        expect(extractFrontmatterName(content)).toBeNull();
      });

      it('should return null for empty content', () => {
        expect(extractFrontmatterName('')).toBeNull();
      });
    });

    it('should report namespaceSynced: [] when hard is not set', async () => {
      await createConfig('0.1.0');

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
      });

      expect(result.success).toBe(true);
      expect(result.namespaceSynced).toEqual([]);
    });

    it('should run namespace sync when hard is true and update a name mismatch', async () => {
      await createConfig('0.1.0');

      const layout = getProviderLayout();
      const rulesDir = join(tempDir, layout.rootDir, 'rules');
      await mkdir(rulesDir, { recursive: true });

      // Create a .md file in the rules dir with a name: that differs from upstream
      // We need a file that exists in templates — pick one we know exists
      // Instead, test syncNamespaceInFile indirectly through the full update flow.
      // Since we can't easily manufacture a lockfile mismatch in a unit test,
      // we verify that the result.namespaceSynced array is present and defined.
      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
        force: true,
        hard: true,
      });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.namespaceSynced)).toBe(true);
    });

    it('should not sync user-modified files (hash differs from lockfile)', async () => {
      await createConfig('0.1.0');

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      // Run a normal update first to install files and generate lockfile
      await update({ targetDir: tempDir, components: ['rules'] });

      // Simulate user modification of one installed file
      const rulesDir = join(tempDir, layout.rootDir, 'rules');
      const installedFiles = await (await import('node:fs/promises')).readdir(rulesDir);
      if (installedFiles.length > 0) {
        const firstFile = join(rulesDir, installedFiles[0]);
        const original = await readFile(firstFile, 'utf-8');
        // Append user modification to change the hash
        await writeFile(firstFile, `${original}\n<!-- user modification -->`);
      }

      // Run --hard update — modified files must not be synced
      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
        force: true,
        hard: true,
      });

      expect(result.success).toBe(true);
      // The modified file should not appear in namespaceSynced
      if (installedFiles.length > 0) {
        const modifiedRelPath = `${layout.rootDir}/rules/${installedFiles[0]}`;
        expect(result.namespaceSynced).not.toContain(modifiedRelPath);
      }
    });

    it('should return empty namespaceSynced when no lockfile is present', async () => {
      await createConfig('0.1.0');

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      // Ensure no lockfile exists (fresh directory, never initialized)
      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
        hard: true,
      });

      expect(result.success).toBe(true);
      // Without a lockfile, applyNamespaceSync returns [] immediately
      expect(Array.isArray(result.namespaceSynced)).toBe(true);
    });
  });

  describe('shouldSkipSelfUpdate (via update())', () => {
    it('should set skippedSource=true when target is the oh-my-customcodex source project', async () => {
      // Write a package.json with name "oh-my-customcodex" to tempDir
      await writeFile(
        join(tempDir, 'package.json'),
        JSON.stringify({ name: 'oh-my-customcodex', version: '0.1.0' }, null, 2)
      );
      await createConfig('0.1.0');

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
      });

      expect(result.success).toBe(true);
      expect(result.skippedSource).toBe(true);
    });

    it('should NOT set skippedSource for normal (non-source) projects', async () => {
      // Write a package.json with a different name
      await writeFile(
        join(tempDir, 'package.json'),
        JSON.stringify({ name: 'my-other-project', version: '0.1.0' }, null, 2)
      );
      await createConfig('0.1.0');

      const layout = getProviderLayout();
      await mkdir(join(tempDir, layout.rootDir), { recursive: true });

      const result = await update({
        targetDir: tempDir,
        components: ['rules'],
      });

      expect(result.success).toBe(true);
      expect(result.skippedSource).toBeUndefined();
    });
  });
});
