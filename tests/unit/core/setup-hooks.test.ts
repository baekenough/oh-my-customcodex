import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceScript = fileURLToPath(new URL('../../../scripts/setup-hooks.sh', import.meta.url));
const hookContent = '#!/bin/sh\necho fixture hook\n';
const isolatedEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_INDEX_FILE: undefined,
};

function run(command: string, args: string[], cwd: string) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    env: isolatedEnv,
  });
}

function git(args: string[], cwd: string): string {
  const result = run('git', args, cwd);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function createPackageFixture(root: string): Promise<void> {
  await mkdir(join(root, 'scripts'), { recursive: true });
  await mkdir(join(root, '.husky'), { recursive: true });
  await copyFile(sourceScript, join(root, 'scripts', 'setup-hooks.sh'));
  await writeFile(join(root, '.husky', 'pre-commit'), hookContent, { mode: 0o755 });
}

async function initRepository(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await createPackageFixture(root);
  git(['init', '-b', 'main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test User'], root);
  git(['add', '.'], root);
  git(['commit', '--no-verify', '-m', 'initial'], root);
}

function getHookPath(root: string): string {
  const hookDir = git(['rev-parse', '--git-path', 'hooks'], root);
  return join(isAbsolute(hookDir) ? hookDir : resolve(root, hookDir), 'pre-commit');
}

describe('scripts/setup-hooks.sh', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'omcodex-setup-hooks-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('installs into the Git-native hook path in a normal checkout', async () => {
    const repo = join(tempRoot, 'repo');
    await initRepository(repo);

    const result = run('sh', ['scripts/setup-hooks.sh'], repo);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Pre-commit hook installed successfully!');
    expect(result.stdout).toContain('Git hooks setup complete.');
    const installedHook = getHookPath(repo);
    expect(await readFile(installedHook, 'utf-8')).toBe(hookContent);
    expect((await stat(installedHook)).mode & 0o111).not.toBe(0);
  });

  it('installs into the Git-native hook path in a linked worktree', async () => {
    const repo = join(tempRoot, 'repo');
    const worktree = join(tempRoot, 'linked-worktree');
    await initRepository(repo);
    git(['worktree', 'add', '-b', 'test-worktree', worktree], repo);
    expect((await lstat(join(worktree, '.git'))).isFile()).toBe(true);

    const result = run('sh', ['scripts/setup-hooks.sh'], worktree);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const installedHook = getHookPath(worktree);
    expect(await readFile(installedHook, 'utf-8')).toBe(hookContent);
    expect((await stat(installedHook)).mode & 0o111).not.toBe(0);
  });

  it('truthfully skips a non-Git package directory', async () => {
    const packageDir = join(tempRoot, 'package');
    await createPackageFixture(packageDir);

    const result = run('sh', ['scripts/setup-hooks.sh'], packageDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Skipping Git hooks setup');
    expect(result.stdout).not.toContain('installed successfully');
    expect(result.stdout).not.toContain('Git hooks setup complete.');
    await expect(lstat(join(packageDir, '.git'))).rejects.toThrow();
  });

  it('does not install package-consumer hooks into the containing repository', async () => {
    const consumer = join(tempRoot, 'consumer');
    await mkdir(consumer);
    git(['init', '-b', 'main'], consumer);
    const packageDir = join(consumer, 'node_modules', 'oh-my-customcodex');
    await createPackageFixture(packageDir);
    const consumerHook = getHookPath(consumer);

    const result = run('sh', ['scripts/setup-hooks.sh'], packageDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('package directory is not the Git work-tree root');
    expect(result.stdout).not.toContain('installed successfully');
    await expect(lstat(consumerHook)).rejects.toThrow();
    await expect(lstat(join(packageDir, '.git'))).rejects.toThrow();
  });

  it('returns failure without success output when the Git hook path cannot be created', async () => {
    const repo = join(tempRoot, 'repo');
    await initRepository(repo);
    const blockedHookPath = join(repo, 'blocked-hooks');
    await writeFile(blockedHookPath, 'not a directory');
    git(['config', 'core.hooksPath', 'blocked-hooks'], repo);

    const result = run('sh', ['scripts/setup-hooks.sh'], repo);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Error: unable to create Git hooks directory');
    expect(result.stdout).not.toContain('installed successfully');
    expect(result.stdout).not.toContain('Git hooks setup complete.');
    expect(dirname(getHookPath(repo))).toBe(blockedHookPath);
  });
});
