---
title: tracker-checkpoint
type: agent
updated: 2026-04-24
sources:
  - .codex/agents/tracker-checkpoint.md
related:
  - [[pipeline]]
  - [[dag-orchestration]]
  - [[pipeline-guards]]
  - [[r006]]
  - [[r010]]
---

# tracker-checkpoint

Pipeline execution state tracker with checkpoint persistence for `/pipeline resume`, DAG orchestration, and guarded pipeline execution.

## Overview

`tracker-checkpoint` owns checkpoint file operations for resumable pipeline and DAG workflows. It records pipeline starts, step checkpoints, halted failure state, and resume metadata in PPID-scoped `/tmp/.codex-*` state files while the orchestrator keeps scheduling authority.

## Sensitive Compatibility Paths

When work targets `.claude/**`, `templates/.claude/**`, or Claude-compatibility mirrors, `tracker-checkpoint` must avoid direct unattended Write/Edit calls on those paths. It should produce artifacts under `/tmp` and apply them through the repo-approved sensitive-path script/artifact protocol while keeping normal Codex-native `.codex/**` edits reviewable.

## Key Details

- **Model**: sonnet
- **Domain**: universal
- **Tools**: Read, Write, Edit, Bash, Glob, Grep
- **Skills**: `dag-orchestration`, `pipeline-guards`
- **Memory**: project
- **Effort**: medium
- **Permission mode**: bypassPermissions

## Responsibilities

- Create `/tmp/.codex-pipeline-{name}-{PPID}.json` state files at pipeline start
- Update step status, duration, and artifact paths after each checkpoint
- Mark failed runs as `halted` while preserving error context
- Scan checkpoint files and return retry, skip, or abort options for resume flows
- Validate state transitions such as `pending -> running -> completed | failed`

## Relationships

- **Used by**: [[pipeline]], [[dag-orchestration]], [[pipeline-guards]]
- **Related rules**: [[r006]], [[r010]], [[r017]]
- **See also**: [[mgr-sauron]]

## Sources

- `.codex/agents/tracker-checkpoint.md` — agent definition
