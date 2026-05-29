---
title: Memory Workflow
type: workflow
updated: 2026-05-29
sources:
  - .codex/rules/SHOULD-memory-integration.md
  - AGENTS.md
related:
  - [[wiki/rules/r011]]
  - [[wiki/agents/sys-memory-keeper]]
  - [[ecomode-and-context]]
  - [[orchestration]]
---

# Memory Workflow

Memory in oh-my-customcodex operates on two levels: native auto-memory (`MEMORY.md` files per agent) for durable behavioral/project patterns, and an optional approved searchable MCP backend such as `omx-memory` for cross-session search. Session-end auto-save is triggered by user signals and coordinated between `sys-memory-keeper` and the orchestrator.

## Overview

The rule is simple: **use native auto-memory first; use approved searchable memory only when it is already configured and needed**. Native auto-memory is zero-dependency and always available. Deprecated Chroma plugin memory tooling is not used.

## Native Auto-Memory

Agents opt into persistent memory via the `memory` frontmatter field:

| Scope | Location | Git Tracked | Use Case |
|-------|----------|-------------|---------|
| `user` | `~/.codex/agent-memory/<name>/` | No | Personal preferences, user model |
| `project` | `.codex/agent-memory/<name>/` | Yes | Project patterns, team knowledge |
| `local` | `.codex/agent-memory-local/<name>/` | No | Local experiments, sensitive data |

When enabled, the system loads the first 200 lines of `MEMORY.md` into the agent's system prompt at session start. Read/Write/Edit tools are auto-enabled for the memory directory.

Best practices:
- Keep MEMORY.md under 200 lines (only first 200 loaded)
- Do not store sensitive data
- Do not duplicate AGENTS.md content
- Consult memory before starting work; update after discovering new patterns

## Approved Searchable Memory (Supplementary)

Use an approved backend when:
- searching across sessions
- answering temporal queries
- sharing cross-agent/project observations

Supported tool names are `memory_search`, `memory_read`, `memory_add`, and `observation_add`. If none are available, skip searchable persistence and continue.

## Session-End Auto-Save Workflow

Triggered by user signals: "끝", "종료", "마무리", "done", "wrap up", "end session".

### Responsibility Split

```
User signals session end
  → Orchestrator delegates to sys-memory-keeper
      sys-memory-keeper:
        1. Collect session summary (tasks, decisions, open items)
        2. Extract behavioral patterns with confidence levels
        3. Update MEMORY.md (native auto-memory)
        4. Aggregate agent performance metrics
        5. Return formatted summary to orchestrator

  → Orchestrator directly:
        1. approved searchable memory save if backend tools are available
        2. episodic indexing, if configured, remains automatic

  → Orchestrator confirms to user
```

## Session-End Self-Check

1. Did `sys-memory-keeper` update native MEMORY.md when needed?
2. Did the orchestrator attempt approved searchable memory save only if backend tools were available?
3. Were memory failures reported as non-blocking?

Memory saves are **non-blocking**. A searchable backend failure must not prevent session end.
