---
title: FSD (Full Self Driving)
type: skill
scope: harness
updated: 2026-07-19
sources:
  - .codex/skills/fsd/SKILL.md
related:
  - [[goal]]
  - [[pipeline]]
  - [[homework]]
  - [[omcodex-loop]]
  - [[R001]]
  - [[R009]]
  - [[R010]]
  - [[R017]]
  - [[R020]]
---

# FSD (Full Self Driving)

Autonomous release loop — processes all auto-dev-eligible GitHub issues until none remain, by repeatedly running `/pipeline auto-dev` then `/homework`.

## Overview

Thin alias / orchestrator skill. FSD expands into:

```
/omcustomcodex:goal "모든 이슈가 처리될 때까지" /omcustomcodex:loop "/pipeline auto-dev -> /homework"
```

It does not implement loop logic, issue-polling, release steps, or verification itself — it delegates entirely to [[goal]], [[pipeline]], [[homework]], and [[omcodex-loop]]. The loop converges naturally when the auto-dev-eligible issue set reaches zero.

## Key Details

- **Scope**: harness
- **User-invocable**: yes
- **Command**: `$omcustomcodex:fsd` (Codex/OMX); `/omcustomcodex:fsd` (Claude compatibility)
- **Argument hint**: `[<max-releases>]`
- **Version**: 0.1.0
- **Effort**: high

## Usage

```bash
/omcustomcodex:fsd        # Run until all auto-dev-eligible issues are exhausted
/omcustomcodex:fsd 3      # Optional: cap at N releases (default: unlimited)
```

## Iteration Flow

Each FSD iteration:

```
[FSD Iteration N]
├── /pipeline auto-dev   → one release (PR → merge → npm publish → milestone close)
├── /homework            → retrospective 찐빠 audit gate
└── Check: any eligible issues remain?
    ├── YES → next iteration
    └── NO  → [FSD Done] converged naturally
```

Issue eligibility follows `/pipeline auto-dev` label selection exactly — included: `verify-ready`, unlabeled candidates; excluded: `verify-done`, `needs-review`, `decision-needed`.

## Managed Shell Advisor Preflight

Before implementation or release commands, every iteration runs `omcustomcodex doctor --require-shell-advisor`. The gate passes only when the exact project-managed Bash advisor matches packaged registry/script bytes and Codex app-server reports that exact entry enabled and trusted or runtime-managed. Generic OMX/plugin hook readiness is not a substitute.

A missing managed install is repaired with `omcustomcodex update --hooks`. In a source checkout this is a registry-only bootstrap: it verifies the selected source assets are regular, single-link, byte-identical files and preserves them even when the release runs from a linked worktree. If source assets are modified, restore the reviewed tracked source instead of force-overwriting it; never bypass the source guard through `installNativeCodexHooks` or another internal installer. Packaged installs may still use `omcustomcodex update --hooks --force-overwrite-all` after review and backup.

For an inactive result, verify both the user-level `[features] hooks = true` setting and project trust through `/hooks`, because an untrusted linked worktree can also appear inactive. Approval remains manual; FSD never writes trust state automatically.

Official Code Mode already sends nested `tools.exec_command` through Bash `PreToolUse`. JavaScript gates inspect the completed result's numeric `exit_code`, polling an active session until terminal. They do not add an outer parser/matcher, infer success from stdout, or append shell special-variable probes such as `status=$?`.

## Safety and Discipline

FSD operates under full project rules without relaxation:

| Rule | Constraint |
|------|------------|
| [R001](../rules/r001.md) | Destructive ops require explicit approval; credential guardrails always active |
| [R009](../rules/r009.md) | Independent subtasks within each iteration run in parallel |
| [R010](../rules/r010.md) | File ownership and delegation discipline still applies |
| [R017](../rules/r017.md) | Structural verification passes before commit/push |
| [R020](../rules/r020.md) | Exact advisor preflight plus registry/release/issue evidence is required before `[Done]` |

`/homework` is a retrospective gate between iterations. If homework requires user confirmation, the loop pauses and waits.

## When to Use / Avoid

| Scenario | Use FSD? |
|----------|----------|
| Multiple eligible issues, "let it run" autonomously | YES |
| Single targeted fix | NO — use `/pipeline auto-dev` directly |
| Issues require design decisions or stakeholder approval | NO |
| Only `decision-needed` / `needs-review` issues remain | NO — loop converges immediately |
| Cost-sensitive, large backlog | Inspect eligible set first |

## Relationships

- **Delegates to**: [[goal]], [[pipeline]], [[homework]], [[omcodex-loop]]
- **Rules**: [R001](../rules/r001.md), [R009](../rules/r009.md), [R010](../rules/r010.md), [R017](../rules/r017.md), [R020](../rules/r020.md)

## Sources

- `.codex/skills/fsd/SKILL.md` — skill definition
