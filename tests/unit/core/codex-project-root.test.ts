import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createIsolatedGitEnvironment,
  resolveCodexProjectRoot,
} from '../../../src/core/codex-project-root.js';
import { generateLockfile } from '../../../src/core/lockfile.js';

function git(args: string[], cwd: string): void {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    env: createIsolatedGitEnvironment(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
}

describe('Codex authoritative project root', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'omcodex-project-root-'));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('promotes only a standard linked worktree to its main checkout', async () => {
    const main = join(sandbox, 'main');
    const linked = join(sandbox, 'linked');
    await mkdir(main);
    git(['init', '-q'], main);
    await writeFile(join(main, 'README.md'), '# fixture\n');
    git(['add', 'README.md'], main);
    git(
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.com',
        'commit',
        '-qm',
        'fixture',
      ],
      main
    );
    git(['worktree', 'add', '-qb', 'linked-fixture', linked], main);

    const inheritedIndex = process.env.GIT_INDEX_FILE;
    process.env.GIT_INDEX_FILE = '.git/index';
    try {
      expect(resolveCodexProjectRoot(linked)).toBe(await realpath(main));
    } finally {
      if (inheritedIndex === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = inheritedIndex;
    }
    expect(resolveCodexProjectRoot(main)).toBe(await realpath(main));

    const spoof = join(sandbox, 'spoof');
    await mkdir(spoof);
    await writeFile(join(spoof, '.git'), await readFile(join(linked, '.git')));
    expect(resolveCodexProjectRoot(spoof)).toBe(await realpath(spoof));
  });

  it('falls back for separate git dirs, submodule layouts, bare repos, and incomplete metadata', async () => {
    const target = join(sandbox, 'target');
    const separateGitDir = join(sandbox, 'separate.git');
    await Promise.all([mkdir(target), mkdir(separateGitDir)]);
    await writeFile(join(target, '.git'), `gitdir: ${separateGitDir}\n`);
    expect(resolveCodexProjectRoot(target)).toBe(await realpath(target));

    const moduleGitDir = join(sandbox, 'super', '.git', 'modules', 'child');
    await mkdir(moduleGitDir, { recursive: true });
    await writeFile(join(target, '.git'), `gitdir: ${moduleGitDir}\n`);
    expect(resolveCodexProjectRoot(target)).toBe(await realpath(target));

    const incompleteGitDir = join(sandbox, 'lookalike', '.git', 'worktrees', 'child');
    await mkdir(incompleteGitDir, { recursive: true });
    await writeFile(join(target, '.git'), `gitdir: ${incompleteGitDir}\n`);
    expect(resolveCodexProjectRoot(target)).toBe(await realpath(target));

    const bare = join(sandbox, 'bare.git');
    await mkdir(bare);
    await writeFile(join(bare, 'HEAD'), 'ref: refs/heads/main\n');
    expect(resolveCodexProjectRoot(bare)).toBe(await realpath(bare));
  });

  it('does not promote linked worktrees backed by a separate Git directory', async () => {
    const target = join(sandbox, 'target');
    const storage = join(sandbox, 'storage', '.git');
    const linked = join(sandbox, 'linked');
    await mkdir(join(sandbox, 'storage'));
    git(['init', '-q', '--separate-git-dir', storage, target], sandbox);
    await writeFile(join(target, 'README.md'), 'tracked-target\n');
    git(['add', 'README.md'], target);
    git(
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.com',
        'commit',
        '-qm',
        'fixture',
      ],
      target
    );
    git(['worktree', 'add', '-qb', 'separate-linked', linked], target);
    await writeFile(join(sandbox, 'storage', 'README.md'), 'unrelated-storage\n');

    expect(resolveCodexProjectRoot(linked)).toBe(await realpath(linked));

    await mkdir(join(linked, '.codex'), { recursive: true });
    await writeFile(join(linked, '.codex', 'hooks.json'), '{"hooks":{}}\n');
    const lockfile = await generateLockfile(linked, '1.0.13', '1.0.13');
    expect(lockfile.files['.codex/hooks.json']).toEqual(
      expect.not.objectContaining({ root: 'codex-project' })
    );
  });
});
