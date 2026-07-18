---
title: Token Efficiency Audit
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/token-efficiency-audit/SKILL.md
related:
  - [[monitoring-setup]]
  - [[ecomode-and-context]]
  - [[cc-token-saver]]
---

# Token Efficiency Audit

Audit and tune Claude/Codex configuration for lower token usage without changing code.

## Overview

This skill separates settings-level optimization from runtime compression. It audits `.codex/settings*.json`, `~/.codex/config.toml`, and relevant shell rc files for token-cost levers such as output caps, app surface toggles, and search/tool output limits. It supports `audit`, `status`, `apply-interactive`, and `apply-ci` modes, and links telemetry visibility through `$omcustomcodex:monitoring-setup` in Codex/OMX or `/omcustomcodex:monitoring-setup` in Claude Code.

## Key Details

- **Scope**: package
- **User-invocable**: yes
- **Command**: `$token-efficiency-audit` (Codex/OMX); `/token-efficiency-audit` (Claude Code compatibility)
- **Effort**: not specified
- **Argument hint**: `[audit|apply-interactive|apply-ci|status]`

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[monitoring-setup]]
- **See also**: [[cc-token-saver]], `guides/claude-code/14-token-efficiency.md`

## Sources

- `.codex/skills/token-efficiency-audit/SKILL.md` — skill definition
