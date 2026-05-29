---
title: Memory Management
type: skill
updated: 2026-05-29
sources:
  - .codex/skills/memory-management/SKILL.md
related:
  - [[memory-save]]
  - [[memory-recall]]
  - [[sys-memory-keeper]]
  - [[R011]]
---

# Memory Management

Memory persistence operations using native memory plus approved searchable MCP backends.

## Overview

Provides save, recall, and get operations for native `MEMORY.md` and optional `omx-memory`/AgentMemory-compatible backends. Save collects session data and stores it through `memory_add` or `observation_add` when available. Recall performs semantic search through `memory_search`/`memory_read` and always scopes queries by project. Deprecated Chroma plugin tooling is not used.

## Key Details

- **Scope**: core
- **User-invocable**: no
- **Effort**: not specified

## Relationships

- **Used by agents**: [[sys-memory-keeper]]
- **Related skills**: [[memory-save]], [[memory-recall]]
- **See also**: [[R011]]

## Sources

- `.codex/skills/memory-management/SKILL.md` — skill definition
