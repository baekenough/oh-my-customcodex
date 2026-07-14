#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const PACKAGE_NAME = 'oh-my-customcodex';
const SCOPED_PACKAGE_NAME = '@baekenough/oh-my-customcodex';
const GITHUB_PACKAGES_PUBLISH_CONFIG = {
  registry: 'https://npm.pkg.github.com',
  access: 'public',
};
const REQUIRED_NODE_RANGE = '>=23.5.0 || ^22.13.0 || ^20.17.0';
const REQUIRED_NODE_PROBES = [
  '20.17.0',
  '20.99.0',
  '22.13.0',
  '22.99.0',
  '23.5.0',
  '24.0.0',
  '25.0.0',
];
const WEB_ENTRYPOINT = 'packages/serve/build/index.js';
const PLUGIN_MANIFEST = 'plugins/oh-my-customcodex/.codex-plugin/plugin.json';
const PLUGIN_MARKETPLACE = '.agents/plugins/marketplace.json';
const PLUGIN_HOOKS = 'plugins/oh-my-customcodex/hooks/hooks.json';
const PLUGIN_MCP = 'plugins/oh-my-customcodex/.mcp.json';
const WEB_FIXTURE_NAME = 'package-smoke';
const EVAL_FIXTURE_SESSION = 'pc1599';
const ACTIVE_NATIVE_HOOK_SCRIPTS = [
  'codex-native-advisory.sh',
  'destructive-git-guard.sh',
  'file-change-validator.sh',
  'schema-validator.sh',
  'secret-filter.sh',
];

const skipBuild = process.argv.includes('--skip-build');
const keepTemp = process.argv.includes('--keep-temp');

function formatCommand(command, args) {
  return [command, ...args].join(' ');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `${formatCommand(command, args)} exited with ${result.status}${output ? `\n${output}` : ''}`
    );
  }

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function pass(message) {
  console.log(`[package-contract] PASS ${message}`);
}

function rootWorkspaceName(lockfile) {
  const match = lockfile.match(/"workspaces"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"([^"]+)"/);
  assert(match, 'bun.lock is missing the root workspace name');
  return match[1];
}

function packageRelativePath(target, label) {
  assert.equal(typeof target, 'string', `${label} must be a string path`);
  const relativePath = target.replace(/^\.\//, '');
  assert(relativePath.length > 0, `${label} must not be empty`);
  assert(!relativePath.startsWith('/'), `${label} must be package-relative: ${target}`);
  assert(
    !relativePath.split('/').includes('..'),
    `${label} must not escape the package root: ${target}`
  );
  return relativePath;
}

function rootExportTargets(packageJson) {
  const rootExport = packageJson.exports?.['.'];
  const importTarget =
    typeof rootExport === 'string' ? rootExport : (rootExport?.import ?? rootExport?.default);
  const typesTarget =
    typeof rootExport === 'object' && rootExport !== null
      ? (rootExport.types ?? packageJson.types)
      : packageJson.types;

  return {
    importTarget: packageRelativePath(importTarget ?? packageJson.main, 'root import export'),
    typesTarget: packageRelativePath(typesTarget, 'root types export'),
  };
}

function binTargets(packageJson) {
  if (typeof packageJson.bin === 'string') {
    return [packageRelativePath(packageJson.bin, 'bin')];
  }

  assert(packageJson.bin && typeof packageJson.bin === 'object', 'package bin map is required');
  return Object.entries(packageJson.bin).map(([name, target]) =>
    packageRelativePath(target, `bin.${name}`)
  );
}

function parseNodeVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  assert(match, `unsupported Node version: ${version}`);
  return match.slice(1).map(Number);
}

function compareNodeVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

