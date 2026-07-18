---
title: Structured Dev Cycle
type: skill
updated: 2026-07-19
sources:
  - .codex/skills/structured-dev-cycle/SKILL.md
related:
  - [[deep-plan]]
  - [[multi-model-verification]]
  - [[reasoning-sandwich]]
  - [[R018]]
---

# Structured Dev Cycle

6-stage structured development cycle with stage-based tool restrictions.

## Overview

Enforces a disciplined 6-stage cycle: Plan (Read-only) → Verify Plan → Implement (all tools) → Verify Implementation → Compound testing → Done. Stage transitions are enforced via a `/tmp/.codex-dev-stage-$PPID` marker checked by the `stage-blocker.sh` and `task-state-precompact.sh` hooks. The parent-PID suffix prevents one Codex session from blocking another while keeping each session's readers and writers on the same marker. Recommends opus for planning stages, sonnet for implementation, haiku for Done. Supports optional `openai/codex-plugin-cc` interop only when explicitly installed/requested, and Agent Teams for complex tasks (R018). Full cycle for 10+ file changes; abbreviated for smaller tasks.

## Key Details

- **Scope**: core
- **User-invocable**: yes
- **Command**: `/structured-dev-cycle`
- **Effort**: not specified
- **Stage marker**: `/tmp/.codex-dev-stage-$PPID` (session-scoped; contains no sensitive data)

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[deep-plan]], [[multi-model-verification]], [[reasoning-sandwich]]
- **See also**: [[R018]], [[R009]], [[R010]]

## Sources

- `.codex/skills/structured-dev-cycle/SKILL.md` — skill definition
