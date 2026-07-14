---
name: professor-triage
description: Analyze GitHub issues against the current codebase and perform automated triage with priority assessment
scope: harness
version: 2.4.0
user-invocable: true
effort: high
context: fork
argument-hint: "[issue-numbers...] [--label <label>] [--state <state>] [--since <date>]"
---

# /professor-triage - Codebase-Driven Issue Triage

## Purpose

Analyze GitHub issues against the current codebase. For each issue, search relevant code, assess impact and blast radius, determine whether the issue has already been resolved, and perform low-risk triage actions with evidence.

**Full phase detail**: `guides/professor-triage/phases.md`
**Checklist**: `guides/professor-triage/checklists.md`

## Usage

```bash
/professor-triage
/professor-triage 587 589 590
/professor-triage --label codex-release
/professor-triage --since 2026-03-20
```

## Workflow Contract

| Phase | Name | Owner | Notes |
|-------|------|-------|-------|
| 1 | Gather | Orchestrator | Fetch issue metadata and labels |
| 2 | Codebase Analysis | Explore agents | Parallel code search and evidence mapping |
| 3 | Cross-Analyze | Orchestrator or synthesis agent | Duplicate, priority, and action decisions |
| 4 | Multi-Perspective Output | delegated analysis agents | Architect, colleague, professor synthesis, artifact |
| 5 | Act | mgr-gitnerd | Labels, comments, close decisions |

## Delegation Contract

| Phase | Agent | Mode |
|-------|-------|------|
| Phase 2 codebase search | Explore | bypassPermissions |
| Phase 4A Senior Architect | general-purpose | bypassPermissions |
| Phase 4B Project Colleague | general-purpose | bypassPermissions |
| Phase 4C Professor Synthesis | general-purpose | bypassPermissions |
| Phase 4D triage comment | mgr-gitnerd | bypassPermissions |
| Phase 4E artifact report | general-purpose | bypassPermissions |
| Phase 5 GitHub actions | mgr-gitnerd | bypassPermissions |

Agent selection constraint: artifact-writing delegated agents need Bash access for compatibility-path bypasses. Do not use an agent whose tool policy prevents the required artifact protocol.

## Parallelization

- 1-3 issues: one Explore agent per issue, parallel when useful.
- 4-10 issues: parallel Explore agents, max 4 concurrent.
- 10+ issues: prefer a coordinated team surface when available.
- Phase 4A and 4B are parallel; Phase 4C waits for both; Phase 4D and 4E are parallel after synthesis.

## Sensitive-path compatibility note

Codex-native artifacts go under `.codex/outputs/sessions/YYYY-MM-DD/professor-triage-HHmmss.md` and may be written with the repo's normal file-write APIs.

If a delegated task must create, inspect, or modify Claude compatibility artifacts under `.claude/**`, `.claude/outputs/**`, or `templates/.claude/**`, include this block in the delegated prompt:

```text
Sensitive-path compatibility note:
1. Keep Codex-native .codex/** artifacts on the normal file-write path.
2. On Claude Code v2.1.121+ with bypassPermissions, direct writes to .claude/skills/, .claude/agents/, and .claude/commands/ are allowed.
3. On Claude Code v2.1.126+ with bypassPermissions, broader protected paths such as .claude/**, .git/**, and .vscode/** are also covered.
4. Use /tmp/professor-triage-<timestamp>.md only as a legacy fallback when the runtime is older or still prompts, then verify the resulting diff.
```

This protocol must be inline in the delegate prompt; relying on this SKILL.md being present in the parent context is not enough.

## Phase 5 Action Policy

Automatic, low-risk actions:
- Issue already resolved by commit: close as completed with evidence comment.
- Not applicable to the Codex port: close as not planned with evidence.
- Duplicate series: close older duplicate and keep the canonical issue open.
- Completed analysis: add `verify-done` only after evidence is current.
- Priority assignment: add `P1`/`P2`/`P3` when supported by analysis.

Confirmation required: issue reopen, new issue creation, epic rewrites, or issue body modification.

## Permission Mode

When spawning agents, explicitly pass `mode: "bypassPermissions"` if the runtime supports it. Defaults may override agent frontmatter and reintroduce permission prompts during unattended execution.
