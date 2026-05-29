---
title: Memory Save
type: skill
updated: 2026-05-29
sources:
  - .codex/skills/memory-save/SKILL.md
related:
  - [[memory-recall]]
  - [[memory-management]]
  - [[sys-memory-keeper]]
  - [[R011]]
---

# Memory Save

Save current session context to native memory plus an approved searchable backend when configured.

## Overview

Collects the current session's completed tasks, decisions, and open items, then stores them through native memory and optional `memory_add`/`observation_add` tools with project metadata and user-specified tags. Supports `--tags`, `--include-code`, `--summary`, and `--verbose` options. Model invocation is disabled — runs as a direct skill execution.

## Key Details

- **Scope**: core
- **User-invocable**: yes
- **Command**: `/memory-save`
- **Effort**: not specified
- **Argument hint**: `[--tags <tags>] [--include-code]`

## Relationships

- **Used by agents**: [[sys-memory-keeper]]
- **Related skills**: [[memory-recall]], [[memory-management]]
- **See also**: [[R011]]

## Sources

- `.codex/skills/memory-save/SKILL.md` — skill definition
