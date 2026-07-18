---
title: Scout
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/scout/SKILL.md
related:
  - [[skills-sh-search]]
  - [[update-external]]
  - [[research]]
---

# Scout

Analyze external URL to evaluate project fit and integration potential.

## Overview

Fetches and analyzes an external URL to evaluate project fit, then returns a structured recommendation. Native Codex analysis or issue-creation delegation uses an installed `agent_type` and active runtime permissions with no `mode` parameter. A Claude compatibility `Agent` call passes `mode: "bypassPermissions"` only when that Claude session already uses bypass permissions.

## Key Details

- **Scope**: core
- **User-invocable**: yes
- **Command**: `$scout` (Codex/OMX); `/scout` (Claude Code compatibility)
- **Effort**: not specified
- **Permission boundary**: applies separately to analysis and any delegated issue-creation path

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[skills-sh-search]], [[update-external]], [[research]]
- **See also**: [[R002]]

## Sources

- `.codex/skills/scout/SKILL.md` — skill definition
