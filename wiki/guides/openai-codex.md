---
title: "OpenAI Codex Compatibility Guide"
type: guide
updated: 2026-06-21
sources:
  - guides/openai-codex/01-version-compatibility.md
related:
  - [[claude-code]]
  - [[agent-harness-anatomy]]
  - [[r006]]
  - [[r010]]
---

# OpenAI Codex Compatibility Guide

Reference documentation for OpenAI Codex release-note impact decisions in oh-my-customcodex.

## Overview

This guide tracks Codex/OMX runtime compatibility notes separately from Claude Code compatibility notes. It records which upstream OpenAI Codex release changes require package-owned updates, which are no-ops, and which should remain external runtime behavior.

## Key Topics

- OpenAI Codex release-monitor triage decisions
- Desktop handoff and visual-file evidence boundaries
- Reasoning effort and model-routing compatibility notes
- Plugin JSON automation opportunities
- AGENTS.md loading behavior and nested instruction expectations

## Current Release Note

`rust-v0.141.0` is tracked for #1526. The package records impact for encrypted remote-executor relay channels, cross-platform cwd/shell/path preservation, selected-plugin stdio MCP activation, app-server child-thread/import/rate-limit observability, realtime and TUI prompt improvements, hook trust and blocking `PostToolUse` fixes, plugin auth/dedup/order fixes, Windows sandbox reliability, exec relay/`wait_agent` interruption, SQLite WAL-reset protection, TLS P-521 support, and runtime performance cleanup.

No package dependency, source, or runtime migration is required. Treat these as Codex runtime capabilities and reliability fixes while keeping `omcustomcodex` workflows evidence-driven and metadata-only for credential/proxy diagnostics.

## Relationships

- **Related guides**: [[claude-code]], [[agent-harness-anatomy]]
- **Related rules**: [[r006]], [[r010]]

## Sources

- `guides/openai-codex/01-version-compatibility.md` - Codex release compatibility decisions
