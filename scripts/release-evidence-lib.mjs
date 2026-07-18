import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

export const REDACTED = '[REDACTED]';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const GENERIC_SECRET_PATTERNS = [
  /(?:npm|ghp|gho|ghs)_[A-Za-z0-9_-]{20,}/g,
  /github_pat_[A-Za-z0-9_]{40,}/g,
  /Bearer\s+[A-Za-z0-9._-]{20,}/g,
  /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g,
];

function redactString(value, secrets) {
  let detected = false;
  let output = value;
  for (const secret of [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length)) {
    if (output.includes(secret)) {
      detected = true;
      output = output.split(secret).join(REDACTED);
    }
  }
  for (const pattern of GENERIC_SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(output)) {
      detected = true;
      pattern.lastIndex = 0;
      output = output.replace(pattern, REDACTED);
    }
  }
  return { value: output, detected };
}

export function redactEvidenceText(value, { secrets = [] } = {}) {
  let detected = false;
  const visit = (input) => {
    if (typeof input === 'string') {
      const redacted = redactString(input, secrets);
      detected ||= redacted.detected;
      return redacted.value;
    }
    if (Array.isArray(input)) return input.map(visit);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).map(([key, nested]) => [key, visit(nested)]));
    }
    return input;
  };
  return { value: visit(value), detected };
}

