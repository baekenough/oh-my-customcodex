import { describe, expect, it } from 'bun:test';
import { access, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dir, '../../..');
const PLUGIN_NAME = 'oh-my-customcodex';
const PLUGIN_ROOT = join(PROJECT_ROOT, 'plugins', PLUGIN_NAME);
const PLUGIN_ROOT_TOKEN = '$' + '{PLUGIN_ROOT}';

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function countSkillDirectories(path: string): Promise<number> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && entry.name !== '.system').length;
}

function collectCommands(value: unknown, commands: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectCommands(entry, commands);
    return commands;
  }
  if (!value || typeof value !== 'object') return commands;

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'command' && typeof entry === 'string') {
      commands.push(entry);
      continue;
    }
    collectCommands(entry, commands);
  }
  return commands;
}

describe('Codex plugin artifact', () => {
  it('declares package versioned plugin, marketplace, skill, hook, and MCP surfaces', async () => {
    const packageJson = await readJson<{ version: string }>(join(PROJECT_ROOT, 'package.json'));
    const manifest = await readJson<{
      name: string;
      version: string;
      skills: string;
      hooks?: string;
      mcpServers: string;
      interface: { displayName: string; shortDescription: string };
    }>(join(PLUGIN_ROOT, '.codex-plugin', 'plugin.json'));
    const marketplace = await readJson<{
      name: string;
      plugins: Array<{
        name: string;
        source: { source: string; path: string };
        policy: { installation: string; authentication: string };
        category: string;
      }>;
    }>(join(PROJECT_ROOT, '.agents', 'plugins', 'marketplace.json'));
    const mcp = await readJson<{ mcpServers: Record<string, { env: Record<string, string> }> }>(
      join(PLUGIN_ROOT, '.mcp.json')
    );

    expect(manifest.name).toBe(PLUGIN_NAME);
    expect(manifest.version).toBe(packageJson.version);
    expect(manifest.skills).toBe('./skills/');
    expect(manifest.hooks).toBeUndefined();
    expect(manifest.mcpServers).toBe('./.mcp.json');
    expect(manifest.interface.displayName).toBe('oh-my-customcodex');
    expect(manifest.interface.shortDescription).toContain('Codex + OMX harness');

    expect(marketplace.name).toBe('oh-my-customcodex-local');
    expect(marketplace.plugins).toEqual([
      {
        name: PLUGIN_NAME,
        source: { source: 'local', path: './plugins/oh-my-customcodex' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity',
      },
    ]);

    expect(mcp.mcpServers['ontology-rag'].env.ONTOLOGY_DIR).toBe('.codex/ontology');
  });

  it('mirrors tracked skills and rewrites hook script paths to the plugin root', async () => {
    expect(await countSkillDirectories(join(PLUGIN_ROOT, 'skills'))).toBe(
      await countSkillDirectories(join(PROJECT_ROOT, '.codex', 'skills'))
    );
    await access(join(PLUGIN_ROOT, 'hooks', 'scripts', 'schema-validator.sh'));
    await access(join(PLUGIN_ROOT, 'hooks', 'skill-count-reminder.sh'));
    await access(join(PLUGIN_ROOT, 'ontology', 'skills.yaml'));
    await access(join(PLUGIN_ROOT, 'schemas', 'tool-inputs.json'));

    const hooks = await readJson<unknown>(join(PLUGIN_ROOT, 'hooks', 'hooks.json'));
    const commands = collectCommands(hooks);
    expect(
      commands.some((command) => command.includes(`${PLUGIN_ROOT_TOKEN}/hooks/scripts/`))
    ).toBe(true);
    expect(commands.every((command) => !command.includes('.codex/hooks/'))).toBe(true);
  });
});
