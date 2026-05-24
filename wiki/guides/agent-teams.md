---
title: "Agent Teams Guide"
type: guide
updated: 2026-05-24
sources:
  - guides/agent-teams/troubleshooting.md
related:
  - [[r018]]
  - [[orchestration]]
---

# Agent Teams Guide

Reference documentation for Agent Teams shutdown, cleanup, and tmux fallback recovery in Codex/OMX sessions.

## Overview

Agent Teams sessions can fail to exit cleanly when a member is still active, a tmux pane remains attached, or stale OMX runtime state keeps reporting an active team. This guide defines the graceful shutdown path first, then the narrow fallback path for stale local cleanup.

## Key Topics

- Typical Agent Teams shutdown failure signs
- Recovery order for `SendMessage`, `TeamDelete`, and stale-session cleanup
- Rules for tmux fallback when the pane or session is owned by the current task
- Codex/OMX mapping for legacy Claude Code background-session shutdown patterns
- Escalation cases where cleanup could interrupt active user work

## Relationships

- **Related rules**: [[r018]], [[r010]]
- **See also**: [[orchestration]], [[worktree-lifecycle]]

## Sources

- `guides/agent-teams/troubleshooting.md` - shutdown and tmux fallback troubleshooting guidance