function lexicallyContained(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

async function nearestExisting(candidate) {
  let current = candidate;
  while (true) {
    try {
      return { path: current, real: await realpath(current), stats: await lstat(current) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

const DARWIN_ROOT_ALIAS_TARGETS = new Map([
  ['/etc', '/private/etc'],
  ['/tmp', '/private/tmp'],
  ['/var', '/private/var'],
]);

async function isTrustedDarwinRootAlias(path) {
  const trustedTarget = process.platform === 'darwin' ? DARWIN_ROOT_ALIAS_TARGETS.get(path) : null;
  return Boolean(trustedTarget && (await realpath(path)) === trustedTarget);
}

async function assertNoUnsafeAncestorSymlink(existingPath) {
  const root = parse(existingPath).root;
  let current = root;
  for (const segment of existingPath.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, segment);
    const stats = await lstat(current);
    if (!stats.isSymbolicLink()) continue;
    if (!(await isTrustedDarwinRootAlias(current))) {
      throw new Error(`evidence directory has an unsafe ancestor symbolic link: ${current}`);
    }
  }
}

async function assertSafeEvidenceAncestor(existing) {
  await assertNoUnsafeAncestorSymlink(existing.path);
  if (existing.stats.isSymbolicLink()) {
    if (!(await isTrustedDarwinRootAlias(existing.path))) {
      throw new Error(`evidence directory has an unsafe ancestor: ${existing.path}`);
    }
    return;
  }
  if (!existing.stats.isDirectory()) {
    throw new Error(`evidence directory has an unsafe ancestor: ${existing.path}`);
  }
}

export async function assertSafeEvidenceDestination(candidate, { protectedPaths = [] } = {}) {
  const requested = resolve(candidate);
  if (requested === parse(requested).root) {
    throw new Error(
      `evidence directory must be a dedicated leaf, not a filesystem root: ${candidate}`
    );
  }

  const requestedStats = await lstat(requested).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (requestedStats) {
    if (requestedStats.isSymbolicLink()) {
      throw new Error(`evidence directory must not be a symbolic link: ${candidate}`);
    }
    throw new Error(`evidence directory must be an absent dedicated leaf: ${candidate}`);
  }

  const existing = await nearestExisting(requested);
  await assertSafeEvidenceAncestor(existing);
  const missingSuffix = relative(existing.path, requested);
  if (
    !missingSuffix ||
    missingSuffix === '..' ||
    missingSuffix.startsWith(`..${sep}`) ||
    isAbsolute(missingSuffix)
  ) {
    throw new Error(`evidence directory must be an absent dedicated leaf: ${candidate}`);
  }
  const canonicalCandidate = resolve(existing.real, missingSuffix);
  if (canonicalCandidate === parse(canonicalCandidate).root) {
    throw new Error(
      `evidence directory must be a dedicated leaf, not a filesystem root: ${candidate}`
    );
  }

  for (const protectedPath of protectedPaths.filter(Boolean)) {
    const canonicalProtected = await realpath(protectedPath).catch(() => resolve(protectedPath));
    if (
      lexicallyContained(canonicalCandidate, canonicalProtected) ||
      lexicallyContained(canonicalProtected, canonicalCandidate)
    ) {
      throw new Error(
        `evidence directory must be outside every protected repository, cwd, home directory, and ancestor: ${candidate}`
      );
    }
  }
  return canonicalCandidate;
}

export async function assertSafeExistingDirectory(candidate, { protectedPaths = [] } = {}) {
  const requested = resolve(candidate);
  const stats = await lstat(requested);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`trusted input directory must be a real directory: ${candidate}`);
  }
  await assertNoUnsafeAncestorSymlink(requested);
  const canonicalCandidate = await realpath(requested);
  for (const protectedPath of protectedPaths.filter(Boolean)) {
    const canonicalProtected = await realpath(protectedPath).catch(() => resolve(protectedPath));
    if (
      lexicallyContained(canonicalCandidate, canonicalProtected) ||
      lexicallyContained(canonicalProtected, canonicalCandidate)
    ) {
      throw new Error(
        `trusted input directory must be outside every protected repository, cwd, home directory, and ancestor: ${candidate}`
      );
    }
  }
  return canonicalCandidate;
}

export async function assertPathContained(root, candidate, label = 'path') {
  const rootStats = await lstat(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`canonical root must be a real directory: ${root}`);
  }
  const requestedRoot = resolve(root);
  const requestedCandidate = resolve(candidate);
  const requestedRelative = relative(requestedRoot, requestedCandidate);
  if (
    requestedRelative === '..' ||
    requestedRelative.startsWith(`..${sep}`) ||
    isAbsolute(requestedRelative)
  ) {
    throw new Error(`${label} is outside canonical root: ${candidate}`);
  }
  const canonicalRoot = await realpath(root);
  const requested = resolve(canonicalRoot, requestedRelative);
  const existing = await nearestExisting(requested);
  if (!lexicallyContained(canonicalRoot, existing.real)) {
    throw new Error(
      `${label} resolves outside canonical root through a symbolic link: ${candidate}`
    );
  }
  return requested;
}

const ISOLATED_ENV_ALLOWLIST = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NO_COLOR',
  'TERM',
  'CI',
]);

function isolatedEnv(baseEnv, paths) {
  const env = {
    ...Object.fromEntries(
      Object.entries(baseEnv).filter(
        ([name, value]) => ISOLATED_ENV_ALLOWLIST.has(name) && typeof value === 'string'
      )
    ),
    HOME: paths.home,
    USERPROFILE: paths.home,
    CODEX_HOME: paths.codexHome,
    TMPDIR: paths.temp,
    TMP: paths.temp,
    TEMP: paths.temp,
    npm_config_cache: paths.cache,
    npm_config_userconfig: paths.userconfig,
    npm_config_prefix: paths.prefix,
    npm_config_ignore_scripts: 'false',
    npm_config_registry: 'https://registry.npmjs.org/',
    GIT_CONFIG_GLOBAL: paths.gitconfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CEILING_DIRECTORIES: paths.root,
    INIT_CWD: paths.cwd,
  };
  return env;
}

