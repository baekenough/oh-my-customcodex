---
title: Memory Recall
type: skill
updated: 2026-05-29
sources:
  - .codex/skills/memory-recall/SKILL.md
related:
  - [[memory-save]]
  - [[memory-management]]
  - [[sys-memory-keeper]]
  - [[R011]]
---

# Memory Recall

Search and recall memories from native memory plus approved searchable MCP backends.

## Overview

Searches native `MEMORY.md` and configured `memory_search`/`memory_read` tools for relevant memories using semantic queries. Default bias favors recall over precision — cast a wide net, filter later. Supports `--recent`, `--limit`, `--date`, and `--verbose`. Always prefixes queries with the project name for proper scoping.

## Key Details

- **Scope**: core
- **User-invocable**: yes
- **Command**: `/memory-recall`
- **Effort**: not specified
- **Argument hint**: `<query> [--recent] [--limit <n>]`

## Relationships

- **Used by agents**: [[sys-memory-keeper]]
- **Related skills**: [[memory-save]], [[memory-management]]
- **See also**: [[R011]]

## Sources

- `.codex/skills/memory-recall/SKILL.md` — skill definition
