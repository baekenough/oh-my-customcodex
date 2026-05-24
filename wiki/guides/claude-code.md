---
title: "Claude Code Guide"
type: guide
updated: 2026-05-24
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

### v2.1.150 (2026-05-23)

Source: upstream oh-my-customcode #1220, Codex port #1380.

- Internal infrastructure improvements only; no Codex package or Claude-template runtime change was required.
- The no-op review is recorded so release-monitor ports can close with explicit evidence.

### v2.1.149 (2026-05-22)

Source: upstream oh-my-customcode #1219, Codex port #1379.

- `/usage` now breaks limit usage down by skills, subagents, plugins, and MCP servers; Codex reports still come from OMX status, trace, and local CLI evidence.
- Git worktree sandbox allowlists now cover only shared `.git` state, reinforcing clean worktree boundaries for auto-dev sweeps.
- Bash `find` and no-change planning regressions were fixed upstream, but Codex sessions should still prefer bounded `rg`/targeted scans and explicit `git status` checks.
- Enterprise `allowAllClaudeAiMcps`, PowerShell permission fixes, diff scrolling, GFM checkboxes, and telemetry path diagnostics are documented as Claude compatibility surfaces.

### v2.1.148 (2026-05-22)

Source: upstream oh-my-customcode #1218, Codex port #1378.

- Claude Code fixed the v2.1.147 Bash regression that returned exit code 127 for every command for some users.
- Suspicious all-command `127` failures from Claude v2.1.147 should be treated as version/environment evidence before changing repository code.

### v2.1.147 (2026-05-21)

Source: upstream oh-my-customcode #1216 and #1222, Codex ports #1376 and #1381.

- `Workflow` is a Claude-native deterministic multi-agent tool gated by `CLAUDE_CODE_WORKFLOWS=1`; it does not replace OMX `$pipeline`.
- Pinned background sessions are more durable, but pinned Claude sessions are not evidence of active OMX work.
- `/simplify` was renamed to `/code-review`; this package keeps `dev-review` for best-practice review and `dev-refactor` for cleanup/refactor, with no dead `simplify` route.
- Auto-updater diagnostics, unknown slash-command errors, multi-`Agent(...)` plugin handling, sandbox hardening, and hook condition fixes are recorded as Claude-template compatibility notes.

### v2.1.146 (2026-05-21)

Source: upstream oh-my-customcode #1205, Codex port #1364.

- `/simplify` was renamed to `/code-review` and accepts effort levels such as `/code-review high`.
- The package still exposes `dev-review` as its own review skill; native `/code-review` is a Claude command, not a package skill rename.
- MCP pagination, model env forwarding, background permission preservation, and Agent SDK stream completion fixes are documented as compatibility-only changes.

### v2.1.145 (2026-05-19)

Source: upstream oh-my-customcode #1191, Codex port #1353.

- Statusline JSON now carries structured GitHub fields such as `gh.repo`, `gh.pr_number`, and `gh.pr_state`.
- The Codex port statusline now prefers those fields and falls back to cached `gh pr view` only when native fields are absent.
- Empty GitHub statusline fields are normalized so Bash TSV parsing remains stable.

### v2.1.144 (2026-05-18)

Source: upstream oh-my-customcode #1187, Codex port #1349.

- `claude agents --json` exposes structured background-agent state.
- Statusline JSON `agents` arrays render as `A:N` when active agents exist.
- Stop/SubagentStop hook input can include `background_tasks` and `session_crons`; `session-reflection.sh` records those fields.

### v2.1.143 (2026-05-17)

Source: upstream oh-my-customcode #1166, Codex port #1348.

- Hook/session lifecycle payloads became richer for background work.
- The compatibility template captures session-end evidence without blocking shutdown.
- Codex-native `.codex/**` and OMX behavior remains primary; the release is documented as a Claude compatibility surface.

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
