---
title: Secretary Routing
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/secretary-routing/SKILL.md
related:
  - [[mgr-creator]]
  - [[mgr-updater]]
  - [[mgr-supplier]]
  - [[mgr-gitnerd]]
  - [[mgr-sauron]]
  - [[sys-memory-keeper]]
---

# Secretary Routing

Routes agent management tasks to the correct manager agent.

## Overview

Routes management tasks to the appropriate manager, including creation, update, audit, git, verification, spec, memory, and task-tracking roles. Native Codex dispatch uses an installed `agent_type` and active runtime permissions without Claude's `mode` field. Claude compatibility `Agent` calls conditionally pass `mode: "bypassPermissions"` only when the active Claude session uses bypass permissions.

## Key Details

- **Scope**: core
- **User-invocable**: no
- **Context**: fork
- **Permission boundary**: provider-specific per R010 Delegated Permission Ownership

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[dev-lead-routing]], [[de-lead-routing]], [[qa-lead-routing]], [[intent-detection]]
- **See also**: [[R010]], [[R015]], [[R018]], [[R019]]

## Sources

- `.codex/skills/secretary-routing/SKILL.md` — skill definition
