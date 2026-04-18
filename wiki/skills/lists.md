---
title: Lists
type: skill
updated: 2026-04-12
sources:
  - .codex/skills/lists/SKILL.md
related:
  - [[help]]
  - [[status]]
---

# Lists

Show all available commands and slash commands in the system.

## Overview

Displays a formatted table of all available slash commands with their descriptions and argument hints. Reads from agent and skill frontmatter to produce a current listing. Equivalent to `/omcodex:lists`. Useful for discovering available capabilities without reading individual skill files.

## Key Details

- **Scope**: harness
- **User-invocable**: yes
- **Command**: `/omcodex:lists`
- **Effort**: not specified

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[help]], [[status]]
- **See also**: CLAUDE.md command table

## Sources

- `.codex/skills/lists/SKILL.md` — skill definition
