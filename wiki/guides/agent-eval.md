---
title: Agent Eval
type: guide
updated: 2026-07-18
sources:
  - guides/agent-eval/README.md
related:
  - [[agent-eval-framework]]
  - [[harness-eval]]
  - [[monitoring-setup]]
---

# Agent Eval

Guide for correctness-first 4-metric evaluation of agent runs.

## Integration

Use [[agent-eval-framework]] for task-level scoring and [[harness-eval]] for repeatable benchmark suites. When release or pipeline trajectories need OTel visibility, invoke `$omcustomcodex:monitoring-setup` in Codex/OMX or `/omcustomcodex:monitoring-setup` in Claude Code; the stable eval fields remain the source of truth at the exporter boundary.

## Sources

- `guides/agent-eval/README.md` — evaluation contract and provider-specific monitoring integration
