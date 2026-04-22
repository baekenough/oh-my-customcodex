/**
 * MCP configuration generator for ontology-rag server.
 *
 * Canonical Codex project-scoped MCP configuration lives in `.codex/config.toml`.
 */

import { execSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDirectory, fileExists } from '../utils/fs.js';
import { info, warn } from '../utils/logger.js';
import { getProviderLayout } from './layout.js';

const PROJECT_CONFIG_DIR = '.codex';
const PROJECT_CONFIG_FILE = 'config.toml';
const ONTOLOGY_SERVER_TABLE = '[mcp_servers.ontology-rag]';

export function getProjectMCPConfigPath(targetDir: string): string {
  return join(targetDir, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILE);
}

function renderOntologyMCPBlock(ontologyDir: string): string {
  return `${ONTOLOGY_SERVER_TABLE}
command = ".venv/bin/python"
args = ["-m", "ontology_rag.mcp_server"]

[mcp_servers.ontology-rag.env]
ONTOLOGY_DIR = "${ontologyDir}"
`;
}

function hasOntologyMCPConfig(content: string): boolean {
  return content.includes(ONTOLOGY_SERVER_TABLE);
}

/**
 * Generate `.codex/config.toml` with ontology-rag MCP server configuration.
 * @param targetDir - Project root directory
 */
export async function generateMCPConfig(targetDir: string): Promise<void> {
  const layout = getProviderLayout();
  const ontologyDir = join(layout.rootDir, 'ontology');

  // Only generate if ontology directory was installed.
  const ontologyExists = await fileExists(join(targetDir, ontologyDir));
  if (!ontologyExists) {
    return;
  }

  try {
    execSync('uv --version', { stdio: 'pipe' });
  } catch {
    warn(
      'uv (Python package manager) not found. Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh'
    );
    warn(
      'Skipping ontology-rag MCP configuration in .codex/config.toml. You can set it up manually later.'
    );
    return;
  }

  try {
    execSync('uv venv .venv', { cwd: targetDir, stdio: 'pipe' });
    execSync(
      'uv pip install "ontology-rag @ git+https://github.com/baekenough/oh-my-customcodex.git#subdirectory=packages/ontology-rag"',
      { cwd: targetDir, stdio: 'pipe' }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warn(`Failed to setup ontology-rag: ${msg}`);
    warn(
      'You can configure the MCP server manually in .codex/config.toml. See: https://github.com/baekenough/oh-my-customcodex/tree/develop/packages/ontology-rag'
    );
    return;
  }

  const configPath = getProjectMCPConfigPath(targetDir);
  await ensureDirectory(join(targetDir, PROJECT_CONFIG_DIR));

  let existingContent = '';
  if (await fileExists(configPath)) {
    existingContent = await readFile(configPath, 'utf-8');
    if (hasOntologyMCPConfig(existingContent)) {
      info('ontology-rag MCP server already configured');
      return;
    }
  }

  const block = renderOntologyMCPBlock(ontologyDir);
  const nextContent = existingContent.trim() ? `${existingContent.trimEnd()}\n\n${block}` : block;

  await writeFile(configPath, nextContent, 'utf-8');
  info('ontology-rag MCP server configured successfully');
}

/**
 * Check if uv is available for Python environment management
 * @returns True if uv is installed and accessible
 */
export async function checkUvAvailable(): Promise<boolean> {
  try {
    execSync('uv --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
