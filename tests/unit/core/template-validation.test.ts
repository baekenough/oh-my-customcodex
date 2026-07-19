import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dir, '../../..');
const TEMPLATES_DIR = resolve(PROJECT_ROOT, 'templates');

interface ManifestComponent {
  name: string;
  path: string;
  description: string;
  files: number;
}

interface Manifest {
  version: string;
  lastUpdated: string;
  components: ManifestComponent[];
  source: string;
}

interface FrontmatterResult {
  isValid: boolean;
  /** Top-level scalar fields: key → value. For array fields, value is empty string but key is present. */
  fields: Record<string, string>;
  /** Keys whose values are multiline YAML lists (e.g. tools:\n  - Read). */
  arrayFields: Set<string>;
  hasFrontmatter: boolean;
  hasClosingMarker: boolean;
}

function expectContentToContainAll(content: string, phrases: Iterable<string>): void {
  for (const phrase of phrases) {
    expect(content).toContain(phrase);
  }
}

function findExactMarkdownH2Index(content: string, heading: string): number {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...content.matchAll(new RegExp(`^## ${escapedHeading}\\r?$`, 'gm'))];
  expect(matches).toHaveLength(1);
  return matches[0]?.index ?? -1;
}

function extractMarkdownH2Section(content: string, heading: string): string {
  const sectionStart = findExactMarkdownH2Index(content, heading);
  const nextHeading = /^## .+$/gm;
  nextHeading.lastIndex = sectionStart + 1;
  const nextSection = nextHeading.exec(content)?.index ?? -1;
  return content.slice(sectionStart, nextSection === -1 ? content.length : nextSection);
}

function extractSingleHtmlCommentContaining(content: string, marker: string): string {
  const matchingComments = [...content.matchAll(/<!--[\s\S]*?-->/g)]
    .map((match) => match[0])
    .filter((comment) => comment.includes(marker));

  expect(matchingComments).toHaveLength(1);
  return matchingComments[0];
}

function expectProviderContrast(content: string): void {
  expect(content).toMatch(/\b(?:Claude|provider(?:-owned)?)\b/i);
  expect(content).toMatch(/\b(?:Codex|OMX)\b/);
}

function expectProviderDisposition(content: string): void {
  expectProviderContrast(content);
  expect(content).toMatch(/\b(?:no|do not|does not|keep|preserve|retain|remain|unchanged)\b/i);
}

function parseFrontmatter(content: string): FrontmatterResult {
  const openingMarker = content.startsWith('---\n') || content.startsWith('---\r\n');

  if (!openingMarker) {
    return {
      isValid: false,
      fields: {},
      arrayFields: new Set(),
      hasFrontmatter: false,
      hasClosingMarker: false,
    };
  }

  const afterOpening = content.slice(4);
  const closingIndex = afterOpening.indexOf('\n---');

  if (closingIndex === -1) {
    return {
      isValid: false,
      fields: {},
      arrayFields: new Set(),
      hasFrontmatter: true,
      hasClosingMarker: false,
    };
  }

  const frontmatterBlock = afterOpening.slice(0, closingIndex);
  const fields: Record<string, string> = {};
  const arrayFields = new Set<string>();
  let lastTopLevelKey: string | null = null;

  for (const line of frontmatterBlock.split('\n')) {
    // Indented lines belong to the previous top-level key (array items or nested values)
    if (line.startsWith('  ') || line.startsWith('\t')) {
      if (lastTopLevelKey !== null) {
        arrayFields.add(lastTopLevelKey);
      }
      continue;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    if (key && !key.startsWith('-')) {
      fields[key] = value;
      lastTopLevelKey = key;
    }
  }

  return { isValid: true, fields, arrayFields, hasFrontmatter: true, hasClosingMarker: true };
}

/**
 * Returns true if a field is present in frontmatter, including fields with
 * multiline array values (e.g. tools:\n  - Read\n  - Write).
 */
function hasField(result: FrontmatterResult, fieldName: string): boolean {
  return fieldName in result.fields || result.arrayFields.has(fieldName);
}

async function countSkillDirectories(fullPath: string): Promise<number> {
  const entries = await readdir(fullPath, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).length;
}

async function countGuidesDirectories(fullPath: string): Promise<number> {
  const entries = await readdir(fullPath, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).length;
}

async function countHooksFiles(fullPath: string): Promise<number> {
  const entries = await readdir(fullPath, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).length;
}

async function countOntologyFiles(fullPath: string): Promise<number> {
  const entries = await readdir(fullPath, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (entry.isFile()) {
      count++;
    } else if (entry.isDirectory()) {
      const subEntries = await readdir(join(fullPath, entry.name), { withFileTypes: true });
      count += subEntries.filter((e) => e.isFile()).length;
    }
  }
  return count;
}

async function countMdFiles(fullPath: string): Promise<number> {
  const entries = await readdir(fullPath, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith('.md')).length;
}

async function listMarkdownFiles(fullPath: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(fullPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = join(fullPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(absolutePath, relativePath)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relativePath);
    }
  }

  return files;
}

async function countActualFiles(componentPath: string, componentName: string): Promise<number> {
  let fullPath = join(TEMPLATES_DIR, componentPath);

  try {
    await access(fullPath);
  } catch {
    if (componentPath.startsWith('.codex/')) {
      fullPath = join(TEMPLATES_DIR, componentPath.replace('.codex/', '.claude/'));
    } else if (componentName === 'skills' && componentPath.startsWith('.agents/')) {
      fullPath = join(TEMPLATES_DIR, componentPath.replace('.agents/', '.claude/'));
    }
  }

  if (componentName === 'skills') return countSkillDirectories(fullPath);
  if (componentName === 'guides') return countGuidesDirectories(fullPath);
  if (componentName === 'hooks') return countHooksFiles(fullPath);
  if (componentName === 'ontology') return countOntologyFiles(fullPath);

  // Default: count only .md files to exclude metadata files like index.yaml
  return countMdFiles(fullPath);
}

async function validateSkillFrontmatter(
  skillDir: string,
  skillsDir: string,
  errors: string[]
): Promise<void> {
  const skillFilePath = join(skillsDir, skillDir, 'SKILL.md');
  let content: string;

  try {
    content = await readFile(skillFilePath, 'utf-8');
  } catch {
    errors.push(`${skillDir}/SKILL.md: file not found`);
    return;
  }

  const result = parseFrontmatter(content);

  if (!result.hasFrontmatter) {
    errors.push(`${skillDir}/SKILL.md: missing frontmatter opening marker`);
    return;
  }

  if (!result.hasClosingMarker) {
    errors.push(`${skillDir}/SKILL.md: missing frontmatter closing marker`);
    return;
  }

  if (!result.fields.name) {
    errors.push(`${skillDir}/SKILL.md: missing required field 'name'`);
  }

  if (!result.fields.description) {
    errors.push(`${skillDir}/SKILL.md: missing required field 'description'`);
  }
}

async function validateAgentFrontmatter(
  agentFile: string,
  agentsDir: string,
  errors: string[]
): Promise<void> {
  const agentFilePath = join(agentsDir, agentFile);
  const content = await readFile(agentFilePath, 'utf-8');
  const result = parseFrontmatter(content);

  if (!result.hasFrontmatter) {
    errors.push(`${agentFile}: missing frontmatter opening marker`);
    return;
  }

  if (!result.hasClosingMarker) {
    errors.push(`${agentFile}: missing frontmatter closing marker`);
    return;
  }

  const requiredFields = ['name', 'description', 'model', 'tools'];
  for (const field of requiredFields) {
    // tools may be a multiline array (tools:\n  - Read), so use hasField
    if (!hasField(result, field)) {
      errors.push(`${agentFile}: missing required field '${field}'`);
    }
  }
}

