---
title: "cc-token-saver Integration Guide"
type: guide
updated: 2026-07-14
sources:
  - guides/cc-token-saver/README.md
related:
  - [[R012]]
  - [[R013]]
  - [[R009]]
  - [[R010]]
  - [[R018]]
---

# cc-token-saver Integration Guide

External Claude Code plugin for token cost optimization and session continuity — documents its compatibility boundary with Codex/OMX status and delegation surfaces.

## Overview

[cc-token-saver](https://github.com/ww-w-ai/cc-token-saver) (Apache-2.0) is an external Claude Code plugin providing cache TTL monitoring, cost dashboards, and zero-cost context restore. Codex sessions use OMX HUD for harness state and the native `/statusline` footer for user-selected TUI items, while R009/R010/R018 govern delegation.

## Installation

```bash
claude plugin marketplace add ww-w-ai/cc-token-saver
claude plugin install cc-token-saver
```

## Key Features

| Feature | Description |
|---------|-------------|
| Token Guardian | Detects 1h prompt cache TTL idle expiry and warns before cache invalidates |
| Smart Session Architecture | Auto-injects SubTask delegation patterns into context |
| `/continue` | Zero-cost context restore after session pause |
| Live Status Line | Real-time token/cost status bar |
| `/usage-view` | Cost dashboard showing per-session and cumulative spend |
| `/report-limit` | Community-sourced rate limit reporting |

## Conflict Resolution

### Live Status Line (R012 Boundary)

Codex init and update do not install a command statusline under `.codex`.
In an explicit Claude compatibility session, choose either cc-token-saver's
footer or the packaged `templates/.claude/statusline.sh` compatibility asset;
do not enable both persistent footers. OMX HUD remains the separate
harness-workflow status surface.

### SubTask Delegation (R009/R010/R018 Priority)

cc-token-saver's Smart Session Architecture injects SubTask delegation patterns. Internal rules always override external skills (R010). When cc-token-saver suggests SubTask patterns, translate them to oh-my-customcodex routing skills plus Codex native subagents, with specialized agents per domain (R010) and parallel execution when independent (R009).

### Token Guardian and R013 (Coexistence)

Token Guardian (idle cache TTL) and `context-budget-advisor.sh` (R013, context % threshold) solve different problems and run simultaneously without conflict. Both warnings are useful.

## Conflict-Free Features

`/continue`, `/usage-view`, and `/report-limit` have no conflicts with internal rules — use freely.

## Sources

- `guides/cc-token-saver/README.md` — integration guide with conflict resolution details
