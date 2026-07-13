/**
 * MCP configuration generator for ontology-rag server.
 *
 * Canonical Codex project-scoped MCP configuration lives in `.codex/config.toml`.
 */

import { execSync } from 'node:child_process';
import { lstat, readdir, readFile, readlink, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileExists, prevalidateSafeWritePath, writeTextFile } from '../utils/fs.js';
import { info, warn } from '../utils/logger.js';
import { getProviderLayout } from './layout.js';

const PROJECT_CONFIG_DIR = '.codex';
const PROJECT_CONFIG_FILE = 'config.toml';
const ONTOLOGY_SERVER_TABLE = '[mcp_servers.ontology-rag]';
const ONTOLOGY_SERVER_COMMAND = 'uv';
const ONTOLOGY_PYTHON_VERSION = '3.12';
const ONTOLOGY_SERVER_ARGS = [
  'run',
  '--no-project',
  '--python',
  '.venv',
  'python',
  '-m',
  'ontology_rag.mcp_server',
];

export function getProjectMCPConfigPath(targetDir: string): string {
  return join(targetDir, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILE);
}

function renderTomlString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function renderOntologyMCPBlock(ontologyDir: string): string {
  return `${ONTOLOGY_SERVER_TABLE}
command = ${renderTomlString(ONTOLOGY_SERVER_COMMAND)}
args = [${ONTOLOGY_SERVER_ARGS.map(renderTomlString).join(', ')}]

[mcp_servers.ontology-rag.env]
ONTOLOGY_DIR = ${renderTomlString(ontologyDir)}
`;
}

function hasOntologyMCPConfig(content: string): boolean {
  return content.includes(ONTOLOGY_SERVER_TABLE);
}

async function lstatIfPresent(path: string): Promise<import('node:fs').Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function isSameOrDescendant(path: string, ancestor: string): boolean {
  const pathFromAncestor = relative(resolve(ancestor), resolve(path));
  return (
    pathFromAncestor === '' ||
    (pathFromAncestor !== '..' &&
      !pathFromAncestor.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromAncestor))
  );
}

function isPythonInterpreterLink(path: string, venvDir: string): boolean {
  const pathFromVenv = relative(venvDir, path);
  return dirname(pathFromVenv) === 'bin' && basename(pathFromVenv).startsWith('python');
}

async function assertSafeVenvSymlink(
  path: string,
  venvDir: string,
  description: string
): Promise<void> {
  const linkTarget = await readlink(path);
  const resolvedTarget = resolve(dirname(path), linkTarget);

  // Common virtual-environment links such as lib64 -> lib remain confined to
  // the environment. Every real entry below .venv is still lstat-walked.
  if (isSameOrDescendant(resolvedTarget, venvDir)) return;

  // CPython virtual environments intentionally link bin/python* to the base
  // interpreter. This is the only supported link that may leave .venv, and it
  // must resolve to a regular file rather than a directory or special file.
  if (isPythonInterpreterLink(path, venvDir)) {
    try {
      if ((await stat(path)).isFile()) return;
    } catch {
      // Fall through to the security error with the offending path included.
    }
  }

  throw new Error(`Unsafe ${description}: symbolic link escapes .venv: ${path}`);
}

