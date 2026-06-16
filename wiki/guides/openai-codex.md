---
title: "OpenAI Codex Compatibility Guide"
type: guide
updated: 2026-06-17
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

`rust-v0.140.0` is tracked for #1522. The package records impact for `/usage` token activity views, native `/goal` large-input preservation, permanent session deletion, Claude Code `/import`, unified `@` mentions, managed Bedrock/OAuth credential storage, SQLite recovery, MCP reliability, remote plugin uninstall fixes, stale hook cleanup, and interruptible non-TTY background commands.

No package dependency or runtime migration is required. `omcustomcodex:goal` remains namespaced beside native `/goal`, destructive `codex delete`/`/delete` actions stay explicitly user-authorized, and credential diagnostics remain metadata-only under R001.

## Relationships

- **Related guides**: [[claude-code]], [[agent-harness-anatomy]]
- **Related rules**: [[r006]], [[r010]]

## Sources

- `guides/openai-codex/01-version-compatibility.md` - Codex release compatibility decisions
