import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const LOCAL_GIT_ENVIRONMENT_VARIABLES = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
] as const;

export function createIsolatedGitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of LOCAL_GIT_ENVIRONMENT_VARIABLES) delete env[name];
  return env;
}

/** Resolve the requested checkout itself without applying linked-worktree promotion. */
export function resolveCodexTargetRoot(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function readRegularSingleLinkFile(path: string): string | null {
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) return null;
    return readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
}

function hasCheckoutMaterializationEvidence(commonDir: string, candidate: string): boolean {
  // A separate Git directory ending in `.git` is structurally indistinguishable
  // from a standard main checkout through linked-worktree metadata alone.
  // Require at least one materialized top-level entry that is tracked by HEAD,
  // then prove the bounded candidate entries match HEAD by content and type.
  // A same-name storage file is not checkout evidence. Keep the probe bounded
  // and fail closed for huge/empty/fully-deleted or command-failure cases.
  const entries = readdirSync(candidate)
    .filter((entry) => entry !== '.git')
    .sort()
    .slice(0, 128);
  if (entries.length === 0) return false;

  try {
    const env = createIsolatedGitEnvironment();
    const output = execFileSync(
      'git',
      [
        '--literal-pathspecs',
        '--git-dir',
        commonDir,
        'ls-tree',
        '-z',
        '--name-only',
        'HEAD',
        '--',
        ...entries,
      ],
      {
        cwd: candidate,
        encoding: 'buffer',
        maxBuffer: 64 * 1024,
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2_000,
      }
    );
    if (output.length === 0) return false;

    execFileSync(
      'git',
      [
        '--literal-pathspecs',
        '--git-dir',
        commonDir,
        '--work-tree',
        candidate,
        'diff',
        '--quiet',
        '--no-ext-diff',
        '--no-textconv',
        'HEAD',
        '--',
        ...entries,
      ],
      {
        cwd: candidate,
        env,
        maxBuffer: 64 * 1024,
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 2_000,
      }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the checkout Codex treats as authoritative for project hooks.
 * Only Git's standard linked-worktree layout is promoted to the main checkout;
 * every ambiguous or non-standard repository shape stays on the target root.
 */
export function resolveCodexProjectRoot(projectRoot: string): string {
  const fallback = resolveCodexTargetRoot(projectRoot);
  const dotGitPath = join(fallback, '.git');
  const dotGit = readRegularSingleLinkFile(dotGitPath);
  const gitDirMatch = dotGit?.match(/^gitdir:\s*(.+)$/);
  if (!gitDirMatch) return fallback;

  try {
    const gitDir = realpathSync(resolve(dirname(dotGitPath), gitDirMatch[1]));
    if (basename(dirname(gitDir)) !== 'worktrees') return fallback;

    const worktreeGitFile = readRegularSingleLinkFile(join(gitDir, 'gitdir'));
    if (
      !worktreeGitFile ||
      realpathSync(resolve(gitDir, worktreeGitFile)) !== realpathSync(dotGitPath)
    ) {
      return fallback;
    }

    const commonDirValue = readRegularSingleLinkFile(join(gitDir, 'commondir'));
    if (!commonDirValue) return fallback;
    const commonDir = realpathSync(resolve(gitDir, commonDirValue));
    if (basename(commonDir) !== '.git') return fallback;
    const commonConfig = readRegularSingleLinkFile(join(commonDir, 'config'));
    if (!commonConfig || /^\s*worktree\s*=/im.test(commonConfig)) return fallback;
    if (realpathSync(dirname(dirname(gitDir))) !== commonDir) return fallback;

    const candidate = realpathSync(dirname(commonDir));
    if (realpathSync(join(candidate, '.git')) !== commonDir) return fallback;
    if (!hasCheckoutMaterializationEvidence(commonDir, candidate)) return fallback;
    return candidate;
  } catch {
    return fallback;
  }
}