function nodeVersionSatisfies(version, range) {
  const parsedVersion = parseNodeVersion(version);
  return range.split('||').some((rawLane) => {
    const lane = rawLane.trim();
    const match = lane.match(/^(>=|\^)\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    assert(match, `unsupported engines.node lane: ${lane}`);
    const operator = match[1];
    const floor = [Number(match[2]), Number(match[3] ?? 0), Number(match[4] ?? 0)];
    if (compareNodeVersions(parsedVersion, floor) < 0) return false;
    return operator === '>=' || parsedVersion[0] === floor[0];
  });
}

async function packageDirectories(nodeModulesDir) {
  if (!existsSync(nodeModulesDir)) return [];
  const directories = [];
  const entries = await readdir(nodeModulesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (!entry.name.startsWith('@')) {
      directories.push(join(nodeModulesDir, entry.name));
      continue;
    }

    const scopeDir = join(nodeModulesDir, entry.name);
    const scopedEntries = await readdir(scopeDir, { withFileTypes: true });
    for (const scopedEntry of scopedEntries) {
      if (scopedEntry.isDirectory()) directories.push(join(scopeDir, scopedEntry.name));
    }
  }
  return directories;
}

async function installedProductionPackages(consumerDir) {
  const packages = [];

  async function visitPackage(packageDir) {
    const packageJsonPath = join(packageDir, 'package.json');
    if (!existsSync(packageJsonPath)) return;
    packages.push(JSON.parse(await readFile(packageJsonPath, 'utf8')));
    await visitNodeModules(join(packageDir, 'node_modules'));
  }

  async function visitNodeModules(nodeModulesDir) {
    const directories = await packageDirectories(nodeModulesDir);
    for (const packageDir of directories) await visitPackage(packageDir);
  }

  await visitNodeModules(join(consumerDir, 'node_modules'));
  return packages;
}

function assertPackedFile(packageDir, packedPaths, relativePath, label) {
  assert(
    packedPaths.has(relativePath),
    `${label} is absent from npm pack metadata: ${relativePath}`
  );
  assert(existsSync(join(packageDir, relativePath)), `${label} was not extracted: ${relativePath}`);
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });

  const address = server.address();
  assert(address && typeof address === 'object', 'failed to reserve an integration-test port');
  const { port } = address;
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise()))
  );
  return port;
}

