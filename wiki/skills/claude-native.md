---
title: Claude Native
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/claude-native/SKILL.md
related:
  - [[mgr-claude-code-bible]]
  - [[update-external]]
---

# Claude Native

Monitor Claude Code releases and automatically create issues for relevant changes.

## Overview

Monitors Claude Code GitHub releases, compares against current installed version, and automatically creates GitHub issues for breaking changes, new features, and deprecated APIs that affect oh-my-customcodex agents or rules. Codex/OMX invokes the plain skill with `$claude-native`; Claude Code uses `/claude-native`. Scheduled `/schedule` and CronCreate examples belong only to the Claude Code compatibility surface.

## Key Details

- **Scope**: harness
- **User-invocable**: yes
- **Command**: `$claude-native` (Codex/OMX); `/claude-native` (Claude Code compatibility)
- **Effort**: not specified

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[update-external]], [[claude-code-bible]]
- **See also**: [[mgr-claude-code-bible]]

## Sources

- `.codex/skills/claude-native/SKILL.md` — skill definition