export async function createIsolatedExecutionRoots({
  baseDir,
  repositoryRoot,
  baseEnv = process.env,
}) {
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  const makeConsumer = async (name) => {
    const root = join(baseDir, name);
    const paths = {
      root,
      cwd: join(root, 'project'),
      home: join(root, 'home'),
      codexHome: join(root, 'codex-home'),
      cache: join(root, 'npm-cache'),
      prefix: join(root, 'npm-prefix'),
      temp: join(root, 'tmp'),
      userconfig: join(root, 'npmrc'),
      gitconfig: join(root, 'gitconfig'),
    };
    await Promise.all(
      [paths.cwd, paths.home, paths.codexHome, paths.cache, paths.prefix, paths.temp].map((path) =>
        mkdir(path, { recursive: true, mode: 0o700 })
      )
    );
    await Promise.all([
      writeFile(paths.userconfig, 'ignore-scripts=false\nregistry=https://registry.npmjs.org/\n', {
        mode: 0o600,
      }),
      writeFile(paths.gitconfig, '', { mode: 0o600 }),
    ]);
    await Promise.all([chmod(paths.userconfig, 0o600), chmod(paths.gitconfig, 0o600)]);
    return { cwd: paths.cwd, env: isolatedEnv(baseEnv, paths), ...paths };
  };
  const repositoryEnvironment = await makeConsumer('repository');
  return {
    repository: {
      ...repositoryEnvironment,
      cwd: canonicalRepositoryRoot,
      env: { ...repositoryEnvironment.env, INIT_CWD: canonicalRepositoryRoot },
    },
    unscoped: await makeConsumer('unscoped'),
    scoped: await makeConsumer('scoped'),
  };
}

export async function replaceRegularFileAtomically(outputPath, contents) {
  const outputStats = await lstat(outputPath).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (outputStats && (outputStats.isSymbolicLink() || !outputStats.isFile())) {
    throw new Error('atomic output path must be a regular file or absent');
  }

  const temporaryPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(temporaryPath, contents, { flag: 'wx', mode: 0o600 });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

const SAFE_EVIDENCE_FILES = new Set([
  'manifest.json',
  'subgates.json',
  'inventory-unscoped.json',
  'inventory-scoped.json',
  'parity.json',
  'tracked-entry-types.json',
  'external-state.json',
  'SHA256SUMS',
]);

async function listFiles(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const relativePath = join(prefix, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`evidence must not contain a symbolic link: ${relativePath}`);
    if (entry.isDirectory()) files.push(...(await listFiles(root, relativePath)));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`unsupported evidence entry: ${relativePath}`);
  }
  return files;
}

function evidenceAllowed(relativePath) {
  return SAFE_EVIDENCE_FILES.has(relativePath) || relativePath.endsWith('.log');
}

