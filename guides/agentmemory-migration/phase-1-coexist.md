# External Memory Migration — Retired COEXIST Plan

> **Status**: Retired by #1426. COEXIST mode is no longer supported for this project.
> **Current policy**: Native auto-memory first; optional `omx-memory`/AgentMemory-compatible searchable backend only when already configured.

## Why This Plan Is Retired

The old coexistence plan introduced dual-backend complexity and session-end save ambiguity. The current project decision removes that complexity: deprecated Chroma-based memory tooling is not installed, invoked, measured, or treated as a fallback.

## Active Policy

| Need | Supported path |
| --- | --- |
| Agent-local durable facts | Native `MEMORY.md` via agent frontmatter `memory:` |
| Cross-session search | `omx-memory` or AgentMemory-compatible MCP exposing `memory_search`/`memory_read` |
| Session summary save | `memory_add` or `observation_add` when an approved backend is configured |
| No approved backend | Skip searchable save and continue; memory failures do not block the main task |

## Session-End Checklist

1. `sys-memory-keeper` updates native memory when a session-end signal exists.
2. Orchestrator attempts approved searchable memory save only if the tool is available.
3. Deprecated plugin-specific wrappers and Chroma tool calls remain unused.

## Follow-up

Keep this guide as a short historical pointer until downstream documentation no longer links to the old AgentMemory migration path.
