---
title: Homework
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/homework/SKILL.md
related:
  - [[omcodex-feedback]]
  - [[memory-save]]
  - [[pipeline]]
---

# Homework

Session retrospective workflow for capturing reusable improvement opportunities after explicit opt-in.

## Overview

Analyzes the current session transcript and outcomes to identify one concrete, evidence-backed improvement for `oh-my-customcodex`. The skill does not currently spawn subagents. If a future Claude compatibility path delegates analysis, it conditionally passes `mode: "bypassPermissions"` only from an active bypass session; native Codex delegation would instead use installed `agent_type` roles and runtime permissions. Submission through `$omcustomcodex:feedback` in Codex/OMX (`/omcustomcodex:feedback` in Claude Code) still requires confirmation.

## Key Details

- **Scope**: harness
- **User-invocable**: yes
- **Command**: `$homework` (Codex/OMX); `/homework` (Claude Code compatibility)
- **Effort**: medium
- **Context**: current session
- **Permission boundary**: future delegation remains provider-specific; the current skill has no direct subagent call

## Relationships

- **Related skills**: [[omcodex-feedback]], [[memory-save]], [[pipeline]]
- **See also**: [[R007]], [[R008]]

## Sources

- `.codex/skills/homework/SKILL.md` — skill definition

---
