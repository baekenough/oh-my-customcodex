---
title: Deep Plan
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/deep-plan/SKILL.md
related:
  - [[research]]
  - [[structured-dev-cycle]]
  - [[deep-verify]]
---

# Deep Plan

Research-validated planning — research then plan then verify workflow for complex tasks.

## Overview

Three-phase planning workflow: (1) Research phase using multi-team parallel analysis, (2) Plan synthesis from research findings, (3) Plan verification via multiple perspectives. Produces a validated implementation plan before any code is written. Native Codex delegation selects installed `agent_type` roles under runtime permissions; the Claude compatibility surface conditionally forwards `mode: "bypassPermissions"` only from an active bypass session.

## Key Details

- **Scope**: core
- **User-invocable**: yes
- **Command**: `$deep-plan` (Codex/OMX); `/deep-plan` (Claude Code compatibility)
- **Effort**: not specified
- **Context**: fork
- **Permission boundary**: provider-specific per R010 Delegated Permission Ownership

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[research]], [[deep-verify]], [[structured-dev-cycle]], [[multi-model-verification]]
- **See also**: [[R018]], [[R009]]

## Sources

- `.codex/skills/deep-plan/SKILL.md` — skill definition
