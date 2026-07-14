import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const repoRoot = process.cwd();
const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
  version: string;
};
const pluginName = 'oh-my-customcodex';
const pluginRoot = join(repoRoot, 'plugins', pluginName);
const pluginRootToken = '$' + '{PLUGIN_ROOT}';

async function copyDirectory(source: string, destination: string): Promise<void> {
  await cp(source, destination, {
    recursive: true,
    dereference: false,
    filter: (path) => !path.includes('/.system/') && !path.endsWith('/.system'),
  });
}

async function normalizePluginSkillFrontmatter(skillsRoot: string): Promise<void> {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsRoot, entry.name, 'SKILL.md');
    try {
      const content = await readFile(skillPath, 'utf8');
      const normalized = content.replace(
        /^disable-model-invocation:\s*true\s*$/m,
        'disable-model-invocation: false'
      );
      if (normalized !== content) await writeFile(skillPath, normalized);
    } catch {
      // Non-standard skill directories are ignored; validation catches required SKILL.md gaps.
    }
  }
}

function rewriteHookCommands(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteHookCommands);
  if (!value || typeof value !== 'object') return value;

  const next: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'command' && typeof raw === 'string') {
      next[key] = raw.replaceAll('.codex/hooks/', `${pluginRootToken}/hooks/`);
      continue;
    }
    next[key] = rewriteHookCommands(raw);
  }
  return next;
}

await mkdir(join(repoRoot, '.agents', 'plugins'), { recursive: true });
await mkdir(pluginRoot, { recursive: true });
await rm(join(pluginRoot, 'skills'), { recursive: true, force: true });
await rm(join(pluginRoot, 'hooks'), { recursive: true, force: true });
await rm(join(pluginRoot, 'ontology'), { recursive: true, force: true });
await rm(join(pluginRoot, 'schemas'), { recursive: true, force: true });

await copyDirectory(join(repoRoot, '.codex', 'skills'), join(pluginRoot, 'skills'));
await normalizePluginSkillFrontmatter(join(pluginRoot, 'skills'));
await copyDirectory(join(repoRoot, '.codex', 'hooks'), join(pluginRoot, 'hooks'));
await copyDirectory(join(repoRoot, '.codex', 'ontology'), join(pluginRoot, 'ontology'));
await copyDirectory(join(repoRoot, '.codex', 'schemas'), join(pluginRoot, 'schemas'));

const hooksPath = join(pluginRoot, 'hooks', 'hooks.json');
const hooks = JSON.parse(await readFile(hooksPath, 'utf8'));
await writeFile(hooksPath, `${JSON.stringify(rewriteHookCommands(hooks), null, 2)}\n`);

await mkdir(join(pluginRoot, '.codex-plugin'), { recursive: true });
await writeFile(
  join(pluginRoot, '.codex-plugin', 'plugin.json'),
  `${JSON.stringify(
    {
      name: pluginName,
      version: packageJson.version,
      description:
        'Reusable Codex + OMX harness assets from oh-my-customcodex, packaged as a Codex plugin.',
      author: {
        name: 'baekenough',
        url: 'https://github.com/baekenough',
      },
      homepage: 'https://github.com/baekenough/oh-my-customcodex',
      repository: 'https://github.com/baekenough/oh-my-customcodex',
      license: 'MIT',
      keywords: ['codex', 'omx', 'agents', 'skills', 'hooks', 'harness'],
      skills: './skills/',
      mcpServers: './.mcp.json',
      interface: {
        displayName: 'oh-my-customcodex',
        shortDescription: 'Codex + OMX harness skills, hooks, and ontology routing assets.',
        longDescription:
          'Installs the reusable oh-my-customcodex harness bundle as a Codex plugin: workflow skills, safety hooks, ontology metadata, and the ontology-rag MCP declaration.',
        developerName: 'baekenough',
        category: 'Productivity',
        capabilities: ['Interactive', 'Write'],
        websiteURL: 'https://github.com/baekenough/oh-my-customcodex',
        defaultPrompt: [
          'Load the oh-my-customcodex harness skills for this project.',
          'Run an omcustomcodex release or issue workflow.',
          'Review installed Codex hooks and routing assets.',
        ],
      },
    },
    null,
    2
  )}\n`
);

await writeFile(
  join(pluginRoot, '.mcp.json'),
  `${JSON.stringify(
    {
      mcpServers: {
        'ontology-rag': {
          command: 'uv',
          args: [
            'run',
            '--no-project',
            '--python',
            '.venv',
            'python',
            '-m',
            'ontology_rag.mcp_server',
          ],
          env: {
            ONTOLOGY_DIR: '.codex/ontology',
          },
        },
      },
    },
    null,
    2
  )}\n`
);

await writeFile(
  join(repoRoot, '.agents', 'plugins', 'marketplace.json'),
  `${JSON.stringify(
    {
      name: 'oh-my-customcodex-local',
      interface: {
        displayName: 'oh-my-customcodex Local',
      },
      plugins: [
        {
          name: pluginName,
          source: {
            source: 'local',
            path: `./plugins/${pluginName}`,
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_INSTALL',
          },
          category: 'Productivity',
        },
      ],
    },
    null,
    2
  )}\n`
);
