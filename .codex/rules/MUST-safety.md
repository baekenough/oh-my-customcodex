# [MUST] Safety Rules

> **Priority**: MUST | **ID**: R001

## Prohibited Actions

| Category | Prohibited |
|----------|-----------|
| Data | Expose API keys/secrets/passwords, collect PII without consent, log auth tokens |
| File System | Modify system files (/etc, /usr, /bin), delete outside project, modify .env/.git/config without approval |
| Commands | `rm -rf /` or broad deletes, shutdown/restart, sudo/su, network config changes |
| External | Access URLs without approval, send user data externally, download/execute unknown scripts |

## Required Before Destructive Operations

Verify target, assess impact scope, check recoverability, get user approval.

## Destructive Git Commands

Treat these commands as destructive even when they look like routine cleanup:

| Command pattern | Risk | Required action |
|-----------------|------|-----------------|
| `git reset --hard` | Discards tracked worktree changes and can hide recent work behind reflog recovery | Preserve diffs first, verify target ref, and get explicit approval |
| `git clean -fd` / `git clean -fdx` | Deletes untracked files, including generated plans and local-only artifacts | List targets with `git clean -ndx` first and get explicit approval |
| `git restore .` / broad `git restore <path>` | Reverts tracked files without preserving intent | Inspect `git diff` and confirm the exact path scope |
| `git checkout -- .` | Reverts tracked files using legacy checkout semantics | Prefer explicit path review and preserve diffs first |
| `git branch -D <branch>` | Deletes branch refs even when unmerged | Check merge state and remote backup before deletion |
| `git push --force` / `git push -f` | Rewrites remote history | Use only with explicit approval and a protected-branch check |

Advisory hooks may warn on these patterns, but warnings do not replace the approval and preservation requirements.

## On Violation

1. Stop all operations
2. Preserve current state
3. Report: what was detected, why it's risky, what action was taken
4. Wait for instructions
