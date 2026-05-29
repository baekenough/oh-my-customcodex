# External Memory Migration — Retired Measurement Plan

> **Status**: Retired by #1426. The project no longer measures or operates the deprecated Chroma-based memory plugin.
> **Current policy**: Native auto-memory is primary; `omx-memory` or an AgentMemory-compatible MCP may be used only as an approved searchable supplement.

## Decision

The previous measurement-first migration plan is obsolete. The project no longer needs usage baselining for the deprecated plugin because that backend is no longer an accepted dependency.

## Replacement Workflow

1. Keep durable agent facts in native `MEMORY.md` files.
2. Use `memory_search`, `memory_read`, `memory_add`, or `observation_add` only when an approved searchable backend is configured.
3. Skip searchable persistence when no approved backend is available; do not install or invoke deprecated Chroma memory tooling.
4. Record memory-backend decisions in R011 and the session summary.

## Verification

- Repository search should not find active instructions for removed memory-plugin names or plugin-specific tool calls.
- Memory skills must mention native memory and approved searchable MCP tools, not legacy plugin-specific commands.
