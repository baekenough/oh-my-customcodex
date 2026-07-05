---
title: "OpenAI Codex Compatibility Guide"
type: guide
updated: 2026-07-05
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

`oh-my-codex v0.19.0` is tracked for #1565 and raises the packaged `MINIMUM_OMX_VERSION` baseline to `0.19.0`, covering upstream planning-gate/handoff transport hardening, conductor contract, typed subagent provenance/lane fences, Ralplan consensus and terminal-state handling, Madmax fixes, Ultragoal HUD, and Rust flake fixes through the runtime dependency instead of copying upstream runtime internals into this child package. The release note indicates no intended breaking CLI/package/plugin-layout/config changes, so no package source migration is required beyond the baseline bump.

`oh-my-codex v0.18.17` was tracked for #1556 and raised the prior packaged `MINIMUM_OMX_VERSION` baseline to `0.18.17`, covering upstream workflow-safety, Team/Windows, and auth reliability fixes.

`rust-v0.141.0` is tracked for #1526. The package records impact for encrypted remote-executor relay channels, cross-platform cwd/shell/path preservation, selected-plugin stdio MCP activation, app-server child-thread/import/rate-limit observability, realtime and TUI prompt improvements, hook trust and blocking `PostToolUse` fixes, plugin auth/dedup/order fixes, Windows sandbox reliability, exec relay/`wait_agent` interruption, SQLite WAL-reset protection, TLS P-521 support, and runtime performance cleanup.

No package dependency, source, or runtime migration is required. Treat these as Codex runtime capabilities and reliability fixes while keeping `omcustomcodex` workflows evidence-driven and metadata-only for credential/proxy diagnostics.

## Relationships

- **Related guides**: [[claude-code]], [[agent-harness-anatomy]]
- **Related rules**: [[r006]], [[r010]]

## Sources

- `guides/openai-codex/01-version-compatibility.md` - Codex release compatibility decisions
