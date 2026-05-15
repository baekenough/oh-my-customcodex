# Git Safety Guide

Use this guide when an agent or workflow needs to clean, reset, delete, or rewrite git state. The goal is to preserve user work first, then make the smallest safe git change with clear recovery evidence.

## Destructive Command Reference

| Command | Primary risk | Safer first step |
|---------|--------------|------------------|
| `git reset --hard` | Drops tracked worktree changes | Save `git diff` output or commit/stash intentionally |
| `git clean -fd` / `git clean -fdx` | Deletes untracked files and generated artifacts | Run `git clean -ndx` and inspect the target list |
| `git restore .` | Reverts tracked files broadly | Limit to explicit files after reviewing `git diff` |
| `git checkout -- .` | Legacy broad revert of tracked files | Prefer explicit `git restore -- <file>` with approval |
| `git branch -D <branch>` | Deletes an unmerged branch ref | Check merge state and remote backup first |
| `git push --force` / `git push -f` | Rewrites remote history | Use only with explicit approval and protected-branch checks |

## Preflight Checklist

1. Run `git status --short` and identify tracked, untracked, and ignored files separately.
2. Preserve useful changes with a commit, patch, stash, or copied artifact before cleanup.
3. For branch deletion, run `git branch --merged` and check whether the branch exists on a remote.
4. For release branches, check that a local `release` branch does not block the `release/v*` namespace.
5. State the exact target and recovery path before running the command.

## Recovery Checklist

1. Stop further destructive git commands.
2. Inspect `git reflog` for the prior `HEAD`.
3. Use `git status --short` and `git diff` to identify current loss scope.
4. Recover tracked changes from the reflog or saved patch.
5. Recover untracked files only from backups, editor history, or generated artifacts.

## Agent Workflow Rules

- Verification agents must not clean the worktree to create a baseline.
- Git specialists should commit or otherwise preserve implemented changes before deep verification.
- Release workflows must prefer branch rename over forced deletion when a local `release` branch blocks `release/v*`.
- Advisory hooks are evidence, not permission. A warning still requires the R001 approval path before continuing.

## See Also

- `.codex/rules/MUST-safety.md`
- `.codex/hooks/scripts/destructive-git-guard.sh`
- `.codex/agents/mgr-gitnerd.md`
- `guides/git-worktree-workflow/README.md`
