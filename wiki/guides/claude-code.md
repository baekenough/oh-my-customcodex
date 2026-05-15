---
title: "Claude Code Guide"
type: guide
updated: 2026-05-15
sources:
  - guides/claude-code/01-overview.md
  - guides/claude-code/15-version-compatibility.md
related:
  - [[mgr-claude-code-bible]]
  - [[r010]]
  - [[r012]]
  - [[r013]]
---

# Claude Code Guide

Reference documentation for Claude Code capabilities, features, and API integration patterns.

## Overview

Covers Claude's advanced API features for building Claude Code-compatible applications and agents. Topics include the 1M token context window, Agent Skills, batch processing, citations, extended thinking, Files API, structured outputs, and tool use. Also documents built-in tools (Bash, code execution, computer use, MCP connector, web fetch/search). Used by `mgr-claude-code-bible` for spec compliance verification.

## Key Topics

- Core features: context window, batch processing, prompt caching, structured outputs
- Tool integrations: Bash, code execution, computer use, text editor, web fetch/search
- Agent Skills and custom skill creation
- MCP connector and remote server integration
- Extended thinking for complex reasoning tasks
- Citations and search results for RAG applications
- Token counting and effort control

## Version Compatibility

oh-my-customcodex keeps Claude compatibility guidance for installed templates while `.codex/**` and OMX remain the primary runtime surface.

### v2.1.142 (2026-05-14)

Source: upstream oh-my-customcode #1158, Codex port #1329.

- `claude agents` gained CLI flags for background-session configuration: `--add-dir`, `--settings`, `--mcp-config`, `--plugin-dir`, `--permission-mode`, `--model`, `--effort`, and `--dangerously-skip-permissions`.
- Fast Mode now defaults to Opus 4.7. Compatibility sessions can pin old behavior with `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE=1`.
- Root-level plugin `SKILL.md` files are surfaced as skills. The packaged template keeps the existing `.claude/skills/<name>/SKILL.md` layout.
- `MCP_TOOL_TIMEOUT` now raises remote HTTP/SSE MCP request timeout as intended.
- Background sessions can edit existing git worktrees and survive macOS sleep/wake more reliably.
- `--dangerously-skip-permissions` persists across retire/wake cycles, reducing unattended permission-mode drops in Claude compatibility sessions.

### Known Limitation: Parent `.gitignore` Nested Plan Pattern

Source: upstream oh-my-customcode #1147, Codex port #1326.

The parent package documented that this pattern tracks only direct-child Markdown files:

```gitignore
docs/superpowers/plans/*
!docs/superpowers/plans/*.md
```

The Codex port does not currently ignore `docs/superpowers/plans/`, so nested plan documents remain trackable here. If a future ignore rule reintroduces the parent pattern, add explicit subdirectory re-includes first.

## Relationships

- **Used by agents**: [[mgr-claude-code-bible]]
- **Related skills**: [[claude-native]]
- **See also**: [[skill-bundle-design]], [[hook-data-flow]], [[r010]], [[r012]]

## Sources

- `guides/claude-code/01-overview.md` — feature overview, tool catalog, API capabilities
- `guides/claude-code/15-version-compatibility.md` — per-version compatibility notes
