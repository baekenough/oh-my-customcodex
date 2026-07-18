---
title: Professor Triage
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/professor-triage/SKILL.md
related:
  - [[release-plan]]
  - [[deep-verify]]
  - [[post-release-followup]]
---

# Professor Triage

Analyze GitHub issues against current codebase to generate prioritized triage report.

## Overview

Reads selected GitHub issues, cross-analyzes them against the current codebase, and produces prioritized triage evidence. Its delegation table labels `bypassPermissions` as a Claude compatibility `Agent` mode only, conditional on the active Claude session. Native Codex dispatch has no `mode` parameter and uses installed `agent_type` roles plus runtime permissions.

## Key Details

- **Scope**: harness
- **User-invocable**: yes
- **Command**: `$professor-triage` (Codex/OMX); `/professor-triage` (Claude Code compatibility)
- **Effort**: not specified
- **Permission boundary**: delegation mode columns describe Claude compatibility, not native Codex calls

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[release-plan]], [[deep-verify]], [[post-release-followup]]
- **See also**: [[R020]]

## Sources

- `.codex/skills/professor-triage/SKILL.md` — skill definition