export function validateRequiredGateSchema(gates = []) {
  for (const gate of gates) {
    if (!['PASS', 'FAIL'].includes(gate?.status)) continue;
    const invalid = [
      ['name', typeof gate.name === 'string' && gate.name.length > 0],
      [
        'startedAt',
        typeof gate.startedAt === 'string' && !Number.isNaN(Date.parse(gate.startedAt)),
      ],
      [
        'durationMs',
        typeof gate.durationMs === 'number' &&
          Number.isFinite(gate.durationMs) &&
          gate.durationMs >= 0,
      ],
      ['log', typeof gate.log === 'string' && gate.log.length > 0],
      ['logSha256', typeof gate.logSha256 === 'string' && /^[a-f0-9]{64}$/.test(gate.logSha256)],
    ]
      .filter(([, valid]) => !valid)
      .map(([field]) => field);
    if (invalid.length > 0) {
      throw new Error(
        `gate schema missing or invalid ${invalid.join(', ')} for ${gate.name ?? '<unnamed>'}`
      );
    }
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Evidence finalization keeps every fail-closed path and cleanup transition explicit.
export async function finalizeEvidence({
  stagingDir,
  evidenceDir,
  manifest,
  secrets = [],
  forceUnsafe = false,
  protectedPaths = [],
}) {
  const safeEvidenceDir = await assertSafeEvidenceDestination(evidenceDir, { protectedPaths });
  try {
    validateRequiredGateSchema(manifest.gates ?? []);

    for (const gate of manifest.gates ?? []) {
      if (!gate.log) continue;
      const logPath = await assertPathContained(stagingDir, join(stagingDir, gate.log), 'gate log');
      const stats = await lstat(logPath).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!stats?.isFile() || stats.isSymbolicLink()) {
        throw new Error(`missing referenced log: ${gate.log}`);
      }
      if (
        ['PASS', 'FAIL'].includes(gate.status) &&
        sha256(await readFile(logPath)) !== gate.logSha256
      ) {
        throw new Error(`gate log hash mismatch before finalization: ${gate.name}`);
      }
    }

    if (forceUnsafe) {
      return { overall: 'FAIL', evidence_safe: false, summary: 'unsafe evidence suppressed' };
    }

    const files = await listFiles(stagingDir);
    for (const relativePath of files) {
      if (!evidenceAllowed(relativePath)) throw new Error(`unsafe evidence path: ${relativePath}`);
      const path = join(stagingDir, relativePath);
      const value = await readFile(path, 'utf8');
      const redacted = redactEvidenceText(value, { secrets });
      if (redacted.detected) await writeFile(path, redacted.value, { mode: 0o600 });
    }

    await rm(join(stagingDir, 'SHA256SUMS'), { force: true });
    const redactedManifest = redactEvidenceText(
      { ...manifest, evidence_safe: true },
      { secrets }
    ).value;
    const redactedGates = [];
    for (const gate of redactedManifest.gates ?? []) {
      if (!gate.log) {
        redactedGates.push(gate);
        continue;
      }
      const logPath = await assertPathContained(stagingDir, join(stagingDir, gate.log), 'gate log');
      redactedGates.push({ ...gate, logSha256: sha256(await readFile(logPath)) });
    }
    validateRequiredGateSchema(redactedGates);
    await writeFile(
      join(stagingDir, 'subgates.json'),
      `${JSON.stringify(redactedGates, null, 2)}\n`,
      { mode: 0o600 }
    );

    const evidenceFiles = {};
    for (const relativePath of (await listFiles(stagingDir))
      .filter((path) => !['manifest.json', 'SHA256SUMS'].includes(path))
      .sort()) {
      evidenceFiles[relativePath] = sha256(await readFile(join(stagingDir, relativePath)));
    }
    const finalManifest = {
      ...redactedManifest,
      gates: redactedGates,
      evidence_safe: true,
      evidenceFiles,
    };
    await writeFile(
      join(stagingDir, 'manifest.json'),
      `${JSON.stringify(finalManifest, null, 2)}\n`,
      { mode: 0o600 }
    );

    for (const relativePath of await listFiles(stagingDir)) {
      const contents = await readFile(join(stagingDir, relativePath), 'utf8');
      if (redactEvidenceText(contents, { secrets }).detected) {
        throw new Error(`evidence remained tainted after redaction: ${relativePath}`);
      }
    }

    const checksumEntries = [];
    for (const relativePath of (await listFiles(stagingDir))
      .filter((path) => path !== 'SHA256SUMS')
      .sort()) {
      checksumEntries.push(
        `${sha256(await readFile(join(stagingDir, relativePath)))}  ${relativePath}`
      );
    }
    await writeFile(join(stagingDir, 'SHA256SUMS'), `${checksumEntries.join('\n')}\n`, {
      mode: 0o600,
    });
    await mkdir(dirname(safeEvidenceDir), { recursive: true });
    await cp(stagingDir, safeEvidenceDir, { recursive: true, errorOnExist: true, force: false });
    return { ...finalManifest, evidence_safe: true, evidenceDir: safeEvidenceDir };
  } catch (error) {
    if (forceUnsafe || /tainted/i.test(error instanceof Error ? error.message : String(error))) {
      return { overall: 'FAIL', evidence_safe: false, summary: 'unsafe evidence suppressed' };
    }
    throw error;
  }
}

function validateTrackedPath(path) {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes('..')) {
    throw new Error(`invalid tracked path: ${path}`);
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Git index identity and working-tree entry validation stay explicit for auditability.
export async function inspectCanonicalTrackedEntries({
  sourceRoot,
  entries,
  requiredSymlinks = [],
}) {
  const sourceCanonical = await realpath(sourceRoot);
  const inventory = [];
  for (const entry of entries) {
    validateTrackedPath(entry.path);
    if (!['100644', '100755', '120000'].includes(entry.mode)) {
      throw new Error(`unsupported git mode ${entry.mode}: ${entry.path}`);
    }
    const sourcePath = await assertPathContained(
      sourceCanonical,
      join(sourceCanonical, entry.path),
      'tracked source'
    );
    const sourceStats = await lstat(sourcePath).catch((error) => {
      if (error.code === 'ENOENT') throw new Error(`tracked entry is missing: ${entry.path}`);
      throw error;
    });
    if (entry.mode === '120000') {
      if (!sourceStats.isSymbolicLink())
        throw new Error(`tracked symlink type mismatch: ${entry.path}`);
      const linkTarget = await readlink(sourcePath);
      const resolvedLinkTarget = resolve(dirname(sourcePath), linkTarget);
      if (!lexicallyContained(sourceCanonical, resolvedLinkTarget)) {
        throw new Error(`tracked symlink escapes canonical root: ${entry.path}`);
      }
      await assertPathContained(sourceCanonical, resolvedLinkTarget, 'tracked symlink target');
      inventory.push({
        path: entry.path,
        type: 'symlink',
        mode: entry.mode,
        linkTarget,
        sha256: sha256(linkTarget),
      });
      continue;
    }
    if (sourceStats.isSymbolicLink() || !sourceStats.isFile()) {
      throw new Error(`tracked regular-file type mismatch: ${entry.path}`);
    }
    const actualMode = (sourceStats.mode & 0o111) === 0 ? '100644' : '100755';
    if (actualMode !== entry.mode) {
      throw new Error(`tracked executable mode mismatch: ${entry.path}`);
    }
    inventory.push({
      path: entry.path,
      type: 'file',
      mode: entry.mode,
      sha256: sha256(await readFile(sourcePath)),
    });
  }
  for (const required of requiredSymlinks) {
    const actual = inventory.find(({ path }) => path === required.path);
    if (!actual) throw new Error(`required tracked symlink is missing: ${required.path}`);
    if (actual.type !== 'symlink' || actual.mode !== '120000') {
      throw new Error(`required tracked symlink type mismatch: ${required.path}`);
    }
    if (actual.linkTarget !== required.linkTarget) {
      throw new Error(`required tracked symlink target mismatch: ${required.path}`);
    }
  }
  return inventory;
}

export async function copyCanonicalTrackedEntries({ sourceRoot, destinationRoot, entries }) {
  const sourceCanonical = await realpath(sourceRoot);
  const destinationCanonical = await realpath(destinationRoot);
  const inventory = await inspectCanonicalTrackedEntries({ sourceRoot: sourceCanonical, entries });
  for (const entry of inventory) {
    const sourcePath = join(sourceCanonical, entry.path);
    const destinationPath = await assertPathContained(
      destinationCanonical,
      join(destinationCanonical, entry.path),
      'tracked destination'
    );
    await mkdir(dirname(destinationPath), { recursive: true, mode: 0o755 });
    if (entry.type === 'symlink') {
      await rm(destinationPath, { force: true });
      await symlink(entry.linkTarget, destinationPath);
      continue;
    }
    await copyFile(sourcePath, destinationPath);
    await chmod(destinationPath, entry.mode === '100755' ? 0o755 : 0o644);
  }
  return inventory;
}
