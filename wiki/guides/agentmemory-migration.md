---
title: AgentMemory Migration Guide
type: guide
updated: 2026-05-29
sources:
  - guides/agentmemory-migration/measure-step-zero.md
  - guides/agentmemory-migration/phase-1-coexist.md
related:
  - [[memory-management]]
  - [[memory-recall]]
  - [[memory-save]]
---

# AgentMemory Migration Guide

Reference documentation for measuring claude-mem usage and running the first AgentMemory coexistence phase safely.

## Overview

This guide documents the staged migration path from claude-mem toward AgentMemory without destructive changes. It starts with a measurement step that validates actual skill usage, then defines a coexistence phase where both memory backends can operate while migration evidence is gathered.

## Key Topics

- measuring claude-mem skill usage before making migration decisions
- comparing usage frequency against disposal or replacement thresholds
- installing AgentMemory as an optional parallel backend
- keeping claude-mem data and skills intact during the COEXIST phase
- deferring adapter activation and destructive asset handling until evidence supports a later switch

## Relationships

- **Related skills**: [[memory-management]], [[memory-recall]], [[memory-save]]
- **See also**: [[memory-workflow]]

## Sources

- `guides/agentmemory-migration/measure-step-zero.md` — pre-migration measurement plan and interpretation thresholds
- `guides/agentmemory-migration/phase-1-coexist.md` — week 1-2 coexistence policy and AgentMemory setup notes
