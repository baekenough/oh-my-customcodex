---
title: "OpenAI Codex Compatibility Guide"
type: guide
updated: 2026-06-09
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

`rust-v0.138.0` is tracked for #1481. The package records impact for Desktop handoff, local image path hints, reasoning effort ordering, app-server token usage, plugin JSON output, and AGENTS.md loading behavior. No dependency or runtime migration is required.

## Relationships

- **Related guides**: [[claude-code]], [[agent-harness-anatomy]]
- **Related rules**: [[r006]], [[r010]]

## Sources

- `guides/openai-codex/01-version-compatibility.md` - Codex release compatibility decisions
