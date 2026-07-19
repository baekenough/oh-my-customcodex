---
title: Pipeline
type: skill
updated: 2026-07-19
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

The `auto-dev` workflow runs a full issue-to-release cycle: `preflight-sync -> issue-analysis -> scope-selection -> plan -> deep-plan -> implement -> release-prepare -> verify-build -> deep-verify (pending) -> verification-artifact (release branch + local Lore commit + exact-SHA artifact) -> release (push/PR/merge only) -> publish/CI -> post-release-verification-artifact -> followup`.

### Phase 0: Remote Sync and Stale Context Guard

`preflight-sync` now starts by synchronizing local git state before issue triage:

1. `git fetch --all --tags --prune`
2. Detect behind count against `origin/<current_branch>`
3. If behind > 0 and the worktree is clean, run `git pull --ff-only`
4. If behind > 0 and the worktree is dirty, halt for manual reconciliation
5. Report latest tag, local HEAD, and synced/behind state
6. Warn when open issue bodies reference `vX.Y.Z` tags that do not exist locally

Before implementation or release commands, preflight also requires `omcustomcodex doctor --require-shell-advisor`. Missing package-managed hook assets may be restored with `omcustomcodex update --hooks`; modified registry or script bytes require review and backup before the explicit `--force-overwrite-all` restoration path. An inactive result requires both user-level feature enablement and project trust plus `/hooks` review, because an untrusted linked worktree may be reported as inactive. Approval remains manual. Generic plugin readiness and automatic trust mutation never satisfy this gate.

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

### Release Preparation and Durable Verification Artifact Gate

`release-prepare` resolves the exact target and finalizes version, changelog, documentation, templates, and generated release source locally without committing. `verify-build` accepts only explicitly allowlisted generated drift, reads it back, and uses a private temporary index to materialize the complete final worktree/index as a verified Git `reviewedTree` without changing the real index. Pipeline-deferred deep-verify supplies the exact binary diff from `develop` to that tree to all six reviewers; it never falls back to the pre-implementation `HEAD` or a live dirty diff. A later scope or non-allowlisted source change starts a new acyclic preparation/verification run; the DAG never jumps backward.

All deep-verify paths—standard, docs-only self-review, lite deterministic review, and converged substitution—must finish with one schema-compatible artifact for the exact repository, release version, and verified SHA. In `auto-dev`, Rounds 1–7 produce an incomplete pending handoff pinned to `reviewedTree`. The immediately dependent `verification-artifact` step places `release/v<version>`, stages exactly that tree, creates the sole local Lore commit, proves the staged and committed trees both equal `reviewedTree`, and only then runs helper `write`, `validate`, and exact `select`. Until that finalizer succeeds, deep-verify is neither completed nor `READY`; no later tracked source mutation is allowed. `release` only reads back that immutable identity and performs push/PR/merge operations.

After repository automation publishes the release, `post-release-verification-artifact` re-verifies the immutable merge SHA and creates a distinct merge-SHA artifact before followup consumes Source B. Post-merge install and test commands first enter and validate the physical verification worktree in one compound shell, requiring `PWD`, Git top-level, and full `HEAD` to match the reviewed path and release SHA before either command runs. Artifact helper operations remain separate: the caller preserves the intended project cwd, resolves the helper relative to the currently loaded `deep-verify/SKILL.md`, omits the helper-owned count marker from its body, and uses `write` → `validate` → exact `select` to pin the supplied project path and correlate repository/version/SHA/path identity. Missing or malformed evidence, wrong cwd or release/SHA correlation, undecodable canonical candidates, or artifact write/readback failure blocks the pipeline.

Code Mode command gates use the nested tool result's numeric `exit_code`. If a session is still running, the workflow polls it to a terminal result; pass-looking stdout and shell probes such as `status=$?` are not completion evidence.

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[dag-orchestration]], [[pipeline-guards]], [[task-decomposition]], [[professor-triage]], [[deep-verify]]
- **See also**: [[R009]], [[R010]]

## Sources

- `.codex/skills/pipeline/SKILL.md` — skill definition
- `.codex/skills/pipeline/workflows/auto-dev.yaml` — auto-dev workflow YAML
