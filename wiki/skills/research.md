---
title: Research
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/research/SKILL.md
related:
  - [[deep-plan]]
  - [[roundtable-debate]]
  - [[result-aggregation]]
  - [[R018]]
---

# Research

10-team parallel deep analysis with cross-validation for complex research tasks.

## Overview

Coordinates 10 parallel research perspectives and a synthesis pass for complex topics. Native Codex agents are selected through installed `agent_type` roles under active runtime permissions; the native call has no `mode` field. Only Claude compatibility `Agent` calls conditionally pass `mode: "bypassPermissions"` when the Claude session already uses bypass permissions.

## Key Details

- **Scope**: core
- **User-invocable**: yes
- **Command**: `$research` (Codex/OMX); `/research` (Claude Code compatibility)
- **Effort**: not specified
- **Context**: fork
- **Permission boundary**: provider-specific per R010 Delegated Permission Ownership

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[deep-plan]], [[roundtable-debate]], [[result-aggregation]], [[task-decomposition]]
- **See also**: [[R018]], [[R009]]

## Sources

- `.codex/skills/research/SKILL.md` — skill definition
