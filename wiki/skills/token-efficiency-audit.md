---
title: Token Efficiency Audit
type: skill
updated: 2026-04-19
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

This skill separates settings-level optimization from runtime compression. It audits `.codex/settings*.json`, `~/.codex/config.toml`, and relevant shell rc files for token-cost levers such as output caps, app surface toggles, and search/tool output limits. It supports `audit`, `status`, `apply-interactive`, and `apply-ci` modes so interactive ergonomics and CI efficiency can be managed independently.

## Key Details

- **Scope**: package
- **User-invocable**: yes
- **Command**: `/token-efficiency-audit`
- **Effort**: not specified
- **Argument hint**: `[audit|apply-interactive|apply-ci|status]`

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[monitoring-setup]]
- **See also**: [[cc-token-saver]], `guides/claude-code/14-token-efficiency.md`

## Sources

- `.codex/skills/token-efficiency-audit/SKILL.md` — skill definition