async function writeEvaluationFixture(homeDir) {
  const databasePath = join(homeDir, '.oh-my-customcodex', 'eval-core.sqlite');
  await mkdir(dirname(databasePath), { recursive: true });
  const schema = `
    CREATE TABLE agent_invocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_ppid TEXT NOT NULL,
      session_id TEXT,
      timestamp TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      model TEXT NOT NULL,
      outcome TEXT NOT NULL
    );
  `;
  const row = [
    EVAL_FIXTURE_SESSION,
    null,
    '2026-07-13T00:00:00.000Z',
    'package-verifier',
    'gpt-5.6-sol',
    'success',
  ];

  const nodeSqlite = await import('node:sqlite').catch(() => null);
  if (nodeSqlite !== null) {
    const { DatabaseSync } = nodeSqlite;
    const database = new DatabaseSync(databasePath);
    try {
      database.exec(schema);
      database
        .prepare(
          `INSERT INTO agent_invocations
             (session_ppid, session_id, timestamp, agent_type, model, outcome)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(...row);
    } finally {
      database.close();
    }
  } else {
    const script = `
      import { Database } from 'bun:sqlite';
      const db = new Database(process.argv[1]);
      try {
        db.run(${JSON.stringify(schema)});
        db.query(
          'INSERT INTO agent_invocations (session_ppid, session_id, timestamp, agent_type, model, outcome) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(...JSON.parse(process.argv[2]));
      } finally {
        db.close();
      }
    `;
    run('bun', ['-e', script, databasePath, JSON.stringify(row)]);
  }

  return databasePath;
}

async function waitForHttp(url, expectedReachable, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (expectedReachable) {
        assert(response.status < 500, `Web UI returned HTTP ${response.status}`);
        return;
      }
      lastError = new Error(`Web UI is still reachable with HTTP ${response.status}`);
    } catch (error) {
      if (!expectedReachable) return;
      lastError = error;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw lastError ?? new Error(`timed out waiting for ${url}`);
}

async function assertHttpRoutes(baseUrl, routes) {
  for (const { path, expectedBody } of routes) {
    const response = await fetch(new URL(path, baseUrl));
    const body = await response.text();
    assert(
      response.status >= 200 && response.status < 400,
      `${path} returned HTTP ${response.status}: ${body.slice(0, 500)}`
    );
    assert(body.length > 0, `${path} returned an empty response`);
    if (expectedBody) {
      assert(body.includes(expectedBody), `${path} did not render ${expectedBody}`);
    }
  }
}

function tryParseJsonArray(text) {
  try {
    const candidate = JSON.parse(text);
    return Array.isArray(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function parsePackMetadata(stdout) {
  const lines = stdout.split(/\r?\n/);
  let parsed;

  // npm 10 still prints `prepare` lifecycle output before `npm pack --json`
  // metadata even when --ignore-scripts is set. Find the complete JSON array
  // rather than assuming stdout contains JSON and nothing else.
  outer: for (let start = 0; start < lines.length; start += 1) {
    if (lines[start].trim() !== '[') continue;
    for (let end = lines.length - 1; end >= start; end -= 1) {
      if (lines[end].trim() !== ']') continue;
      const candidate = tryParseJsonArray(lines.slice(start, end + 1).join('\n'));
      if (candidate) {
        parsed = candidate;
        break outer;
      }
    }
  }

  assert(parsed, 'npm pack --json output did not contain a valid metadata array');
  assert(Array.isArray(parsed) && parsed.length === 1, 'npm pack --json must return one artifact');
  const [metadata] = parsed;
  assert(metadata?.filename, 'npm pack metadata is missing filename');
  assert(Array.isArray(metadata.files), 'npm pack metadata is missing files');
  return metadata;
}

function assertSafeTarEntries(tarballPath) {
  const tarResult = run('tar', ['-tzf', tarballPath]);
  const tarEntries = tarResult.stdout.split('\n').filter(Boolean);
  assert(tarEntries.length > 0, `packed tarball is empty: ${tarballPath}`);
  for (const entry of tarEntries) {
    assert(entry.startsWith('package/'), `tar entry escaped package/ prefix: ${entry}`);
    assert(!entry.split('/').includes('..'), `tar entry contains path traversal: ${entry}`);
  }
}

async function packAndExtract(sourceDir, packDir, unpackDir) {
  await Promise.all([mkdir(packDir, { recursive: true }), mkdir(unpackDir, { recursive: true })]);
  const packResult = run('npm', [
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    packDir,
    sourceDir,
  ]);
  const metadata = parsePackMetadata(packResult.stdout);
  const tarballPath = join(packDir, metadata.filename);
  assert(existsSync(tarballPath), `npm pack did not create ${tarballPath}`);
  assertSafeTarEntries(tarballPath);
  run('tar', ['-xzf', tarballPath, '-C', unpackDir]);

  const packageDir = join(unpackDir, 'package');
  const packageJson = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
  return {
    metadata,
    packedPaths: new Set(metadata.files.map((file) => file.path)),
    packageDir,
    packageJson,
    tarballPath,
  };
}

async function createScopedPackageSource(unscopedTarballPath, scopedSourceDir) {
  await mkdir(scopedSourceDir, { recursive: true });
  assertSafeTarEntries(unscopedTarballPath);
  run('tar', ['-xzf', unscopedTarballPath, '-C', scopedSourceDir]);
  const packageDir = join(scopedSourceDir, 'package');
  const packageJsonPath = join(packageDir, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  packageJson.name = SCOPED_PACKAGE_NAME;
  packageJson.publishConfig = GITHUB_PACKAGES_PUBLISH_CONFIG;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  // npm 10 always runs `prepare` for a directory pack, including with
  // --ignore-scripts. The real scoped publish runs from the full checkout, so
  // recreate its development-only script in this extracted staging source.
  // The package files allow-list excludes scripts/, and parity verification
  // below proves this helper never reaches either registry artifact.
  const setupHooksDirectory = join(packageDir, 'scripts');
  await mkdir(setupHooksDirectory, { recursive: true });
  await writeFile(
    join(setupHooksDirectory, 'setup-hooks.sh'),
    await readFile(join(REPO_ROOT, 'scripts', 'setup-hooks.sh'))
  );
  return packageDir;
}

function assertPackedArtifactShape(artifact, expectedPackageName) {
  const { packageDir, packageJson, packedPaths } = artifact;
  assert.equal(packageJson.name, expectedPackageName);
  const { importTarget, typesTarget } = rootExportTargets(packageJson);
  assertPackedFile(packageDir, packedPaths, importTarget, 'root import export');
  assertPackedFile(packageDir, packedPaths, typesTarget, 'root types export');
  for (const target of binTargets(packageJson)) {
    assertPackedFile(packageDir, packedPaths, target, 'CLI bin target');
  }

  const declarationPaths = [...packedPaths].filter((path) => path.endsWith('.d.ts'));
  assert(declarationPaths.length > 0, 'tarball contains no TypeScript declarations');
  assertPackedFile(packageDir, packedPaths, WEB_ENTRYPOINT, 'Web runtime entrypoint');
  assertPackedFile(packageDir, packedPaths, PLUGIN_MANIFEST, 'Codex plugin manifest');
  assertPackedFile(packageDir, packedPaths, PLUGIN_MARKETPLACE, 'Codex plugin marketplace');
  assertPackedFile(packageDir, packedPaths, PLUGIN_HOOKS, 'Codex plugin hooks registry');
  assertPackedFile(packageDir, packedPaths, PLUGIN_MCP, 'Codex plugin MCP manifest');
  assert.equal(
    packageJson.engines?.node,
    REQUIRED_NODE_RANGE,
    'engines.node must express every supported Node-major floor without covering known gaps'
  );
  return declarationPaths.length;
}

async function packageFileInventory(packageDir) {
  const inventory = new Map();

  async function walk(directory, relativeDirectory = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      assert(entry.isFile(), `packed artifact contains a non-regular entry: ${relativePath}`);
      const hash = createHash('sha256')
        .update(await readFile(absolutePath))
        .digest('hex');
      inventory.set(relativePath, hash);
    }
  }

  await walk(packageDir);
  return inventory;
}

async function assertArtifactParity(unscopedArtifact, scopedArtifact) {
  assert.deepEqual(
    [...scopedArtifact.packedPaths].sort(),
    [...unscopedArtifact.packedPaths].sort(),
    'registry artifacts expose different package paths'
  );

  const [unscopedInventory, scopedInventory] = await Promise.all([
    packageFileInventory(unscopedArtifact.packageDir),
    packageFileInventory(scopedArtifact.packageDir),
  ]);
  unscopedInventory.delete('package.json');
  scopedInventory.delete('package.json');
  assert.deepEqual(
    [...scopedInventory.entries()],
    [...unscopedInventory.entries()],
    'registry artifacts have different runtime bytes'
  );

  assert.deepEqual(scopedArtifact.packageJson.publishConfig, GITHUB_PACKAGES_PUBLISH_CONFIG);
  const normalizedScopedPackageJson = {
    ...scopedArtifact.packageJson,
    name: unscopedArtifact.packageJson.name,
    publishConfig: unscopedArtifact.packageJson.publishConfig,
  };
  assert.deepEqual(
    normalizedScopedPackageJson,
    unscopedArtifact.packageJson,
    'registry package metadata differs beyond name and publishConfig'
  );
  pass(
    `npm/GitHub Packages artifact parity (${unscopedInventory.size} runtime files, identical paths and SHA-256 bytes)`
  );
}

async function writeConsumerSmokeFiles(consumerDir, packageName) {
  await Promise.all([
    mkdir(join(consumerDir, '.codex', 'agents'), { recursive: true }),
    mkdir(join(consumerDir, '.agents', 'skills', `${WEB_FIXTURE_NAME}-skill`), {
      recursive: true,
    }),
    mkdir(join(consumerDir, 'guides', `${WEB_FIXTURE_NAME}-guide`), { recursive: true }),
  ]);

  await Promise.all([
    writeFile(
      join(consumerDir, 'AGENTS.md'),
      '# Packed Web Fixture\n\nIntegration-only fixture for the packed Web route smoke test.\n'
    ),
    writeFile(
      join(consumerDir, '.codex', 'agents', `${WEB_FIXTURE_NAME}-agent.toml`),
      `name = "${WEB_FIXTURE_NAME}-agent"
description = "Packed agent smoke fixture"
model = "gpt-5.6-sol"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
developer_instructions = """
# Packed Agent

This fixture proves packed native agent TOML routes load.
"""

[[skills.config]]
path = "../../.agents/skills/${WEB_FIXTURE_NAME}-skill/SKILL.md"
enabled = true
`
    ),
    writeFile(
      join(consumerDir, '.agents', 'skills', `${WEB_FIXTURE_NAME}-skill`, 'SKILL.md'),
      `---
name: ${WEB_FIXTURE_NAME}-skill
description: Packed skill smoke fixture
scope: package
---
# Packed Skill

This fixture proves packed skill frontmatter and Markdown routes load.
`
    ),
    writeFile(
      join(consumerDir, 'guides', `${WEB_FIXTURE_NAME}-guide`, 'README.md'),
      `# Packed Guide

This fixture proves packed guide Markdown routes load.
`
    ),
  ]);

  await writeFile(
    join(consumerDir, 'esm-smoke.mjs'),
    `import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import defaultExport, * as library from '${packageName}';

const entryPath = fileURLToPath(import.meta.resolve('${packageName}'));
let packageRoot = dirname(entryPath);
while (!existsSync(join(packageRoot, 'package.json'))) {
  const parent = dirname(packageRoot);
  assert.notEqual(parent, packageRoot, 'could not locate the installed package root');
  packageRoot = parent;
}

const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
assert.equal(packageJson.name, '${packageName}');
assert.equal(typeof library.install, 'function');
assert.equal(typeof library.getPackageRoot, 'function');
assert.equal(library.VERSION, packageJson.version);
assert.equal(defaultExport.VERSION, packageJson.version);
assert.equal(realpathSync(library.getPackageRoot()), realpathSync(packageRoot));
assert(existsSync(library.resolveTemplatePath('manifest.json')));
console.log(JSON.stringify({ version: library.VERSION, packageRoot }));
`
  );

  await writeFile(
    join(consumerDir, 'types-smoke.ts'),
    `import omcustomcodex, {
  VERSION,
  getPackageRoot,
  install,
  resolveTemplatePath,
  type InstallOptions,
} from '${packageName}';

declare const options: InstallOptions;
const version: string = VERSION;
const defaultVersion: string = omcustomcodex.VERSION;
const root: string = getPackageRoot();
const template: string = resolveTemplatePath('manifest.json');
const installFunction: typeof install = install;

void [options, version, defaultVersion, root, template, installFunction];
`
  );

  await writeFile(
    join(consumerDir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
        files: ['types-smoke.ts'],
      },
      null,
      2
    )}\n`
  );
}

async function verifyCleanConsumer({ packageName, artifact, consumerDir, homeDir }) {
  await Promise.all([mkdir(consumerDir, { recursive: true }), mkdir(homeDir, { recursive: true })]);
  await writeFile(
    join(consumerDir, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`
  );
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      artifact.tarballPath,
    ],
    { cwd: consumerDir }
  );
  pass(`${packageName} clean npm consumer install completed`);

  const productionPackages = await installedProductionPackages(consumerDir);
  const engineConstrainedPackages = productionPackages.filter(
    (dependency) => dependency.engines?.node
  );
  for (const dependency of engineConstrainedPackages) {
    if (!dependency.engines?.node) continue;
    for (const version of REQUIRED_NODE_PROBES) {
      assert(
        nodeVersionSatisfies(version, dependency.engines.node),
        `${dependency.name}@${dependency.version} does not support advertised Node ${version} (${dependency.engines.node})`
      );
    }
  }
  pass(
    `${packageName} Node probes are compatible with all ${engineConstrainedPackages.length}/${productionPackages.length} clean-installed production packages`
  );

  await writeConsumerSmokeFiles(consumerDir, packageName);
  const esmResult = run(process.execPath, ['esm-smoke.mjs'], { cwd: consumerDir });
  assert.match(
    esmResult.stdout,
    new RegExp(`"version":"${artifact.packageJson.version.replaceAll('.', '\\.')}"`)
  );
  pass(`${packageName} clean ESM import, VERSION, package root, and template resolution`);

  const tscPath = join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  assert(existsSync(tscPath), 'repository TypeScript compiler is missing; run bun install first');
  run(process.execPath, [tscPath, '--project', join(consumerDir, 'tsconfig.json')]);
  pass(`${packageName} strict clean-consumer TypeScript declaration check`);

  const installedRoot = join(consumerDir, 'node_modules', packageName);
  const installedPackageJson = JSON.parse(
    await readFile(join(installedRoot, 'package.json'), 'utf8')
  );
  assert.equal(installedPackageJson.name, packageName);
  const installedBin =
    typeof installedPackageJson.bin === 'string'
      ? installedPackageJson.bin
      : installedPackageJson.bin?.omcustomcodex;
  const cliPath = join(installedRoot, packageRelativePath(installedBin, 'installed CLI bin'));
  assert(existsSync(cliPath), `installed CLI is missing: ${cliPath}`);

  const hookFixtureDir = join(consumerDir, 'native-hook-footprint');
  await mkdir(hookFixtureDir, { recursive: true });
  const installedPublicApi = await import(
    pathToFileURL(join(installedRoot, 'dist', 'index.js')).href
  );
  const hookInstall = await installedPublicApi.install({
    targetDir: hookFixtureDir,
    components: ['hooks'],
    force: true,
    skipConfirm: true,
  });
  assert.equal(hookInstall.success, true, hookInstall.error);
  const installedHookScripts = (
    await readdir(join(hookFixtureDir, '.codex', 'hooks', 'scripts'))
  ).sort();
  assert.deepEqual(installedHookScripts, [...ACTIVE_NATIVE_HOOK_SCRIPTS].sort());
  assert(
    !existsSync(join(hookFixtureDir, '.codex', 'hooks', 'skill-count-reminder.sh')),
    'packed installer copied a dormant Claude-only root hook'
  );
  pass(
    `${packageName} packed native hook footprint (${installedHookScripts.length} active scripts)`
  );
  assert(
    !existsSync(join(hookFixtureDir, '.codex', 'statusline.sh')),
    'packed installer copied the Claude command statusline into .codex'
  );
  assert(
    !existsSync(join(hookFixtureDir, '.codex', 'settings.local.json')),
    'packed installer wrote Claude statusLine settings into .codex'
  );
  pass(`${packageName} packed Codex-native status surface`);

  const port = await reservePort();
  const webUrl = `http://localhost:${port}`;
  await writeEvaluationFixture(homeDir);
  const webEnv = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    NO_COLOR: '1',
  };
  delete webEnv.OMCODEX_PORT;
  delete webEnv.OMCUSTOM_PORT;
  if (Number(process.versions.node.split('.')[0]) >= 22) {
    // Prove the packed Node server does not rely on Bun when node:sqlite is available.
    webEnv.PATH = [dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter);
  }

  try {
    const startResult = run(process.execPath, [cliPath, 'web', 'start', '--port', String(port)], {
      cwd: consumerDir,
      env: webEnv,
    });
    assert.match(`${startResult.stdout}\n${startResult.stderr}`, new RegExp(String(port)));
    const persistedServeState = JSON.parse(
      await readFile(join(homeDir, '.omcodex-serve.pid'), 'utf8')
    );
    assert.deepEqual(
      {
        version: persistedServeState.version,
        port: persistedServeState.port,
        projectRoot: persistedServeState.projectRoot,
      },
      { version: 1, port, projectRoot: realpathSync(consumerDir) },
      'Web start did not persist the authoritative cross-process endpoint'
    );
    await waitForHttp(webUrl, true);
    const webRoutes = [
      { path: '/graph' },
      { path: `/agents/${WEB_FIXTURE_NAME}-agent`, expectedBody: 'Packed Agent' },
      { path: `/skills/${WEB_FIXTURE_NAME}-skill`, expectedBody: 'Packed Skill' },
      {
        path: `/guides/${WEB_FIXTURE_NAME}-guide/__data.json`,
        expectedBody: 'Packed Guide',
      },
      { path: '/evaluations', expectedBody: EVAL_FIXTURE_SESSION },
    ];
    await assertHttpRoutes(webUrl, webRoutes);
    const evaluationResponse = await fetch(`${webUrl}/evaluations`);
    const evaluationBody = await evaluationResponse.text();
    assert.match(evaluationBody, /1 invocations/);
    pass(`${packageName} packed Web routes (${webRoutes.map(({ path }) => path).join(', ')})`);

    const statusResult = run(process.execPath, [cliPath, 'web', 'status'], {
      cwd: consumerDir,
      env: webEnv,
    });
    assert.match(`${statusResult.stdout}\n${statusResult.stderr}`, new RegExp(String(port)));

    run(process.execPath, [cliPath, 'web', 'stop'], { cwd: consumerDir, env: webEnv });
    await waitForHttp(webUrl, false);
    assert(!existsSync(join(homeDir, '.omcodex-serve.pid')), 'Web stop left the PID file behind');
    pass(`${packageName} clean packed Web start/status/HTTP/stop lifecycle on port ${port}`);
  } finally {
    if (existsSync(join(homeDir, '.omcodex-serve.pid'))) {
      spawnSync(process.execPath, [cliPath, 'web', 'stop'], {
        cwd: consumerDir,
        env: webEnv,
        encoding: 'utf8',
      });
    }
  }

  const resolvedConsumerRoot = realpathSync(installedRoot);
  assert(
    resolvedConsumerRoot.startsWith(realpathSync(dirname(consumerDir))),
    `${packageName} consumer escaped the temporary root`
  );
}

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'omcustomcodex-package-contract-'));
  const repositoryPackageJsonPath = join(REPO_ROOT, 'package.json');
  const repositoryPackageJsonBefore = await readFile(repositoryPackageJsonPath);
  const repositoryPackageJson = JSON.parse(repositoryPackageJsonBefore.toString('utf8'));
  const repositoryBunLock = await readFile(join(REPO_ROOT, 'bun.lock'), 'utf8');
  const unscopedPackDir = join(tempRoot, 'pack', 'npm');
  const scopedPackDir = join(tempRoot, 'pack', 'github');
  const unscopedUnpackDir = join(tempRoot, 'unpacked', 'npm');
  const scopedUnpackDir = join(tempRoot, 'unpacked', 'github');
  const scopedSourceDir = join(tempRoot, 'scoped-source');

  try {
    assert.equal(repositoryPackageJson.name, PACKAGE_NAME, 'package.json has the wrong root name');
    assert.equal(
      rootWorkspaceName(repositoryBunLock),
      PACKAGE_NAME,
      'bun.lock root workspace name must match package.json'
    );
    pass(`root workspace identity (${PACKAGE_NAME})`);

    if (!skipBuild) {
      run('bun', ['run', 'build']);
      pass('release build completed');
    }

    const unscopedArtifact = await packAndExtract(REPO_ROOT, unscopedPackDir, unscopedUnpackDir);
    const scopedPackageSource = await createScopedPackageSource(
      unscopedArtifact.tarballPath,
      scopedSourceDir
    );
    const scopedArtifact = await packAndExtract(
      scopedPackageSource,
      scopedPackDir,
      scopedUnpackDir
    );

    const unscopedDeclarations = assertPackedArtifactShape(unscopedArtifact, PACKAGE_NAME);
    const scopedDeclarations = assertPackedArtifactShape(scopedArtifact, SCOPED_PACKAGE_NAME);
    assert.equal(scopedDeclarations, unscopedDeclarations);
    pass(
      `dual tarball inspection (${unscopedArtifact.packedPaths.size} files, ${unscopedDeclarations} declarations, Web ${WEB_ENTRYPOINT}, engines ${unscopedArtifact.packageJson.engines.node})`
    );
    await assertArtifactParity(unscopedArtifact, scopedArtifact);

    await verifyCleanConsumer({
      packageName: PACKAGE_NAME,
      artifact: unscopedArtifact,
      consumerDir: join(tempRoot, 'consumers', 'npm'),
      homeDir: join(tempRoot, 'homes', 'npm'),
    });
    await verifyCleanConsumer({
      packageName: SCOPED_PACKAGE_NAME,
      artifact: scopedArtifact,
      consumerDir: join(tempRoot, 'consumers', 'github'),
      homeDir: join(tempRoot, 'homes', 'github'),
    });
    pass('npm and GitHub Packages contracts verified end-to-end');
  } finally {
    assert.deepEqual(
      await readFile(repositoryPackageJsonPath),
      repositoryPackageJsonBefore,
      'package verifier mutated the repository package.json'
    );
    if (keepTemp) {
      console.log(`[package-contract] kept temporary workspace: ${tempRoot}`);
    } else {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}
await main();