async function assertSafeExistingVenvTree(
  path: string,
  venvDir: string,
  description: string
): Promise<void> {
  const stats = await lstatIfPresent(path);
  if (!stats) return;
  if (stats.isSymbolicLink()) {
    await assertSafeVenvSymlink(path, venvDir, description);
    return;
  }
  if (stats.isFile()) {
    if (stats.nlink > 1) {
      throw new Error(`Unsafe ${description}: hard-linked files are not allowed: ${path}`);
    }
    return;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Unsafe ${description}: special files are not allowed: ${path}`);
  }

  for (const entry of await readdir(path)) {
    await assertSafeExistingVenvTree(join(path, entry), venvDir, description);
  }
}

async function prevalidateOntologyVenv(targetDir: string): Promise<void> {
  const venvDir = join(targetDir, '.venv');
  // When the environment is absent, validate only the future destination
  // plan. When it exists, additionally inspect every entry without following
  // directory links before any uv subprocess can mutate the tree.
  await prevalidateSafeWritePath(join(venvDir, '.omcodex-mcp-write-boundary'), targetDir);
  await assertSafeExistingVenvTree(venvDir, venvDir, 'ontology-rag virtual environment');
}

function getUvInstallEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.VIRTUAL_ENV;
  return environment;
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

  const configPath = getProjectMCPConfigPath(targetDir);
  // This must precede uv checks and environment setup: both are observable
  // side effects and must not run when config.toml would escape the project.
  await prevalidateSafeWritePath(configPath, targetDir);
  await prevalidateOntologyVenv(targetDir);

  let existingContent = '';
  if (await fileExists(configPath)) {
    existingContent = await readFile(configPath, 'utf-8');
    if (hasOntologyMCPConfig(existingContent)) {
      info('ontology-rag MCP server already configured');
      return;
    }
  }

  await prevalidateOntologyVenv(targetDir);
  try {
    execSync('uv --version', { stdio: 'pipe' });
  } catch {
    warn(
      `uv and Python ${ONTOLOGY_PYTHON_VERSION} are required for ontology-rag. Install uv, then run: uv python install ${ONTOLOGY_PYTHON_VERSION}`
    );
    warn(
      'Skipping ontology-rag MCP configuration in .codex/config.toml. You can set it up manually later.'
    );
    return;
  }

  await prevalidateOntologyVenv(targetDir);
  try {
    execSync(`uv python find ${ONTOLOGY_PYTHON_VERSION}`, { cwd: targetDir, stdio: 'pipe' });
  } catch {
    warn(
      `uv and Python ${ONTOLOGY_PYTHON_VERSION} are required for ontology-rag. Install uv, then run: uv python install ${ONTOLOGY_PYTHON_VERSION}`
    );
    warn(
      'Skipping ontology-rag MCP configuration in .codex/config.toml. You can set it up manually later.'
    );
    return;
  }

  await prevalidateOntologyVenv(targetDir);
  try {
    execSync(`uv venv --python ${ONTOLOGY_PYTHON_VERSION} .venv`, {
      cwd: targetDir,
      stdio: 'pipe',
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warn(`Failed to setup ontology-rag: ${msg}`);
    warn(
      'You can configure the MCP server manually in .codex/config.toml. See: https://github.com/baekenough/oh-my-customcodex/tree/develop/packages/ontology-rag'
    );
    return;
  }

  await prevalidateOntologyVenv(targetDir);
  try {
    execSync(
      'uv pip install --python .venv "ontology-rag @ git+https://github.com/baekenough/oh-my-customcodex.git#subdirectory=packages/ontology-rag"',
      { cwd: targetDir, env: getUvInstallEnvironment(), stdio: 'pipe' }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warn(`Failed to setup ontology-rag: ${msg}`);
    warn(
      'You can configure the MCP server manually in .codex/config.toml. See: https://github.com/baekenough/oh-my-customcodex/tree/develop/packages/ontology-rag'
    );
    return;
  }

  const block = renderOntologyMCPBlock(ontologyDir);
  const nextContent = existingContent.trim() ? `${existingContent.trimEnd()}\n\n${block}` : block;

  await writeTextFile(configPath, nextContent, { trustedWriteRoot: targetDir });
  info('ontology-rag MCP server configured successfully');
}

/**
 * Check if uv is available for Python environment management
 * @returns True if uv is installed and accessible
 */
export async function checkUvAvailable(): Promise<boolean> {
  try {
    execSync('uv --version', { stdio: 'pipe' });
    execSync(`uv python find ${ONTOLOGY_PYTHON_VERSION}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