describe('Template Validation', () => {
  describe('Codex-native guidance', () => {
    it('keeps live operator surfaces off the parent omcustom command', async () => {
      const paths = [
        'workflows/templates/custom-docs.yaml',
        'templates/deprecated-files.json',
        '.codex/ontology/skills.yaml',
        'templates/.claude/ontology/skills.yaml',
        'templates/.claude/ontology/rules.yaml',
        'plugins/oh-my-customcodex/ontology/skills.yaml',
      ];

      for (const relativePath of paths) {
        const content = await readFile(join(PROJECT_ROOT, relativePath), 'utf8');
        expect(content).not.toMatch(/(^|[^A-Za-z0-9_.-])omcustom(?=$|[^A-Za-z0-9_.-])/m);
      }
      expect(await readFile(join(PROJECT_ROOT, paths[0]), 'utf8')).toContain(
        'skill: omcustomcodex:update-docs'
      );
      expect(await readFile(join(PROJECT_ROOT, paths[1]), 'utf8')).toContain(
        'during omcustomcodex update'
      );
    });

    it('uses explicit skill invocation and distinguishes both policy file formats', async () => {
      const guidanceFiles = [
        'README.md',
        'README_ko.md',
        'templates/AGENTS.md.en',
        'templates/AGENTS.md.ko',
      ];

      for (const relativePath of guidanceFiles) {
        const content = await readFile(join(PROJECT_ROOT, relativePath), 'utf-8');
        expect(content).toContain('$dev-review');
        expect(content).toContain('/skills');
        expect(content).not.toContain('`/dev-review`');
      }

      for (const relativePath of [
        'templates/AGENTS.md.en',
        'templates/AGENTS.md.ko',
        'docs/reference/rules.md',
      ]) {
        const content = await readFile(join(PROJECT_ROOT, relativePath), 'utf-8');
        expect(content).toContain('.codex/rules/*.md');
        expect(content).toContain('.codex/rules/*.rules');
        expect(content).toMatch(/Starlark/);
      }
    });

    it('documents the R009 harness soft and hard limits separately from native capacity', async () => {
      for (const relativePath of [
        'README.md',
        'templates/AGENTS.md.en',
        'templates/CLAUDE.md.en',
      ]) {
        const content = await readFile(join(PROJECT_ROOT, relativePath), 'utf-8');
        expect(content).toMatch(/harness soft\/default[\s\S]{0,80}4/i);
        expect(content).toMatch(/hard cap[\s\S]{0,40}5/i);
        expect(content).toMatch(/Codex\/OMX native capacity[\s\S]{0,80}runtime-defined/i);
      }

      for (const relativePath of [
        'README_ko.md',
        'templates/AGENTS.md.ko',
        'templates/CLAUDE.md',
        'templates/CLAUDE.md.ko',
      ]) {
        const content = await readFile(join(PROJECT_ROOT, relativePath), 'utf-8');
        expect(content).toMatch(/하네스 soft\/default[\s\S]{0,80}4/i);
        expect(content).toMatch(/hard cap[\s\S]{0,40}5/i);
        expect(content).toMatch(/Codex\/OMX native capacity[\s\S]{0,80}런타임/i);
      }
    });

    it('keeps the public rule priority split aligned with the 23-rule inventory', async () => {
      for (const relativePath of ['README.md', 'README_ko.md']) {
        const content = await readFile(join(PROJECT_ROOT, relativePath), 'utf-8');
        expect(content).toMatch(/\|\s*\*\*MUST\*\*\s*\|\s*14\s*\|/);
        expect(content).toMatch(/\|\s*\*\*SHOULD\*\*\s*\|\s*8\s*\|/);
        expect(content).toMatch(/\|\s*\*\*MAY\*\*\s*\|\s*1\s*\|/);
      }
    });

    it('keeps the tracked ontology launcher on the Codex-native directory', async () => {
      const mcpConfig = JSON.parse(await readFile(join(PROJECT_ROOT, '.mcp.json'), 'utf-8')) as {
        mcpServers: { 'ontology-rag': { env: { ONTOLOGY_DIR: string } } };
      };

      expect(mcpConfig.mcpServers['ontology-rag'].env.ONTOLOGY_DIR).toBe('.codex/ontology');
    });

    it('uses OMX HUD and the native Codex footer as the active status surfaces', async () => {
      for (const relativePath of [
        '.codex/rules/SHOULD-hud-statusline.md',
        'templates/.claude/rules/SHOULD-hud-statusline.md',
      ]) {
        const content = await readFile(join(PROJECT_ROOT, relativePath), 'utf-8');
        expect(content).toContain('omx hud');
        expect(content).toContain('/statusline');
        expect(content).toContain('[tui].status_line');
        expect(content).not.toContain('Config in `.codex/settings.local.json`');
        expect(content).not.toContain('Internal statusline (`.codex/statusline.sh`)');
      }
    });
  });

  describe('Manifest consistency', () => {
    it('should have a valid manifest.json with required fields', async () => {
      const manifestPath = join(TEMPLATES_DIR, 'manifest.json');
      const content = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as Manifest;

      expect(manifest.version).toBeDefined();
      expect(typeof manifest.version).toBe('string');
      expect(manifest.components).toBeDefined();
      expect(Array.isArray(manifest.components)).toBe(true);
      expect(manifest.components.length).toBeGreaterThan(0);
      expect(manifest.source).toBeDefined();
    });

    it('should have files count matching actual rules directory', async () => {
      const manifestPath = join(TEMPLATES_DIR, 'manifest.json');
      const content = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as Manifest;

      const rulesComponent = manifest.components.find((c) => c.name === 'rules');
      expect(rulesComponent).toBeDefined();

      const actualCount = await countActualFiles(rulesComponent?.path ?? '', 'rules');
      expect(actualCount).toBe(rulesComponent?.files);
    });

    it('should have files count matching actual agents directory', async () => {
      const manifestPath = join(TEMPLATES_DIR, 'manifest.json');
      const content = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as Manifest;

      const agentsComponent = manifest.components.find((c) => c.name === 'agents');
      expect(agentsComponent).toBeDefined();

      const actualCount = await countActualFiles(agentsComponent?.path ?? '', 'agents');
      expect(actualCount).toBe(agentsComponent?.files);
    });

    it('should have files count matching actual skills directory', async () => {
      const manifestPath = join(TEMPLATES_DIR, 'manifest.json');
      const content = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as Manifest;

      const skillsComponent = manifest.components.find((c) => c.name === 'skills');
      expect(skillsComponent).toBeDefined();

      const actualCount = await countActualFiles(skillsComponent?.path ?? '', 'skills');
      expect(actualCount).toBe(skillsComponent?.files);
    });

    it('should have files count matching actual guides directory', async () => {
      const manifestPath = join(TEMPLATES_DIR, 'manifest.json');
      const content = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as Manifest;

      const guidesComponent = manifest.components.find((c) => c.name === 'guides');
      expect(guidesComponent).toBeDefined();

      const actualCount = await countActualFiles(guidesComponent?.path ?? '', 'guides');
      expect(actualCount).toBe(guidesComponent?.files);
    });

    it('should keep guide counts in docs matching actual guide directories', async () => {
      const sourceGuideCount = await countGuidesDirectories(join(PROJECT_ROOT, 'guides'));
      const templateGuideCount = await countGuidesDirectories(join(TEMPLATES_DIR, 'guides'));

      expect(sourceGuideCount).toBe(templateGuideCount);

      const readme = await readFile(join(PROJECT_ROOT, 'README.md'), 'utf-8');
      expect(readme).toContain(`### Guides (${sourceGuideCount})`);
      expect(readme).toContain(`# ${sourceGuideCount} reference documents`);

      const entryDocs = [
        ['templates/AGENTS.md.en', `Reference docs (${templateGuideCount} topics)`],
        ['templates/AGENTS.md.ko', `레퍼런스 문서 (${templateGuideCount} 토픽)`],
        ['templates/CLAUDE.md', `레퍼런스 문서 (${templateGuideCount} 토픽)`],
        ['templates/CLAUDE.md.en', `Reference docs (${templateGuideCount} topics)`],
        ['templates/CLAUDE.md.ko', `레퍼런스 문서 (${templateGuideCount} 토픽)`],
        ['templates/README.md', `reference docs (${templateGuideCount} topics)`],
      ];

      for (const [relativePath, expectedText] of entryDocs) {
        const doc = await readFile(join(PROJECT_ROOT, relativePath), 'utf-8');
        expect(doc).toContain(expectedText);
      }
    });

    it('should have files count matching actual hooks directory', async () => {
      const manifestPath = join(TEMPLATES_DIR, 'manifest.json');
      const content = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as Manifest;

      const hooksComponent = manifest.components.find((c) => c.name === 'hooks');
      expect(hooksComponent).toBeDefined();

      const actualCount = await countActualFiles(hooksComponent?.path ?? '', 'hooks');
      expect(actualCount).toBe(hooksComponent?.files);
    });

    it('should have files count matching actual contexts directory', async () => {
      const manifestPath = join(TEMPLATES_DIR, 'manifest.json');
      const content = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as Manifest;

      const contextsComponent = manifest.components.find((c) => c.name === 'contexts');
      expect(contextsComponent).toBeDefined();

      const actualCount = await countActualFiles(contextsComponent?.path ?? '', 'contexts');
      expect(actualCount).toBe(contextsComponent?.files);
    });

    it('each manifest component should have required fields', async () => {
      const manifestPath = join(TEMPLATES_DIR, 'manifest.json');
      const content = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as Manifest;

      for (const component of manifest.components) {
        expect(component.name).toBeDefined();
        expect(typeof component.name).toBe('string');
        expect(component.path).toBeDefined();
        expect(typeof component.path).toBe('string');
        expect(component.files).toBeDefined();
        expect(typeof component.files).toBe('number');
        expect(component.files).toBeGreaterThan(0);
      }
    });
  });

  describe('Skill frontmatter', () => {
    it('packages Visual Ralph and Visual Verdict as mirrored skills', async () => {
      const skillsDir = join(TEMPLATES_DIR, '.claude/skills');

      for (const skillName of ['visual-ralph', 'visual-verdict']) {
        const content = await readFile(join(skillsDir, skillName, 'SKILL.md'), 'utf-8');
        expect(content).toContain(`name: ${skillName}`);
      }
    });

    it('every SKILL.md should have valid YAML frontmatter', async () => {
      const skillsDir = join(TEMPLATES_DIR, '.claude/skills');
      const skillDirs = await readdir(skillsDir, { withFileTypes: true });
      const skillDirectories = skillDirs.filter((e) => e.isDirectory()).map((e) => e.name);

      expect(skillDirectories.length).toBeGreaterThan(0);

      const errors: string[] = [];

      for (const skillDir of skillDirectories) {
        await validateSkillFrontmatter(skillDir, skillsDir, errors);
      }

      expect(errors).toEqual([]);
    });

    it('skill name field should be non-empty string', async () => {
      const skillsDir = join(TEMPLATES_DIR, '.claude/skills');
      const skillDirs = await readdir(skillsDir, { withFileTypes: true });
      const skillDirectories = skillDirs.filter((e) => e.isDirectory()).map((e) => e.name);

      for (const skillDir of skillDirectories) {
        const skillFilePath = join(skillsDir, skillDir, 'SKILL.md');
        let content: string;

        try {
          content = await readFile(skillFilePath, 'utf-8');
        } catch {
          continue;
        }

        const result = parseFrontmatter(content);

        if (result.isValid && result.fields.name !== undefined) {
          expect(result.fields.name.length).toBeGreaterThan(0);
        }
      }
    });

    it('skill description field should be non-empty string', async () => {
      const skillsDir = join(TEMPLATES_DIR, '.claude/skills');
      const skillDirs = await readdir(skillsDir, { withFileTypes: true });
      const skillDirectories = skillDirs.filter((e) => e.isDirectory()).map((e) => e.name);

      for (const skillDir of skillDirectories) {
        const skillFilePath = join(skillsDir, skillDir, 'SKILL.md');
        let content: string;

        try {
          content = await readFile(skillFilePath, 'utf-8');
        } catch {
          continue;
        }

        const result = parseFrontmatter(content);

        if (result.isValid && result.fields.description !== undefined) {
          expect(result.fields.description.length).toBeGreaterThan(0);
        }
      }
    });

    it('packages loop-detection middleware as a harness skill', async () => {
      const skillPath = join(TEMPLATES_DIR, '.claude/skills/loop-detection-middleware/SKILL.md');
      const content = await readFile(skillPath, 'utf-8');

      expect(content).toContain('name: loop-detection-middleware');
      expect(content).toContain('scope: harness');
      expect(content).toContain('Same error text or hash repeats');
      expect(content).toContain('same-file edit loops');
    });
  });

  describe('Agent frontmatter', () => {
    it('keeps the npm expert on canonical omcustomcodex skill names', async () => {
      const sourcePath = join(PROJECT_ROOT, '.codex/agents/tool-npm-expert.md');
      const templatePath = join(TEMPLATES_DIR, '.claude/agents/tool-npm-expert.md');
      const [source, template] = await Promise.all([
        readFile(sourcePath, 'utf8'),
        readFile(templatePath, 'utf8'),
      ]);

      for (const content of [source, template]) {
        expect(content).toContain('omcustomcodex:npm-audit');
        expect(content).toContain('omcustomcodex:npm-publish');
        expect(content).toContain('omcustomcodex:npm-version');
        expect(content).not.toMatch(/^\s*-\s+omcodex:npm-/m);
      }
    });

    it('packages Scholastic as a mirrored ontology reviewer agent', async () => {
      const projectRoot = resolve(import.meta.dir, '../../..');
      const agentPath = '.codex/agents/scholastic.md';
      const templateAgentPath = '.claude/agents/scholastic.md';
      const sourceAgent = await readFile(join(projectRoot, agentPath), 'utf-8');
      const templateAgent = await readFile(join(TEMPLATES_DIR, templateAgentPath), 'utf-8');
      const reference = await readFile(join(projectRoot, 'docs/reference/agents.md'), 'utf-8');

      expect(templateAgent).not.toBe(sourceAgent);
      expect(templateAgent).toContain('model: sonnet');
      expect(sourceAgent).toContain('model_lane: frontier');
      expect(sourceAgent).toContain('model_reasoning_effort: high');
      expect(sourceAgent).toContain('name: scholastic');
      expect(sourceAgent).toContain('Ontology-first reasoning reviewer');
      expect(reference).toContain('### scholastic');
      expect(reference).toContain('category mistakes');
    });

    it('every agent .md file should have valid YAML frontmatter', async () => {
      const agentsDir = join(TEMPLATES_DIR, '.claude/agents');
      const agentFiles = (await readdir(agentsDir, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);

      expect(agentFiles.length).toBeGreaterThan(0);

      const errors: string[] = [];

      for (const agentFile of agentFiles) {
        await validateAgentFrontmatter(agentFile, agentsDir, errors);
      }

      expect(errors).toEqual([]);
    });

    it('agent model field should be a valid model value', async () => {
      const validModels = new Set(['sonnet', 'opus', 'haiku', 'inherit']);
      const agentsDir = join(TEMPLATES_DIR, '.claude/agents');
      const agentFiles = (await readdir(agentsDir, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);

      const errors: string[] = [];

      for (const agentFile of agentFiles) {
        const agentFilePath = join(agentsDir, agentFile);
        const content = await readFile(agentFilePath, 'utf-8');
        const result = parseFrontmatter(content);

        if (result.isValid && result.fields.model) {
          const model = result.fields.model.trim();
          if (!validModels.has(model)) {
            errors.push(
              `${agentFile}: invalid model '${model}' (must be one of: ${[...validModels].join(', ')})`
            );
          }
        }
      }

      expect(errors).toEqual([]);
    });

    it('agent name field should match filename without extension', async () => {
      const agentsDir = join(TEMPLATES_DIR, '.claude/agents');
      const agentFiles = (await readdir(agentsDir, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);

      const errors: string[] = [];

      for (const agentFile of agentFiles) {
        const agentFilePath = join(agentsDir, agentFile);
        const content = await readFile(agentFilePath, 'utf-8');
        const result = parseFrontmatter(content);

        if (result.isValid && result.fields.name) {
          const expectedName = agentFile.replace(/\.md$/, '');
          const actualName = result.fields.name.trim();
          if (actualName !== expectedName) {
            errors.push(
              `${agentFile}: name field '${actualName}' does not match filename '${expectedName}'`
            );
          }
        }
      }

      expect(errors).toEqual([]);
    });
  });

  describe('README count sync', () => {
    it('README.md agent count should match actual template agent files', async () => {
      const readmePath = resolve(import.meta.dir, '../../../README.md');
      const readmeContent = await readFile(readmePath, 'utf-8');

      // Match "### Agents (42)" or "| **Total** | **42** |" patterns
      const agentsHeaderMatch = readmeContent.match(/###\s+Agents\s+\((\d+)\)/);
      expect(agentsHeaderMatch).not.toBeNull();

      const readmeAgentCount = parseInt(agentsHeaderMatch?.[1] ?? '0', 10);

      const agentsDir = join(TEMPLATES_DIR, '.claude/agents');
      const agentFiles = (await readdir(agentsDir, { withFileTypes: true })).filter(
        (e) => e.isFile() && e.name.endsWith('.md')
      );

      expect(agentFiles.length).toBe(readmeAgentCount);
    });

    it('README.md skill count should match actual template skill directories', async () => {
      const readmePath = resolve(import.meta.dir, '../../../README.md');
      const readmeContent = await readFile(readmePath, 'utf-8');

      // Match "### Skills (56)" pattern
      const skillsHeaderMatch = readmeContent.match(/###\s+Skills\s+\((\d+)\)/);
      expect(skillsHeaderMatch).not.toBeNull();

      const readmeSkillCount = parseInt(skillsHeaderMatch?.[1] ?? '0', 10);

      const skillsDir = join(TEMPLATES_DIR, '.claude/skills');
      const skillDirs = (await readdir(skillsDir, { withFileTypes: true })).filter((e) =>
        e.isDirectory()
      );

      expect(skillDirs.length).toBe(readmeSkillCount);
    });

    it('README.md rules count should match actual template rules files', async () => {
      const readmePath = resolve(import.meta.dir, '../../../README.md');
      const readmeContent = await readFile(readmePath, 'utf-8');

      // Match the explicitly labeled harness behavioral policy count.
      const rulesHeaderMatch = readmeContent.match(/###\s+Harness Behavioral Policies\s+\((\d+)\)/);
      expect(rulesHeaderMatch).not.toBeNull();

      const readmeRulesCount = parseInt(rulesHeaderMatch?.[1] ?? '0', 10);

      const rulesDir = join(TEMPLATES_DIR, '.claude/rules');
      const rulesFiles = (await readdir(rulesDir, { withFileTypes: true })).filter(
        (e) => e.isFile() && e.name.endsWith('.md')
      );

      expect(rulesFiles.length).toBe(readmeRulesCount);
    });

    it('README.md guides count should match actual template guides directories', async () => {
      const readmePath = resolve(import.meta.dir, '../../../README.md');
      const readmeContent = await readFile(readmePath, 'utf-8');

      // Match "### Guides (22)" pattern
      const guidesHeaderMatch = readmeContent.match(/###\s+Guides\s+\((\d+)\)/);
      expect(guidesHeaderMatch).not.toBeNull();

      const readmeGuidesCount = parseInt(guidesHeaderMatch?.[1] ?? '0', 10);

      const guidesDir = join(TEMPLATES_DIR, 'guides');
      const guidesDirs = (await readdir(guidesDir, { withFileTypes: true })).filter((e) =>
        e.isDirectory()
      );

      expect(guidesDirs.length).toBe(readmeGuidesCount);
    });
  });

  describe('Codex init guidance', () => {
    it('keeps deprecated omx explore out of preferred generated guidance', async () => {
      const agentsKo = await readFile(join(TEMPLATES_DIR, 'AGENTS.md.ko'), 'utf-8');
      const agentsEn = await readFile(join(TEMPLATES_DIR, 'AGENTS.md.en'), 'utf-8');

      for (const content of [agentsKo, agentsEn]) {
        expect(content).toContain('omx explore');
        expect(content).toContain('deprecated');
        expect(content).toContain('USE_OMX_EXPLORE_CMD');
        expect(content).toContain('omx sparkshell -- <command>');
      }
    });

    it('does not present Claude Code plugins as required Codex init steps', async () => {
      const initSource = await readFile(
        resolve(import.meta.dir, '../../../src/cli/init.ts'),
        'utf-8'
      );
      const agentsKo = await readFile(join(TEMPLATES_DIR, 'AGENTS.md.ko'), 'utf-8');
      const agentsEn = await readFile(join(TEMPLATES_DIR, 'AGENTS.md.en'), 'utf-8');

      expect(initSource).not.toContain('Required plugins (install manually)');
      expect(initSource).not.toContain('/plugin install superpowers');

      for (const content of [agentsKo, agentsEn]) {
        expect(content).not.toContain('### Required Plugins');
        expect(content).not.toContain('### 필수 플러그인');
        expect(content).not.toContain('/plugin marketplace add obra/superpowers-marketplace');
        expect(content).not.toContain('/plugin install superpowers');
      }
    });
  });

  describe('Claude Code version compatibility guidance', () => {
    it('mirrors the v2.1.139 through v2.1.168 compatibility guide into templates', async () => {
      const projectRoot = resolve(import.meta.dir, '../../..');
      const guidePath = 'guides/claude-code/15-version-compatibility.md';
      const sourceGuide = await readFile(join(projectRoot, guidePath), 'utf-8');
      const templateGuide = await readFile(join(TEMPLATES_DIR, guidePath), 'utf-8');

      expect(templateGuide).toBe(sourceGuide);
      for (const version of [
        'v2.1.139',
        'v2.1.140',
        'v2.1.141',
        'v2.1.142',
        'v2.1.143',
        'v2.1.144',
        'v2.1.145',
        'v2.1.146',
        'v2.1.147',
        'v2.1.148',
        'v2.1.149',
        'v2.1.150',
        'v2.1.152',
        'v2.1.153',
        'v2.1.154',
        'v2.1.156',
        'v2.1.157',
        'v2.1.158',
        'v2.1.166',
        'v2.1.167',
        'v2.1.168',
      ]) {
        expect(templateGuide).toContain(version);
      }
      expect(templateGuide).toContain('continueOnBlock');
      expect(templateGuide).toContain('args: string[]');
      expect(templateGuide).toContain('extraKnownMarketplaces');
      expect(templateGuide).toContain('gh.pr_number');
      expect(templateGuide).toContain('claude agents --json');
      expect(templateGuide).toContain('background_tasks');
      expect(templateGuide).toContain('session_crons');
      expect(templateGuide).toContain('CLAUDE_CODE_SUBAGENT_MODEL');
      expect(templateGuide).toContain('CLAUDE_CODE_WORKFLOWS=1');
      expect(templateGuide).toContain('exit code 127');
      expect(templateGuide).toContain('allowAllClaudeAiMcps');
      expect(templateGuide).toContain('Internal infrastructure improvements only');
      expect(templateGuide).toContain('Do not add a dead `simplify` route');
      expect(templateGuide).toContain('disallowed-tools');
      expect(templateGuide).toContain('reloadSkills');
      expect(templateGuide).toContain('COLUMNS');
      expect(templateGuide).toContain('skipLfs');
      expect(templateGuide).toContain('Opus 4.8');
      expect(templateGuide).toContain('Dynamic Workflows');
      expect(templateGuide).toContain('fallbackModel');
      expect(templateGuide).toContain('MAX_THINKING_TOKENS=0');
      expect(templateGuide).toContain('Cross-session relayed `SendMessage`');
      expect(templateGuide).toContain('deny all tools');
      expect(templateGuide).toContain('Agent tool malformed parsing');
    });

    it('locks the v2.1.202 through v2.1.209 provider-owned compatibility record', async () => {
      const guidePath = 'guides/claude-code/15-version-compatibility.md';
      const sourceGuide = await readFile(join(PROJECT_ROOT, guidePath), 'utf-8');
      const templateGuide = await readFile(join(TEMPLATES_DIR, guidePath), 'utf-8');
      const releaseContracts = [
        {
          version: 'v2.1.202',
          issue: '#1655',
          sha: '7930e1c82d997b013af28673501f3b95569a71cb',
        },
        {
          version: 'v2.1.203',
          issue: '#1654',
          sha: '00ea2924471e5c226e872d42229fbb1dae41f442',
        },
        {
          version: 'v2.1.204',
          issue: '#1653',
          sha: 'd0f5bebd40c098c5913b6419a2ecfc7104f0cd41',
        },
        {
          version: 'v2.1.205',
          issue: '#1652',
          sha: 'be02c39841a59e2ac1f35ac12285def02acdbb5a',
        },
        {
          version: 'v2.1.206',
          issue: '#1651',
          sha: '15a21e1b4e240e2da6a4953d5f148a806c9c9bb2',
        },
        {
          version: 'v2.1.207',
          issue: '#1650',
          sha: 'd4d8fbbb333c627d8fe2c1c583a5ccc26fdb1aed',
        },
        {
          version: 'v2.1.208',
          issue: '#1660',
          sha: '1fb278b85d4546c7c04db3b3590e031b5a8a7571',
        },
        {
          version: 'v2.1.209',
          issue: '#1660',
          sha: '988b3e56432775c09bba903ba22522b97cd0f2fb',
        },
      ];

      expect(templateGuide).toBe(sourceGuide);
      const headingOrder = [
        'v2.1.209',
        'v2.1.208',
        'v2.1.207',
        'v2.1.206',
        'v2.1.205',
        'v2.1.204',
        'v2.1.203',
        'v2.1.202',
        'v2.1.201',
      ].map((heading) => findExactMarkdownH2Index(sourceGuide, heading));
      expect(headingOrder).toEqual([...headingOrder].sort((left, right) => left - right));

      for (const contract of releaseContracts) {
        const section = extractMarkdownH2Section(sourceGuide, contract.version);
        expectContentToContainAll(section, [
          contract.issue,
          `https://github.com/anthropics/claude-code/releases/tag/${contract.version}`,
          contract.sha,
        ]);
        expectProviderDisposition(section);
      }

      expectContentToContainAll(extractMarkdownH2Section(sourceGuide, 'v2.1.206'), [
        '`/commit-push-pr` auto-allows `git push`',
        '`remote.pushDefault`',
        'sole remote',
      ]);

      const ruleContracts = [
        {
          name: 'MAY-optimization.md',
          blocks: [
            {
              marker: 'DETAIL: Claude Code v2.1.206 Context Optimization Compatibility',
              phrases: ['v2.1.206', '/doctor', 'CLAUDE.md'],
            },
            {
              marker: 'DETAIL: Claude Code v2.1.208 Tool Reliability Compatibility',
              phrases: ['v2.1.208', 'scientific notation', 'Edit', 'Read', 'Grep', 'Glob'],
            },
          ],
        },
        {
          name: 'MUST-agent-design.md',
          blocks: [
            {
              marker: 'DETAIL: Claude Code v2.1.204 Headless SessionStart Compatibility',
              phrases: ['v2.1.204', 'SessionStart', 'headless'],
            },
            {
              marker: 'DETAIL: Claude Code v2.1.208 Agent Tool Validation Compatibility',
              phrases: ['v2.1.208', 'tools:', 'unrecognized'],
            },
          ],
        },
        {
          name: 'MUST-agent-teams.md',
          blocks: [
            {
              marker: 'DETAIL: Claude Code v2.1.202 Agent Teams Sizing Compatibility',
              phrases: ['v2.1.202', 'Dynamic workflow size', 'advisory'],
            },
          ],
        },
        {
          name: 'MUST-orchestrator-coordination.md',
          blocks: [
            {
              marker: 'DETAIL: Claude Code v2.1.206 Git Remote Compatibility',
              phrases: [
                'v2.1.206',
                '`/commit-push-pr` auto-allows `git push`',
                'remote.pushDefault',
                'sole remote',
              ],
            },
            {
              marker: 'DETAIL: Claude Code v2.1.208-v2.1.209 Background Agent Compatibility',
              phrases: ['v2.1.208', 'CLAUDE_CODE_PROCESS_WRAPPER', 'v2.1.209', '/model'],
            },
          ],
        },
        {
          name: 'MUST-parallel-execution.md',
          blocks: [
            {
              marker: 'DETAIL: Claude Code v2.1.202 Dynamic Workflow Size Compatibility',
              phrases: ['v2.1.202', 'Dynamic workflow size', 'advisory'],
            },
          ],
        },
        {
          name: 'MUST-permissions.md',
          blocks: [
            {
              marker: 'DETAIL: Claude Code v2.1.203-v2.1.208 Permission Compatibility',
              phrases: ['v2.1.203', 'footer', 'v2.1.207', 'disableAutoMode', 'v2.1.208', 'matcher'],
            },
          ],
        },
        {
          name: 'MUST-safety.md',
          blocks: [
            {
              marker: 'DETAIL: Claude Code v2.1.205-v2.1.208 Destructive-Command Compatibility',
              phrases: ['v2.1.205', 'transcript', 'v2.1.208', 'subshell'],
            },
          ],
        },
        {
          name: 'SHOULD-hud-statusline.md',
          blocks: [
            {
              marker: 'DETAIL: Claude Code v2.1.202-v2.1.208 Status Compatibility',
              phrases: ['v2.1.202', 'workflow.run_id', 'v2.1.208', '/tasks'],
            },
          ],
        },
      ];

      for (const contract of ruleContracts) {
        const sourceRule = await readFile(
          join(PROJECT_ROOT, '.codex/rules', contract.name),
          'utf-8'
        );
        const templateRule = await readFile(
          join(TEMPLATES_DIR, '.claude/rules', contract.name),
          'utf-8'
        );

        expect(templateRule).toBe(sourceRule);
        for (const blockContract of contract.blocks) {
          const detailBlock = extractSingleHtmlCommentContaining(sourceRule, blockContract.marker);
          expectContentToContainAll(detailBlock, blockContract.phrases);
          expectProviderContrast(detailBlock);
        }
      }

      const wikiContracts = [
        {
          path: 'wiki/guides/claude-code.md',
          markers: ['v2.1.202', 'v2.1.209', 'Codex/OMX'],
        },
        {
          path: 'wiki/rules/r001.md',
          markers: ['v2.1.205', 'transcript', 'v2.1.208', 'subshell'],
        },
        {
          path: 'wiki/rules/r002.md',
          markers: ['v2.1.203', 'Manual', 'v2.1.207', 'disableAutoMode', 'v2.1.208'],
        },
        {
          path: 'wiki/rules/r005.md',
          markers: ['v2.1.206', 'CLAUDE.md', 'v2.1.208', 'scientific notation'],
        },
        {
          path: 'wiki/rules/r006.md',
          markers: ['v2.1.204', 'SessionStart', 'v2.1.208', 'unrecognized'],
        },
        {
          path: 'wiki/rules/r009.md',
          markers: ['v2.1.202', 'Dynamic workflow size', 'advisory'],
        },
        {
          path: 'wiki/rules/r010.md',
          markers: [
            'v2.1.206',
            '`/commit-push-pr` auto-allows `git push`',
            'remote.pushDefault',
            'v2.1.208',
            'CLAUDE_CODE_PROCESS_WRAPPER',
            'v2.1.209',
          ],
        },
        {
          path: 'wiki/rules/r012.md',
          markers: ['v2.1.202', 'workflow.run_id', 'v2.1.208', '/tasks'],
        },
        {
          path: 'wiki/rules/r018.md',
          markers: ['v2.1.202', 'Dynamic workflow size', 'advisory'],
        },
      ];

      for (const contract of wikiContracts) {
        const wiki = await readFile(join(PROJECT_ROOT, contract.path), 'utf-8');
        expectContentToContainAll(wiki, contract.markers);
      }

      const optimizationWiki = await readFile(join(PROJECT_ROOT, 'wiki/rules/r005.md'), 'utf-8');
      expect(optimizationWiki).toContain('.codex/rules/MAY-optimization.md');
      expect(optimizationWiki).not.toContain('.claude/rules/MAY-optimization.md');
    });

    it('locks the v2.1.210 provider-owned compatibility record', async () => {
      const guidePath = 'guides/claude-code/15-version-compatibility.md';
      const sourceGuide = await readFile(join(PROJECT_ROOT, guidePath), 'utf-8');
      const templateGuide = await readFile(join(TEMPLATES_DIR, guidePath), 'utf-8');
      const v210Section = extractMarkdownH2Section(sourceGuide, 'v2.1.210');

      expect(templateGuide).toBe(sourceGuide);
      expect(findExactMarkdownH2Index(sourceGuide, 'v2.1.210')).toBeLessThan(
        findExactMarkdownH2Index(sourceGuide, 'v2.1.209')
      );
      expectContentToContainAll(v210Section, [
        '#1673',
        'https://github.com/anthropics/claude-code/releases/tag/v2.1.210',
        'b7784f2c63ed4585c32bc20b94d3b64cf4fe6df3',
        'Write(path)',
        'auto-background',
        '$1',
        'MEMORY.md',
        'hook callback timeout',
      ]);
      expectProviderDisposition(v210Section);

      const ruleContracts = [
        {
          name: 'MUST-permissions.md',
          marker: 'DETAIL: Claude Code v2.1.210 Permission Matcher Compatibility',
          phrases: ['Write(path)', 'NotebookEdit(path)', 'Glob(path)', 'Edit(path)', 'Read(path)'],
        },
        {
          name: 'MAY-optimization.md',
          marker: 'DETAIL: Claude Code v2.1.210 Auto-Background and Grep Compatibility',
          phrases: [
            'auto-background',
            'working directory',
            'Grep content mode',
            'No matches found',
          ],
        },
        {
          name: 'MUST-agent-design.md',
          marker: 'DETAIL: Claude Code v2.1.210 Positional Placeholder Compatibility',
          phrases: ['unmatched positional placeholders', '$1', '$2', 'verbatim', '$ARGUMENTS'],
        },
        {
          name: 'SHOULD-memory-integration.md',
          marker: 'DETAIL: Claude Code v2.1.210 Memory Read-Limit Compatibility',
          phrases: ['MEMORY.md', 'read limit', 'explicit error', 'archive', 'retry'],
        },
        {
          name: 'MUST-enforcement-policy.md',
          marker: 'DETAIL: Claude Code v2.1.210 Hook Timeout Compatibility',
          phrases: ['hook callback timeout', 'user rejection', 'phantom rejection', 'fail-closed'],
        },
      ];

      for (const contract of ruleContracts) {
        const sourceRule = await readFile(
          join(PROJECT_ROOT, '.codex/rules', contract.name),
          'utf-8'
        );
        const templateRule = await readFile(
          join(TEMPLATES_DIR, '.claude/rules', contract.name),
          'utf-8'
        );
        const detailBlock = extractSingleHtmlCommentContaining(sourceRule, contract.marker);

        expect(templateRule).toBe(sourceRule);
        expectContentToContainAll(detailBlock, ['Claude Code v2.1.210', ...contract.phrases]);
        expectProviderDisposition(detailBlock);
      }

      const wikiContracts = [
        {
          path: 'wiki/guides/claude-code.md',
          markers: ['v2.1.210', '#1673', 'provider-owned', 'Codex/OMX'],
        },
        {
          path: 'wiki/rules/r002.md',
          markers: ['v2.1.210', 'Write(path)', 'Edit(path)', 'Read(path)', 'Codex/OMX'],
        },
        {
          path: 'wiki/rules/r005.md',
          markers: ['v2.1.210', 'auto-background', 'absolute paths', 'Grep content mode'],
        },
        {
          path: 'wiki/rules/r006.md',
          markers: ['v2.1.210', '$1', '$2', 'verbatim', '$ARGUMENTS'],
        },
        {
          path: 'wiki/rules/r011.md',
          markers: ['v2.1.210', 'MEMORY.md', 'read limit', 'archive', 'retry'],
        },
        {
          path: 'wiki/rules/r021.md',
          markers: ['v2.1.210', 'hook callback timeout', 'phantom rejection', 'fail-closed'],
        },
      ];

      for (const contract of wikiContracts) {
        const wiki = await readFile(join(PROJECT_ROOT, contract.path), 'utf-8');
        expectContentToContainAll(wiki, contract.markers);
      }
    });

    it('locks the v2.1.211, v2.1.212, and v2.1.214 provider-owned compatibility record', async () => {
      const guidePath = 'guides/claude-code/15-version-compatibility.md';
      const sourceGuide = await readFile(join(PROJECT_ROOT, guidePath), 'utf-8');
      const templateGuide = await readFile(join(TEMPLATES_DIR, guidePath), 'utf-8');
      const releaseContracts = [
        {
          version: 'v2.1.214',
          sha: '07dcb0e13580b21174ff1bf6a7e1d5ead3b61d60',
          phrases: ['dir/**', '**/dir/**', 'deny', 'ask', 'exit code 2'],
        },
        {
          version: 'v2.1.212',
          sha: '67f390c9a0b1440d369aebe2ff6a5023db35bf8e',
          phrases: ['MCP', 'CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS', 'mode', 'parent'],
        },
        {
          version: 'v2.1.211',
          sha: 'c39cb0f14bfe8bb519bae5bfc55add6867c5e2ab',
          phrases: ['background agent', 'fabricating', 'PreToolUse', 'ask'],
        },
      ];

      expect(templateGuide).toBe(sourceGuide);
      const headingOrder = ['v2.1.214', 'v2.1.212', 'v2.1.211', 'v2.1.210'].map((heading) =>
        findExactMarkdownH2Index(sourceGuide, heading)
      );
      expect(headingOrder).toEqual([...headingOrder].sort((left, right) => left - right));

      for (const contract of releaseContracts) {
        const section = extractMarkdownH2Section(sourceGuide, contract.version);
        expectContentToContainAll(section, [
          '#1688',
          `https://github.com/anthropics/claude-code/releases/tag/${contract.version}`,
          contract.sha,
          ...contract.phrases,
        ]);
        expectProviderDisposition(section);
      }

      const ruleContracts = [
        {
          name: 'MAY-optimization.md',
          marker: 'DETAIL: Claude Code v2.1.212 MCP Auto-Background Compatibility',
          phrases: ['MCP', '2 minutes', 'CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS'],
        },
        {
          name: 'MUST-agent-design.md',
          marker: 'DETAIL: Claude Code v2.1.212 Agent Permission Inheritance Compatibility',
          phrases: ['mode', 'deprecated', 'parent session'],
        },
        {
          name: 'MUST-completion-verification.md',
          marker: 'DETAIL: Claude Code v2.1.211 Background Agent Completion Compatibility',
          phrases: ['background agent', 'real completion', 'fabricating results'],
        },
        {
          name: 'MUST-enforcement-policy.md',
          marker: 'DETAIL: Claude Code v2.1.211-v2.1.214 Hook Enforcement Compatibility',
          phrases: ['PreToolUse', 'ask', 'continue:false', 'exit code 2'],
        },
        {
          name: 'MUST-orchestrator-coordination.md',
          marker: 'DETAIL: Claude Code v2.1.212 Delegated Permission Compatibility',
          phrases: ['mode', 'deprecated', 'parent session'],
        },
        {
          name: 'MUST-permissions.md',
          marker: 'DETAIL: Claude Code v2.1.212-v2.1.214 Permission Compatibility',
          phrases: ['mode', 'dir/**', '**/dir/**', 'deny', 'ask'],
        },
      ];

      for (const contract of ruleContracts) {
        const sourceRule = await readFile(
          join(PROJECT_ROOT, '.codex/rules', contract.name),
          'utf-8'
        );
        const templateRule = await readFile(
          join(TEMPLATES_DIR, '.claude/rules', contract.name),
          'utf-8'
        );
        const detailBlock = extractSingleHtmlCommentContaining(sourceRule, contract.marker);

        expect(templateRule).toBe(sourceRule);
        expectContentToContainAll(detailBlock, contract.phrases);
        expectProviderDisposition(detailBlock);
      }

      const agentDesign = await readFile(
        join(PROJECT_ROOT, '.codex/rules/MUST-agent-design.md'),
        'utf-8'
      );
      const orchestrator = await readFile(
        join(PROJECT_ROOT, '.codex/rules/MUST-orchestrator-coordination.md'),
        'utf-8'
      );
      expectContentToContainAll(agentDesign, [
        'Before Claude Code v2.1.212',
        'v2.1.212+ deprecates and ignores',
        'inherits the parent session permission mode',
      ]);
      expectContentToContainAll(orchestrator, [
        'Before Claude Code v2.1.212',
        'Claude Code v2.1.212+ ignores the per-call field',
        'inherits the parent session permission mode',
      ]);

      const parallelRule = await readFile(
        join(PROJECT_ROOT, '.codex/rules/MUST-parallel-execution.md'),
        'utf-8'
      );
      const completionRule = await readFile(
        join(PROJECT_ROOT, '.codex/rules/MUST-completion-verification.md'),
        'utf-8'
      );
      expectContentToContainAll(parallelRule, [
        'Verify-Bash + action-delegate asymmetry',
        'SAME message',
        'verification Bash',
        'action delegate',
      ]);
      expectContentToContainAll(completionRule, [
        'CI Job Conclusion vs Actual Execution',
        'full_ci=false',
        'Report documentation-only fast path',
        'duration',
        'step log',
      ]);

      const wikiContracts = [
        {
          path: 'wiki/guides/claude-code.md',
          markers: ['v2.1.211', 'v2.1.212', 'v2.1.214', '#1688', 'Codex/OMX'],
        },
        {
          path: 'wiki/rules/r002.md',
          markers: ['v2.1.212', 'mode', 'v2.1.214', 'dir/**', 'deny', 'ask'],
        },
        {
          path: 'wiki/rules/r005.md',
          markers: ['v2.1.212', 'MCP', 'CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS'],
        },
        {
          path: 'wiki/rules/r006.md',
          markers: ['v2.1.212', 'mode', 'parent session', 'v2.1.214', '**/dir/**'],
        },
        {
          path: 'wiki/rules/r009.md',
          markers: ['Verify-Bash + action-delegate asymmetry', 'SAME message'],
        },
        {
          path: 'wiki/rules/r010.md',
          markers: ['v2.1.212', 'mode', 'parent session'],
        },
        {
          path: 'wiki/rules/r020.md',
          markers: [
            'v2.1.211',
            'background agent',
            'CI Job Conclusion vs Actual Execution',
            'full_ci=false',
          ],
        },
        {
          path: 'wiki/rules/r021.md',
          markers: ['v2.1.211', 'PreToolUse', 'v2.1.212', 'continue:false', 'v2.1.214'],
        },
      ];

      for (const contract of wikiContracts) {
        const wiki = await readFile(join(PROJECT_ROOT, contract.path), 'utf-8');
        expectContentToContainAll(wiki, contract.markers);
      }
    });

    it('mirrors statusline support for native GitHub and agent-count JSON', async () => {
      const projectRoot = resolve(import.meta.dir, '../../..');
      const sourceStatusline = await readFile(join(projectRoot, '.codex/statusline.sh'), 'utf-8');
      const templateStatusline = await readFile(
        join(TEMPLATES_DIR, '.claude/statusline.sh'),
        'utf-8'
      );

      expect(templateStatusline).toBe(sourceStatusline);
      expect(templateStatusline).toContain('.gh.pr_number');
      expect(templateStatusline).toContain('.gh.pr_state');
      expect(templateStatusline).toContain('.agents | type');
      expect(templateStatusline).toContain(`A:\${agent_count}`);
      expect(templateStatusline).toContain(`/tmp/.codex-cost-\${PPID}`);
    });

    it('mirrors systematic-debugging extended phases into templates', async () => {
      const projectRoot = resolve(import.meta.dir, '../../..');
      const skillPath = '.codex/skills/systematic-debugging/SKILL.md';
      const templateSkillPath = '.claude/skills/systematic-debugging/SKILL.md';
      const sourceSkill = await readFile(join(projectRoot, skillPath), 'utf-8');
      const templateSkill = await readFile(join(TEMPLATES_DIR, templateSkillPath), 'utf-8');
      const phaseFiles = [
        'timeline-correlation.md',
        'retry-cache-timeout-audit.md',
        'amplification-detection.md',
        'fault-injection.md',
      ];

      expect(templateSkill).toBe(sourceSkill);
      expect(sourceSkill).toContain('retry/cache/timeout');
      expect(sourceSkill).toContain('Extended Phases');

      for (const file of phaseFiles) {
        const sourcePhase = await readFile(
          join(projectRoot, '.codex/skills/systematic-debugging/phases', file),
          'utf-8'
        );
        const templatePhase = await readFile(
          join(TEMPLATES_DIR, '.claude/skills/systematic-debugging/phases', file),
          'utf-8'
        );

        expect(templatePhase).toBe(sourcePhase);
      }
    });

    it('keeps formal Korean and completion rules mirrored into templates', async () => {
      const projectRoot = resolve(import.meta.dir, '../../..');
      const mirroredRules = [
        'MUST-permissions.md',
        'MUST-agent-teams.md',
        'MUST-safety.md',
        'MAY-optimization.md',
        'MUST-language-policy.md',
        'MUST-agent-identification.md',
        'MUST-intent-transparency.md',
        'MUST-continuous-improvement.md',
        'MUST-completion-verification.md',
        'MUST-sync-verification.md',
        'MUST-agent-design.md',
        'MUST-orchestrator-coordination.md',
        'MUST-parallel-execution.md',
        'MUST-tool-identification.md',
        'SHOULD-hud-statusline.md',
        'SHOULD-memory-integration.md',
        'SHOULD-verification-ladder.md',
      ];

      for (const ruleName of mirroredRules) {
        const sourceRule = await readFile(join(projectRoot, '.codex/rules', ruleName), 'utf-8');
        const templateRule = await readFile(
          join(TEMPLATES_DIR, '.claude/rules', ruleName),
          'utf-8'
        );
        expect(templateRule).toBe(sourceRule);
      }

      const languageRule = await readFile(
        join(projectRoot, '.codex/rules/MUST-language-policy.md'),
        'utf-8'
      );
      const outputStyle = await readFile(
        join(TEMPLATES_DIR, '.claude/output-styles/korean-engineer.md'),
        'utf-8'
      );
      const r010 = await readFile(
        join(projectRoot, '.codex/rules/MUST-orchestrator-coordination.md'),
        'utf-8'
      );
      const r020 = await readFile(
        join(projectRoot, '.codex/rules/MUST-completion-verification.md'),
        'utf-8'
      );

      expect(languageRule).toContain('합쇼체');
      expect(outputStyle).toContain('합쇼체');
      expect(r010).toContain('Agent Capability Pre-Check');
      expect(r020).toContain('Interrupt Priority Re-Ordering');
      expect(r020).toContain('Diagnostic Hypothesis Verification');
      expect(r020).toContain('Test-Skip Is Not Completion');
      expect(r020).toContain('Parallel Read + Permanent-Change Dispatch');

      const permissionsRule = await readFile(
        join(projectRoot, '.codex/rules/MUST-permissions.md'),
        'utf-8'
      );
      const agentDesignRule = await readFile(
        join(projectRoot, '.codex/rules/MUST-agent-design.md'),
        'utf-8'
      );
      const agentTeamsRule = await readFile(
        join(projectRoot, '.codex/rules/MUST-agent-teams.md'),
        'utf-8'
      );
      const safetyRule = await readFile(join(projectRoot, '.codex/rules/MUST-safety.md'), 'utf-8');
      const optimizationRule = await readFile(
        join(projectRoot, '.codex/rules/MAY-optimization.md'),
        'utf-8'
      );
      const memoryRule = await readFile(
        join(projectRoot, '.codex/rules/SHOULD-memory-integration.md'),
        'utf-8'
      );

      expect(permissionsRule).toContain('Deny Rule Glob Patterns');
      expect(agentDesignRule).toContain('Fallback Models and Thinking Toggle');
      expect(agentTeamsRule).toContain('Cross-Session Relay Authority Hardening');
      expect(safetyRule).toContain('Pre-Delegation Blast-Radius Enumeration');
      expect(optimizationRule).toContain('Measure-Before-Adopt Gate');
      expect(memoryRule).toContain('Safety Feedback Memory');

      const r017 = await readFile(
        join(projectRoot, '.codex/rules/MUST-sync-verification.md'),
        'utf-8'
      );
      expect(r017).toContain('Structural Migration Verification');
      expect(r017).toContain('clean checkout or isolated worktree');
    });

    it('keeps changed installer artifacts byte-identical to their active mirrors', async () => {
      const projectRoot = resolve(import.meta.dir, '../../..');
      const mirroredArtifacts = [
        'contexts/ecomode.md',
        'hooks/hooks.json',
        'hooks/scripts/model-escalation-advisor.sh',
        'hooks/scripts/task-outcome-recorder.sh',
        'rules/MUST-agent-design.md',
        'rules/MUST-orchestrator-coordination.md',
        'rules/MUST-parallel-execution.md',
        'rules/MUST-tool-identification.md',
        'rules/SHOULD-hud-statusline.md',
        'rules/SHOULD-memory-integration.md',
        'rules/SHOULD-verification-ladder.md',
        'skills/action-validator/SKILL.md',
        'skills/adaptive-harness/SKILL.md',
        'skills/cve-triage/SKILL.md',
        'skills/dag-orchestration/SKILL.md',
        'skills/de-lead-routing/SKILL.md',
        'skills/deep-verify/SKILL.md',
        'skills/dev-lead-routing/SKILL.md',
        'skills/evaluator-optimizer/SKILL.md',
        'skills/hada-scout/SKILL.md',
        'skills/model-escalation/SKILL.md',
        'skills/multi-model-verification/SKILL.md',
        'skills/omcodex-auto-improve/SKILL.md',
        'skills/qa-lead-routing/SKILL.md',
        'skills/reasoning-sandwich/SKILL.md',
        'skills/research/SKILL.md',
        'skills/scout/SKILL.md',
        'skills/secretary-routing/SKILL.md',
        'skills/skill-extractor/SKILL.md',
        'skills/structured-dev-cycle/SKILL.md',
        'skills/task-decomposition/SKILL.md',
        'skills/worker-reviewer-pipeline/SKILL.md',
      ];

      for (const relativePath of mirroredArtifacts) {
        const [source, template] = await Promise.all([
          readFile(join(projectRoot, '.codex', relativePath), 'utf-8'),
          readFile(join(TEMPLATES_DIR, '.claude', relativePath), 'utf-8'),
        ]);
        expect(template, relativePath).toBe(source);
      }
    });

    it('keeps qa-engineer evidence requirements mirrored into templates', async () => {
      const projectRoot = resolve(import.meta.dir, '../../..');
      const sourceAgent = await readFile(
        join(projectRoot, '.codex/agents/qa-engineer.md'),
        'utf-8'
      );
      const templateAgent = await readFile(
        join(TEMPLATES_DIR, '.claude/agents/qa-engineer.md'),
        'utf-8'
      );

      expect(templateAgent).not.toBe(sourceAgent);
      expect(templateAgent).toContain('model: sonnet');
      expect(sourceAgent).toContain('model_lane: frontier');
      expect(sourceAgent).toContain('model_reasoning_effort: medium');
      expect(sourceAgent).toContain('Evidence Requirements');
      expect(sourceAgent).toContain('data-testid');
      expect(sourceAgent).toContain('browser or screenshot evidence');
    });
  });

  describe('harness engineering guidance', () => {
    it('documents middleware, anatomy, and hill-climbing guide surfaces', async () => {
      const requiredGuides = [
        ['middleware-patterns', 'Lifecycle Mapping'],
        ['agent-harness-anatomy', 'Six Components'],
        ['harness-engineering', 'Eval-Driven Hill Climbing'],
        ['autonomous-challenge-lessons', 'Start With Ground Truth'],
      ] as const;

      for (const [guideName, expectedText] of requiredGuides) {
        const source = await readFile(
          join(TEMPLATES_DIR, 'guides', guideName, 'README.md'),
          'utf-8'
        );
        expect(source).toContain(expectedText);
      }
    });

    it('keeps eval and architecture skills linked to harness-engineering concepts', async () => {
      const files = [
        join(TEMPLATES_DIR, '.claude/skills/harness-eval/SKILL.md'),
        join(TEMPLATES_DIR, '.claude/skills/adaptive-harness/SKILL.md'),
        join(TEMPLATES_DIR, '.claude/skills/reasoning-sandwich/SKILL.md'),
        join(TEMPLATES_DIR, '.claude/skills/pre-generation-arch-check/SKILL.md'),
      ];
      const combined = (await Promise.all(files.map((file) => readFile(file, 'utf-8')))).join('\n');

      expect(combined).toContain('Eval Governance');
      expect(combined).toContain('Trace Analyzer Pattern');
      expect(combined).toContain('Reasoning Budget Allocation');
      expect(combined).toContain('Pre-Completion Checklist Pattern');
    });
  });

  describe('ported audit regression contracts', () => {
    it('advertises plain harness-eval invocations for Codex and Claude-compatible runtimes', async () => {
      const files = [
        '.codex/skills/harness-eval/SKILL.md',
        'templates/.claude/skills/harness-eval/SKILL.md',
      ];

      for (const relativePath of files) {
        const content = await readFile(join(PROJECT_ROOT, relativePath), 'utf-8');

        expect(parseFrontmatter(content).fields.name).toBe('harness-eval');
        expect(content).toContain('$harness-eval');
        expect(content).toContain('/harness-eval');
        expect(content).toContain('Codex');
        expect(content).toContain('Claude Code');
        expect(content).not.toContain('omcustomcodex:harness-eval');
      }

      for (const relativePath of [
        '.codex/skills/adaptive-harness/SKILL.md',
        'templates/.claude/skills/adaptive-harness/SKILL.md',
        '.codex/skills/evaluator-optimizer/SKILL.md',
        'templates/.claude/skills/evaluator-optimizer/SKILL.md',
      ]) {
        const content = await readFile(join(PROJECT_ROOT, relativePath), 'utf-8');
        expect(content).toContain('$harness-eval');
        expect(content).not.toContain('omcustomcodex:harness-eval');
      }
    });

    it('advertises plain claude-native invocations and isolates Claude scheduling syntax', async () => {
      const files = [
        '.codex/skills/claude-native/SKILL.md',
        'templates/.claude/skills/claude-native/SKILL.md',
      ];

      for (const relativePath of files) {
        const content = await readFile(join(PROJECT_ROOT, relativePath), 'utf-8');

        expect(parseFrontmatter(content).fields.name).toBe('claude-native');
        expect(content).toContain('$claude-native');
        expect(content).toContain('/claude-native');
        expect(content).toContain('Codex / OMX');
        expect(content).toContain('Claude Code-compatible scheduling surface');
        expect(content).not.toContain('omcustomcodex:claude-native');
        expect(content).toContain('/schedule "daily at 9am: /claude-native"');
      }
    });

    it('removes dead operator references and binds rule history to durable provenance', async () => {
      const [vercelSkill, completionRule, memoryRule, verificationRule, wikiWorkflow] =
        await Promise.all([
          readFile(join(PROJECT_ROOT, '.codex/skills/vercel-deploy/SKILL.md'), 'utf-8'),
          readFile(join(PROJECT_ROOT, '.codex/rules/MUST-completion-verification.md'), 'utf-8'),
          readFile(join(PROJECT_ROOT, '.codex/rules/SHOULD-memory-integration.md'), 'utf-8'),
          readFile(join(PROJECT_ROOT, '.codex/rules/SHOULD-verification-ladder.md'), 'utf-8'),
          readFile(join(PROJECT_ROOT, 'templates/.github/workflows/wiki-sync.yml'), 'utf-8'),
        ]);
      const removedFeedbackFiles = [
        'feedback_github_workflows_inventory.md',
        'feedback_subagent_pre_existing_claims.md',
        'feedback_bun_mock_module.md',
      ];

      expect(vercelSkill).not.toContain('scripts/deploy.sh');
      expect(vercelSkill).not.toContain('## Scripts');
      for (const rule of [completionRule, memoryRule]) {
        expect(rule).toContain('issue #869');
        for (const filename of removedFeedbackFiles) {
          expect(rule).not.toContain(filename);
        }
      }
      expect(verificationRule).toContain('Compact Output');
      expect(verificationRule).not.toContain('"저렴한 검증 우선"');
      expect(wikiWorkflow).not.toContain('/omcustom:wiki');
      expect(wikiWorkflow.match(/\/omcustomcodex:wiki/g)).toHaveLength(2);
    });

    it('keeps monitoring-setup references namespaced across both provider invocation surfaces', async () => {
      const pairs = [
        ['guides/agent-eval/README.md', 'templates/guides/agent-eval/README.md'],
        [
          '.codex/skills/monitoring-setup/SKILL.md',
          'templates/.claude/skills/monitoring-setup/SKILL.md',
        ],
        [
          '.codex/skills/token-efficiency-audit/SKILL.md',
          'templates/.claude/skills/token-efficiency-audit/SKILL.md',
        ],
      ] as const;

      for (const [sourcePath, templatePath] of pairs) {
        const [source, template] = await Promise.all([
          readFile(join(PROJECT_ROOT, sourcePath), 'utf-8'),
          readFile(join(PROJECT_ROOT, templatePath), 'utf-8'),
        ]);

        expect(template, templatePath).toBe(source);
        expect(source).toContain('$omcustomcodex:monitoring-setup');
        expect(source).toContain('/omcustomcodex:monitoring-setup');
        expect(source).not.toContain('`monitoring-setup`');
        expect(source).not.toContain('/monitoring-setup disable');
        expect(source).not.toMatch(/(^|[^a-z])omcodex:monitoring-setup/);
      }

      const skill = await readFile(
        join(PROJECT_ROOT, '.codex/skills/monitoring-setup/SKILL.md'),
        'utf-8'
      );
      expect(parseFrontmatter(skill).fields.name).toBe('omcustomcodex:monitoring-setup');
    });

    it('keeps every corrected source asset byte-identical to its packaged template mirror', async () => {
      const mirroredPaths = [
        'skills/harness-eval/SKILL.md',
        'skills/claude-native/SKILL.md',
        'skills/adaptive-harness/SKILL.md',
        'skills/evaluator-optimizer/SKILL.md',
        'skills/vercel-deploy/SKILL.md',
        'rules/MUST-completion-verification.md',
        'rules/SHOULD-memory-integration.md',
        'rules/SHOULD-verification-ladder.md',
      ];

      for (const relativePath of mirroredPaths) {
        const [source, template] = await Promise.all([
          readFile(join(PROJECT_ROOT, '.codex', relativePath), 'utf-8'),
          readFile(join(PROJECT_ROOT, 'templates/.claude', relativePath), 'utf-8'),
        ]);

        expect(template, relativePath).toBe(source);
      }
    });
  });

  describe('repo root provider layout validation', () => {
    const PROJECT_ROOT = resolve(import.meta.dir, '../../..');

    async function countSkillMdFiles(dir: string): Promise<number> {
      const entries = await readdir(dir, { withFileTypes: true });
      let count = 0;
      for (const entry of entries) {
        if (entry.isDirectory()) {
          count += await countSkillMdFiles(join(dir, entry.name));
        } else if (entry.isFile() && entry.name === 'SKILL.md') {
          count++;
        }
      }
      return count;
    }

    it('keeps wiki/index.yaml file entries aligned with wiki markdown pages', async () => {
      const wikiDir = join(PROJECT_ROOT, 'wiki');
      const indexYaml = await readFile(join(wikiDir, 'index.yaml'), 'utf-8');
      const markdownFiles = (await listMarkdownFiles(wikiDir))
        .filter((file) => file !== 'index.md' && file !== 'log.md')
        .sort();
      const contentMarkdownFiles = markdownFiles.filter((file) => file.includes('/'));
      const indexedFiles = Array.from(indexYaml.matchAll(/^\s+- file: (.+)$/gm))
        .map((match) => match[1])
        .sort();
      const totalPagesMatch = indexYaml.match(/^\s+total_pages:\s+(\d+)$/m);

      expect(totalPagesMatch).not.toBeNull();
      expect(Number(totalPagesMatch?.[1])).toBe(contentMarkdownFiles.length);
      expect(markdownFiles.length).toBeGreaterThan(contentMarkdownFiles.length);
      expect(indexedFiles).toEqual(markdownFiles);
    });

    it('uses AGENTS.md as the repo entry file and documents the visible status block', async () => {
      const agentsMd = await readFile(join(PROJECT_ROOT, 'AGENTS.md'), 'utf-8');
      const expectedVisibleHeader = [
        '```text',
        '    ┌─ Agent: Codex (gpt-5.4)',
        '    ├─ Skill: <active-skill-or-routing-surface>',
        '    └─ Status: <current-action-or-verdict>',
        '    ```',
      ].join('\n');

      expect(agentsMd).toContain(expectedVisibleHeader);
      expect(agentsMd).not.toContain('│ Skill:');
      expect(agentsMd).not.toContain('│ Status:');
    });

    it('repo root agent, skill, and rule surfaces are present and non-empty', async () => {
      const agentFiles = (
        await readdir(join(PROJECT_ROOT, '.codex', 'agents'), { withFileTypes: true })
      )
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);

      const skillCount = await countSkillMdFiles(join(PROJECT_ROOT, '.codex', 'skills'));
      const ruleFiles = (
        await readdir(join(PROJECT_ROOT, '.codex', 'rules'), { withFileTypes: true })
      ).filter((e) => e.isFile() && e.name.endsWith('.md'));

      expect(agentFiles.length).toBeGreaterThan(0);
      expect(skillCount).toBeGreaterThan(0);
      expect(ruleFiles.length).toBeGreaterThan(0);
    });
  });

  describe('routing-agent existence validation', () => {
    const PROJECT_ROOT = resolve(import.meta.dir, '../../..');

    async function fileExists(filePath: string): Promise<boolean> {
      try {
        await access(filePath);
        return true;
      } catch {
        return false;
      }
    }

    it('all agents referenced in dev-lead-routing exist', async () => {
      const routingPath = join(PROJECT_ROOT, '.codex', 'skills', 'dev-lead-routing', 'SKILL.md');
      if (!(await fileExists(routingPath))) return;

      const routing = await readFile(routingPath, 'utf-8');
      const agentRefs = routing.match(/(?:lang|be|fe|tool)-[\w-]+/g) ?? [];
      const uniqueAgents = [...new Set(agentRefs)];

      const errors: string[] = [];
      for (const agent of uniqueAgents) {
        const agentPath = join(PROJECT_ROOT, '.codex', 'agents', `${agent}.md`);
        if (!(await fileExists(agentPath))) {
          errors.push(`${agent}.md not found`);
        }
      }

      expect(errors).toEqual([]);
    });

    it('all agents referenced in secretary-routing exist', async () => {
      const routingPath = join(PROJECT_ROOT, '.codex', 'skills', 'secretary-routing', 'SKILL.md');
      if (!(await fileExists(routingPath))) return;

      const routing = await readFile(routingPath, 'utf-8');
      const agentRefs = routing.match(/(?:mgr|sys)-[\w-]+/g) ?? [];
      const uniqueAgents = [...new Set(agentRefs)];

      const errors: string[] = [];
      for (const agent of uniqueAgents) {
        const agentPath = join(PROJECT_ROOT, '.codex', 'agents', `${agent}.md`);
        if (!(await fileExists(agentPath))) {
          errors.push(`${agent}.md not found`);
        }
      }

      expect(errors).toEqual([]);
    });
  });

  describe('agent frontmatter skills validation', () => {
    const PROJECT_ROOT = resolve(import.meta.dir, '../../..');

    async function fileExists(filePath: string): Promise<boolean> {
      try {
        await access(filePath);
        return true;
      } catch {
        return false;
      }
    }

    async function extractSkillsFromAgent(content: string): Promise<string[]> {
      const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!frontmatterMatch) return [];

      const skillsMatch = frontmatterMatch[1].match(/^skills:\s*\n((?:[ \t]+-[ \t]+.+\n?)*)/m);
      if (!skillsMatch) return [];

      const skillLines = skillsMatch[1].match(/- (.+)/g) ?? [];
      return skillLines.map((s: string) => s.replace(/^-\s+/, '').trim());
    }

    async function checkAgentSkillRefs(
      file: string,
      agentsDir: string,
      skillsBaseDir: string,
      errors: string[]
    ): Promise<void> {
      const content = await readFile(join(agentsDir, file), 'utf-8');
      const skills = await extractSkillsFromAgent(content);

      for (const skill of skills) {
        const skillDir = skill.includes(':') ? (skill.split(':').pop() ?? skill) : skill;
        const skillPath = join(skillsBaseDir, skillDir, 'SKILL.md');
        if (!(await fileExists(skillPath))) {
          errors.push(`${file}: skill reference '${skill}' not found`);
        }
      }
    }

    it('all skill references in agent frontmatter exist', async () => {
      const agentsDir = join(PROJECT_ROOT, '.codex', 'agents');
      const skillsBaseDir = join(PROJECT_ROOT, '.codex', 'skills');
      const agentFiles = (await readdir(agentsDir, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);

      const errors: string[] = [];

      for (const file of agentFiles) {
        await checkAgentSkillRefs(file, agentsDir, skillsBaseDir, errors);
      }

      expect(errors).toEqual([]);
    });
  });

  describe('bypassPermissions guidance validation', () => {
    it('pipeline, scout, DE routing, and QA routing skills document bypassPermissions guidance', async () => {
      const files = [
        join(PROJECT_ROOT, 'templates/.claude/skills/pipeline/SKILL.md'),
        join(PROJECT_ROOT, 'templates/.claude/skills/scout/SKILL.md'),
        join(PROJECT_ROOT, 'templates/.claude/skills/de-lead-routing/SKILL.md'),
        join(PROJECT_ROOT, 'templates/.claude/skills/qa-lead-routing/SKILL.md'),
      ];

      for (const file of files) {
        const content = await readFile(file, 'utf-8');
        expect(content).toContain('bypassPermissions');
      }
    });
  });

  describe('pipeline workflow and docs validation', () => {
    it('repo and template auto-dev workflows stay in sync', async () => {
      const repoWorkflow = await readFile(join(PROJECT_ROOT, 'workflows/auto-dev.yaml'), 'utf-8');
      const templateWorkflow = await readFile(
        join(PROJECT_ROOT, 'templates/workflows/auto-dev.yaml'),
        'utf-8'
      );

      expect(repoWorkflow).toBe(templateWorkflow);
    });

    it('auto-dev release prompts require package and manifest version sync before release', async () => {
      const workflowPaths = [
        'workflows/auto-dev.yaml',
        'templates/workflows/auto-dev.yaml',
        '.codex/skills/pipeline/workflows/auto-dev.yaml',
      ];

      for (const relativePath of workflowPaths) {
        const content = await readFile(join(PROJECT_ROOT, relativePath), 'utf-8');
        expect(content).toContain('package.json');
        expect(content).toContain('templates/manifest.json');
        expect(content).toContain('bash .github/scripts/verify-version-sync.sh');
        expect(content).toContain('before tag');
      }
    });

    it('auto-dev workflows require sync, label standards, milestone checks, and bun test', async () => {
      const workflowPaths = [
        'workflows/auto-dev.yaml',
        'templates/workflows/auto-dev.yaml',
        '.codex/skills/pipeline/workflows/auto-dev.yaml',
      ];

      for (const relativePath of workflowPaths) {
        const content = await readFile(join(PROJECT_ROOT, relativePath), 'utf-8');
        expect(content).toContain('git fetch --all --tags --prune');
        expect(content).toContain('stale');
        expect(content).toContain('labels.md');
        expect(content).toContain('milestone');
        expect(content).toContain('compression_mode');
        expect(content).toContain('set -euo pipefail');
        expect(content).toContain('reserved shell variable names');
        expect(content).toContain('bun test');
        expect(content).toContain('baseline');
      }
    });

    it('pipeline label standards are packaged for source and templates', async () => {
      const sourceLabels = await readFile(
        join(PROJECT_ROOT, '.codex/skills/pipeline/labels.md'),
        'utf-8'
      );
      const templateLabels = await readFile(
        join(PROJECT_ROOT, 'templates/.claude/skills/pipeline/labels.md'),
        'utf-8'
      );

      expect(templateLabels).toBe(sourceLabels);
      expect(sourceLabels).toContain('verify-ready');
      expect(sourceLabels).toContain('verify-done');
      expect(sourceLabels).toContain('codex-release');
      expect(sourceLabels).toContain('Compression Eligibility');
    });

    it('professor-triage detailed phase guide is included in templates', async () => {
      const sourceGuide = await readFile(
        join(PROJECT_ROOT, 'guides/professor-triage/phases.md'),
        'utf-8'
      );
      const templateGuide = await readFile(
        join(PROJECT_ROOT, 'templates/guides/professor-triage/phases.md'),
        'utf-8'
      );

      expect(templateGuide).toBe(sourceGuide);
      expect(templateGuide).toContain('Senior Architect Analysis');
      expect(templateGuide).toContain('Project Colleague Review');
      expect(templateGuide).toContain('Professor Synthesis');
    });

    it('auto-dev workflow inventories release-monitor issues before declaring no work', async () => {
      const repoWorkflow = await readFile(join(PROJECT_ROOT, 'workflows/auto-dev.yaml'), 'utf-8');
      const skillWorkflow = await readFile(
        join(PROJECT_ROOT, '.codex/skills/pipeline/workflows/auto-dev.yaml'),
        'utf-8'
      );

      for (const content of [repoWorkflow, skillWorkflow]) {
        expect(content).toContain('codex-release');
        expect(content).toContain('oh-my-codex-release');
        expect(content).toContain('release-monitor');
      }

      expect(skillWorkflow).toContain(
        'Never terminate auto-dev from an empty `verify-done` query alone'
      );
    });

    it('R006 context fork list matches actual skill frontmatter', () => {
      const result = spawnSync(
        'bash',
        [join(PROJECT_ROOT, '.github/scripts/verify-fork-list.sh')],
        {
          cwd: PROJECT_ROOT,
          encoding: 'utf-8',
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('OK: R006 fork list matches actual SKILL.md frontmatter');
    });

    it('template sync script enforces content drift and stray skill guards', async () => {
      const scriptPath = join(PROJECT_ROOT, '.github/scripts/verify-template-sync.sh');
      const content = await readFile(scriptPath, 'utf-8');
      const syntax = spawnSync('bash', ['-n', scriptPath], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(syntax.status).toBe(0);
      expect(content).toContain('Content Drift Check');
      expect(content).toContain('Stray skill root markdown file');
      expect(content).toContain('templates/.claude/skills');
      expect(content).toContain('source != template');
      expect(content).toContain('normalize_compat_agent');

      const result = spawnSync('bash', [scriptPath], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Content drift check');
    });

    it('wiki sync script excludes navigation pages from total_pages', async () => {
      const scriptPath = join(PROJECT_ROOT, '.github/scripts/verify-wiki-sync.sh');
      const content = await readFile(scriptPath, 'utf-8');
      const syntax = spawnSync('bash', ['-n', scriptPath], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(syntax.status).toBe(0);
      expect(content).toContain('Navigation/landing pages');
      expect(content).toContain('find wiki -mindepth 2');
      expect(content).toContain('/omcustomcodex:wiki');
    });
    it('source hash generator refuses to overwrite templates manifest', async () => {
      const scriptPath = join(PROJECT_ROOT, '.github/scripts/lib/source-hash.sh');
      const manifestPath = join(PROJECT_ROOT, 'templates/manifest.json');
      const before = await readFile(manifestPath, 'utf-8');
      const syntax = spawnSync('bash', ['-n', scriptPath], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });
      const result = spawnSync('bash', [scriptPath, 'generate', 'templates/manifest.json'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });
      const after = await readFile(manifestPath, 'utf-8');

      expect(syntax.status).toBe(0);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('refusing to overwrite templates/manifest.json');
      expect(result.stderr).toContain('wiki/.source-hashes.json');
      expect(after).toBe(before);
    });

    it('customization guide uses workflows/ and /pipeline syntax instead of legacy pipeline commands', async () => {
      const customization = await readFile(
        join(PROJECT_ROOT, 'docs/guide/customization.md'),
        'utf-8'
      );

      expect(customization).toContain('Create them in `workflows/`:');
      expect(customization).toContain('/pipeline my-workflow');
      expect(customization).toContain('/pipeline resume');
      expect(customization).not.toContain('Create in `pipelines/`:');
      expect(customization).not.toContain('pipeline:run');
      expect(customization).not.toContain('pipeline:list');
    });

    it('template pipeline registry documents the current /pipeline surface', async () => {
      const registry = await readFile(join(PROJECT_ROOT, 'templates/index.yaml'), 'utf-8');

      expect(registry).toContain('/pipeline <name>');
      expect(registry).toContain('/pipeline');
      expect(registry).toContain('/pipeline resume');
      expect(registry).not.toContain('pipeline:run');
      expect(registry).not.toContain('pipeline:list');
      expect(registry).not.toContain('sequential workflows');
    });

    it('pipeline docs describe the current auto-dev stages and parallel-capable engine', async () => {
      const architecture = await readFile(join(PROJECT_ROOT, 'ARCHITECTURE.md'), 'utf-8');
      const architectureKo = await readFile(join(PROJECT_ROOT, 'ARCHITECTURE_ko.md'), 'utf-8');
      const pipelineSpec = await readFile(
        join(PROJECT_ROOT, 'docs/superpowers/specs/2026-04-02-pipeline-skill-design.md'),
        'utf-8'
      );

      expect(architecture).toContain('pre-triage');
      expect(architecture).toContain('publish');
      expect(architecture).toContain('followup');
      expect(architectureKo).toContain('pre-triage');
      expect(architectureKo).toContain('publish');
      expect(architectureKo).toContain('followup');
      expect(pipelineSpec).toContain('parallel');
      expect(pipelineSpec).not.toContain('Sequential only');
      expect(pipelineSpec).not.toContain('/pipeline add');
      expect(pipelineSpec).not.toContain('/pipeline delete');
      expect(pipelineSpec).not.toContain('/pipeline --dir');
    });
  });
  it('should include OpenAI Codex compatibility guide in source and template mirrors', async () => {
    const source = await readFile(
      join(PROJECT_ROOT, 'guides/openai-codex/01-version-compatibility.md'),
      'utf-8'
    );
    const template = await readFile(
      join(TEMPLATES_DIR, 'guides/openai-codex/01-version-compatibility.md'),
      'utf-8'
    );
    const wiki = await readFile(join(PROJECT_ROOT, 'wiki/guides/openai-codex.md'), 'utf-8');

    expect(template).toBe(source);
    expect(source).toContain('rust-v0.138.0');
    expect(source).toContain('rust-v0.143.0');
    expect(source).toContain('rust-v0.144.3');
    expect(source).toContain('rust-v0.144.6');
    expect(source).toContain('oh-my-codex v0.20.2 / OMX compatibility baseline');
    expect(source).toContain('rust-v0.144.4-rust-v0.144.5 / CLI final state');
    expect(source).toContain('v0.20.1');
    expect(source).toMatch(/rust-v0\.144\.4[\s\S]{0,1500}no user-facing changes?/i);
    expect(source).toContain('/app');
    expect(source).toContain('model-advertised effort ordering');
    expect(source).toContain('AGENTS.md');
    expect(source).toContain('#1481');
    expect(source).toContain('Guardian final state:');
    expect(source).toContain(
      'restored the previous Guardian auto-review policy, request format, prompting, and tool behavior.'
    );
    expect(source).toContain(
      'tag comparison shows divergent ancestry with direct commit `8a4d35a`'
    );
    expect(source).toContain('`feat(tui): add an advanced reasoning picker`');
    for (const issue of [
      '#1571',
      '#1572',
      '#1573',
      '#1575',
      '#1576',
      '#1622',
      '#1623',
      '#1641',
      '#1663',
      '#1664',
      '#1683',
    ]) {
      expect(source).toContain(issue);
    }
    for (const document of [source, wiki]) {
      expect(document).toContain('0.20.2');
      expect(document).toContain('rust-v0.144.4');
      expect(document).toContain('rust-v0.144.5');
      expect(document).toContain('rust-v0.144.6');
      expect(document).toContain('272,000');
      expect(document).toContain('provider-owned');
      expect(document).toContain('MINIMUM_OMX_VERSION');
      expect(document).toContain('Yeachan-Heo/oh-my-codex#3147');
      expect(document).toContain('#3151');
      expect(document).toContain('d82b7e5d4c');
      expect(document).toContain('ModelMessages.auto_review.policy');
      expect(document).toMatch(/guardian_policy_config`? -> catalog policy -> built-in fallback/);
      expect(document).toContain('dangerous-command');
      expect(document).toContain('foreign Codex hook coordinates');
      expect(document).not.toMatch(
        /(?:Yeachan-Heo\/oh-my-codex#3147[^\n]*(?:remain|remains) open|(?:remain|remains) open[^\n]*Yeachan-Heo\/oh-my-codex#3147)/i
      );
      for (const issue of ['#1641', '#1663', '#1664', '#1683']) {
        expect(document).toContain(issue);
      }
    }
    expect(source).toMatch(/MINIMUM_OMX_VERSION[^\n]*0\.20\.2/);
    expect(wiki).toMatch(/(?:MINIMUM_OMX_VERSION[^\n]*0\.20\.2|0\.20\.2[^\n]*MINIMUM_OMX_VERSION)/);
    expect(wiki).not.toContain('upstream `Yeachan-Heo/oh-my-codex#3147` remains open');
  });

  it('documents Markdown agent sources separately from the native TOML runtime', async () => {
    const [readme, readmeKo, sourceGuide, templateGuide] = await Promise.all([
      readFile(join(PROJECT_ROOT, 'README.md'), 'utf-8'),
      readFile(join(PROJECT_ROOT, 'README_ko.md'), 'utf-8'),
      readFile(join(PROJECT_ROOT, 'guides/agents-md-quality/README.md'), 'utf-8'),
      readFile(join(TEMPLATES_DIR, 'guides/agents-md-quality/README.md'), 'utf-8'),
    ]);

    expect(templateGuide).toBe(sourceGuide);
    for (const document of [readme, readmeKo, sourceGuide]) {
      expect(document).toContain('.codex/agents/*.md');
      expect(document).toContain('.codex/agents/*.toml');
    }
    expect(readme).toContain('upstream-compatible source inputs');
    expect(readmeKo).toContain('upstream 호환 소스 입력');
    expect(sourceGuide).toContain('custom and OMX TOML roles coexist and are preserved');
  });

  it('should require auto-dev release changelog promotion before tagging', async () => {
    const workflow = await readFile(join(PROJECT_ROOT, 'workflows/auto-dev.yaml'), 'utf-8');
    const templateWorkflow = await readFile(
      join(TEMPLATES_DIR, 'workflows/auto-dev.yaml'),
      'utf-8'
    );

    expect(templateWorkflow).toBe(workflow);
    expect(workflow).toContain('Promote `CHANGELOG.md` before the release PR/tag');
    expect(workflow).toContain('instead of relying on GitHub auto-generated release notes');
  });
});
