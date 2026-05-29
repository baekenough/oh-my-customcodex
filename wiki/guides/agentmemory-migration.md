---
title: External Memory Migration Retired
type: guide
updated: 2026-05-29
sources:
  - guides/agentmemory-migration/measure-step-zero.md
  - guides/agentmemory-migration/phase-1-coexist.md
related:
  - [[memory-workflow]]
  - [[R011]]
---

# External Memory Migration Retired

Reference documentation for the retired AgentMemory coexistence path. The active policy is native auto-memory first with optional `omx-memory`/AgentMemory-compatible searchable backends only when configured.

## Overview

The old measurement and coexistence rollout has been retired. Do not install, measure, or invoke deprecated Chroma plugin memory tooling. Keep durable facts in native `MEMORY.md`; use `memory_search`, `memory_read`, `memory_add`, and `observation_add` only from approved searchable memory backends.

## Use This Guide For

- understanding why the previous coexistence path is no longer active
- confirming session-end memory saves use native memory and approved searchable tools
- checking that rules, skills, and templates no longer document deprecated memory plugin fallback behavior
