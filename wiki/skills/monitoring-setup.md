---
title: Monitoring Setup
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/monitoring-setup/SKILL.md
related:
  - [[status]]
---

# Monitoring Setup

Enable/disable OpenTelemetry console monitoring for GPT Codex + OMX usage tracking.

## Overview

Configures `.codex/settings.local.json` to enable or disable OpenTelemetry console monitoring. When enabled, the Codex + OMX harness outputs usage metrics (cost, tokens, sessions, LOC, commits, PRs, active time) and events to the terminal via `CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_METRICS_EXPORTER`, and `OTEL_LOGS_EXPORTER` env vars. Supports `enable`, `disable`, and `status` subcommands with explicit Codex/OMX and Claude Code invocation forms.

## Key Details

- **Scope**: package
- **User-invocable**: yes
- **Command**: `$omcustomcodex:monitoring-setup` (Codex/OMX); `/omcustomcodex:monitoring-setup` (Claude Code compatibility)
- **Effort**: not specified
- **Argument hint**: `[enable|disable|status]`

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[status]]
- **See also**: `.codex/settings.local.json`

## Sources

- `.codex/skills/monitoring-setup/SKILL.md` — skill definition and provider-specific invocation contract
