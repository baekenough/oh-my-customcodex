# [MUST] Safety Rules

> **Priority**: MUST | **ID**: R001

## Prohibited Actions

| Category | Prohibited |
|----------|-----------|
| Data | Expose API keys/secrets/passwords, collect PII without consent, log auth tokens |
| File System | Modify system files (/etc, /usr, /bin), delete outside project, modify .env/.git/config without approval |
| Commands | `rm -rf /` or broad deletes, shutdown/restart, sudo/su, network config changes |
| External | Access URLs without approval, send user data externally, download/execute unknown scripts |

## Credential and Shared-Infrastructure Guardrails

- Do not dump credential-store contents, `.env` files, OAuth material, kube secrets, or secret-manager values into transcripts, logs, issue bodies, or summaries. Report only the minimum redacted key names or verification status required for the task.
- Do not rotate, delete, recreate, or replace credentials unless the user explicitly requested that exact credential action.
- Before irreversible action on shared infrastructure or credentials, reconfirm the target, namespace/account/project, requested scope, rollback path, and user authorization.
- Stop instead of chaining privileged actions when the next step would affect a different credential, tunnel, namespace, pod, cluster, account, or shared service than the user requested.
- When a credential/token is needed, ask for the specific value or file before running blind discovery scans (`env | grep`, repo-wide token greps, credential-store dumps). If a classifier blocks a credential action once while a standing user-deny is active, switch to a user-runs command and do not retry by another mechanism.

### Standing User-Deny + Classifier Block

When the user has a standing "do not touch X" constraint and a safety classifier blocks an action on X once, immediately switch to a user-runs command/instruction path. Do not retry the blocked edit, scan, or credential action via another mechanism.

### Infra-Diagnostic File Checks — Metadata, Not Contents

When diagnosing infrastructure or health issues (502s, container state, env/config presence), file checks must stay metadata-only: `ls -la` for existence, size, permissions, and mtime. Do not `cat .env`, inspect credential JSON keys, parse secret-bearing files, or read secret contents into the transcript just to confirm configuration exists.

| Anti-pattern | Required |
|--------------|----------|
| `cat .env` / inspect OAuth or credential keys during a health diagnosis | `ls -la .env` or request the exact value from the user if genuinely needed |

### Infra/Resource Deletion Blast Radius

Before deleting shared infrastructure resources (tunnels, DNS records, k8s resources, load balancers, security groups), enumerate every endpoint, route, selector, target, or rule served by that resource — not only the hostname or object the user named. Prefer reversible disable/detach/stop actions when they satisfy the task.

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


### Pre-Delegation Blast-Radius Enumeration

Before delegating any destructive git command from the table above, enumerate the exact discard targets and present them for explicit approval. Do not delegate destructive operations from a paraphrase such as "discard local changes" without showing what will be lost.

Required evidence before delegation:

| Scope | Command |
|-------|---------|
| Modified/staged tracked files | `git status --short` |
| Uncommitted diff size | `git diff --stat` and `git diff --stat --cached` |
| Stash contents, when relevant | `git stash show --stat` |
| Untracked files at risk, for clean | `git clean -nd` |

Prefer non-destructive alternatives such as `git stash` when the user's goal can be met without permanent loss.

## On Violation

1. Stop all operations
2. Preserve current state
3. Report: what was detected, why it's risky, what action was taken
4. Wait for instructions
