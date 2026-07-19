# [SHOULD] Native HUD and Status Line Rules

> **Priority**: SHOULD | **ID**: R012

## Canonical Codex/OMX Surfaces

| Surface | Owner | Purpose |
|---------|-------|---------|
| OMX HUD | `omx hud` / `omx hud --tmux` | Live workflow, team, goal, and session state |
| Codex TUI status line | `/statusline` and `[tui].status_line` | User-selected persistent footer items |
| Harness hook events | Native Codex hook registry | Bounded event notifications for parallel or long-running work |

OMX HUD is the harness status surface. The Codex footer is a native user
preference configured interactively with `/statusline` or in Codex
`config.toml`; project init and update must not overwrite an existing
preference. Because a project-scoped OMX runtime mirrors the project's
`.codex/config.toml` into its isolated `CODEX_HOME`, init and update seed the
default native footer only when the project has no `[tui].status_line`
assignment. An existing custom assignment, including an explicitly empty
array, is preserved byte-for-byte.

Do not install `.codex/statusline.sh` or write Claude `statusLine` JSON into
`.codex/settings.local.json`. Those are not Codex configuration surfaces.

## HUD Events

Use compact hook notifications for multi-step, parallel, or long-running work.
Skip them for single brief operations. Runtime state shown by OMX remains the
source of truth; a hook notification must not invent completion or progress.

<!-- DETAIL: HUD event example
─── [Agent] secretary | [Parallel] 4 ───
  [1] Agent(mgr-creator):frontier/medium → Create agent
  [2] Agent(lang-golang-expert):spark/low → Code review
-->

## Native Footer Configuration

Use `/statusline` in an interactive Codex session to select footer items. The
equivalent configuration lives under `[tui].status_line` in Codex
`config.toml`. The absence-only project default is `model-with-reasoning`,
`git-branch`, `context-remaining`, `total-input-tokens`,
`total-output-tokens`, `five-hour-limit`, and `weekly-limit`. This seed makes
the native footer available after OMX isolates and mirrors project
configuration; it is not a harness-owned replacement for a user preference.
Keep user formatting and every existing native assignment byte-for-byte
preserved. If `.codex/config.toml` cannot be read or rewritten safely because
of a symlink, hardlink, or identity race, fail closed rather than following the
unsafe path, rerunning setup from a stale ready assessment, or silently claiming
readiness. A required change is written only through the verified config file
descriptor, followed by file sync and exact readback, so a path swap cannot
redirect the write to a replacement inode. Synchronous write failures attempt
an exact original-content rollback and surface uncertain recovery explicitly.
This descriptor-bound rewrite preserves the existing inode metadata but does
not claim crash atomicity across process termination or power loss.

## Claude Compatibility Boundary

`templates/.claude/statusline.sh` is retained only as a Claude Code
compatibility asset. It consumes the Claude JSON-stdin statusline protocol and
may be bound only by an explicit Claude compatibility setup. Codex init and
update never copy or configure it under `.codex`.

Claude-only footer links, usage views, notification events, and
`refreshInterval` behavior remain compatibility concerns. Do not describe them
as Codex/OMX runtime state.

<!-- DETAIL: Claude Code v2.1.202-v2.1.208 Status Compatibility
Claude Code v2.1.202 attaches `workflow.run_id` and `workflow.name` to telemetry for workflow-spawned agents. Claude Code v2.1.208 keeps completed background agents visible in `/tasks` and fixes temporary 200k context display plus `/release-notes` context pollution. These are Claude provider surfaces, not OMX HUD or Codex statusline state.
-->

## Integration

Integrates with R007 (Agent ID), R008 (Tool ID), and R009 (Parallel).

## External Status Surface Conflicts

Use one persistent footer owner. If another plugin installs a footer, keep the
Codex native status line or the explicitly selected compatibility footer, not
both. OMX HUD may remain available as the separate workflow-state surface.
