---
title: Pipeline
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/pipeline/SKILL.md
  - .codex/skills/pipeline/workflows/auto-dev.yaml
related:
  - [[dag-orchestration]]
  - [[pipeline-guards]]
  - [[task-decomposition]]
  - [[professor-triage]]
  - [[deep-verify]]
---

# Pipeline

Invoke and resume YAML-defined pipelines — `$pipeline auto-dev` runs the full release pipeline in Codex/OMX (`/pipeline auto-dev` in Claude Code).

## Overview

YAML-based pipeline executor. In list mode, scans `workflows/*.yaml`; in run mode, validates a pipeline and executes skill, prompt, foreach, and independent parallel steps. Native Codex parallel dispatch uses installed `agent_type` roles and active runtime permissions with no `mode` field. Claude compatibility `Agent` calls preserve `mode: "bypassPermissions"` only when that session already uses bypass permissions. State is tracked per step and resume restarts from the failed step.

## Key Details

- **Scope**: harness
- **User-invocable**: yes
- **Command**: `$pipeline` (Codex/OMX); `/pipeline` (Claude Code compatibility)
- **Effort**: high
- **Argument hint**: `<pipeline-name> | resume | (no args to list available)`
- **Source**: external (github: baekenough/baekenough-skills v1.0.0)
- **Permission boundary**: provider-specific per R010; parallel steps remain independent and capped by R009/pipeline guards

## auto-dev Pipeline Steps

The `auto-dev` workflow runs a full issue-to-release cycle: `preflight-sync -> issue-analysis -> scope-selection -> plan -> deep-plan -> implement -> verify-build -> deep-verify -> release -> publish -> followup`.

### Phase 0: Remote Sync and Stale Context Guard

`preflight-sync` now starts by synchronizing local git state before issue triage:

1. `git fetch --all --tags --prune`
2. Detect behind count against `origin/<current_branch>`
3. If behind > 0 and the worktree is clean, run `git pull --ff-only`
4. If behind > 0 and the worktree is dirty, halt for manual reconciliation
5. Report latest tag, local HEAD, and synced/behind state
6. Warn when open issue bodies reference `vX.Y.Z` tags that do not exist locally

This prevents stale session memory or stale local refs from selecting the wrong release version or re-processing already released work.

### Label Standards and Scope Selection

Label semantics live in `.codex/skills/pipeline/labels.md`. `scope-selection` excludes decision-blocked, `needs-review`, `verify-done`, manual-action, and `in-progress` issues, while preferring `verify-ready`, `codex-release`, `oh-my-codex-release`, `claude-code-release`, and documentation issues.

Milestone creation now checks all milestone states first. A closed matching milestone halts the run and requires a version bump or manual reopen; an open matching milestone is reused.

### verify-build: Mandatory Bun Test Baseline

`verify-build` now makes `bun test` mandatory for Node/Bun projects:

1. `bun install`
2. `bun run lint` when available
3. `bun run typecheck` when available
4. `bun test` with a prior-version baseline and failure-delta check
5. `bun run build` when available

The current Codex-port baseline is 0 failures. Any new test failure above baseline halts release.

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[dag-orchestration]], [[pipeline-guards]], [[task-decomposition]], [[professor-triage]], [[deep-verify]]
- **See also**: [[R009]], [[R010]]

## Sources

- `.codex/skills/pipeline/SKILL.md` — skill definition
- `.codex/skills/pipeline/workflows/auto-dev.yaml` — auto-dev workflow YAML
