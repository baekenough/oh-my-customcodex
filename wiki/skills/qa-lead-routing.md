---
title: QA Lead Routing
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/qa-lead-routing/SKILL.md
related:
  - [[qa-planner]]
  - [[qa-writer]]
  - [[qa-engineer]]
---

# QA Lead Routing

Coordinates QA workflow across planner, writer, and engineer agents.

## Overview

Routes QA-related tasks to `qa-planner`, `qa-writer`, or `qa-engineer` according to planning, writing, and execution needs. Native Codex uses the installed role's `agent_type` and runtime permissions, while Claude compatibility `Agent` calls conditionally pass `mode: "bypassPermissions"` only from an active bypass session. Novel QA scenarios may fall back to dynamic agent creation.

## Key Details

- **Scope**: core
- **User-invocable**: no
- **Context**: fork
- **Permission boundary**: native `spawn_agent` never accepts Claude's `mode` field

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[secretary-routing]], [[dev-lead-routing]], [[de-lead-routing]]
- **See also**: [[R010]], [[R015]], [[qa-planner]], [[qa-writer]], [[qa-engineer]]

## Sources

- `.codex/skills/qa-lead-routing/SKILL.md` — skill definition
