---
title: "Claude Code Guide"
type: guide
updated: 2026-07-14
sources:
  - guides/claude-code/01-overview.md
  - guides/claude-code/15-version-compatibility.md
  - guides/claude-code/16-fable5-prompting.md
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

## v2.1.178 compatibility updates

The Claude compatibility guide now records v2.1.178 impacts from upstream oh-my-customcode v1.0.9 / Codex-port #1524 while keeping Codex/OMX as the active runtime boundary: per-parameter `Tool(param:value)` permission denies, compaction `fallbackModel` use, nested `.claude/skills` loading with `<dir>:<name>` disambiguation, MCP `disallowedTools` honoring, nearest `.claude/` collision precedence, auto-mode subagent pre-launch classification, and background-agent custom-gateway auth fixes.


## v2.1.198-v2.1.199 and Fable 5 updates

Reviewed for #1561, #1562, #1564, and the v1.0.15 native-status boundary. The Claude compatibility guide records Explore model/extended-thinking inheritance, hook stderr visibility, stacked slash-skill loading depth, subagent partial-work/error reporting, Agent Teams retry/reporting fixes, background-agent auto-commit/PR lifecycle reliability, and `Notification` events for `agent_needs_input` / `agent_completed`. These are Claude-template compatibility notes; Codex uses OMX HUD and the native TUI footer for active status.

The new `guides/claude-code/16-fable5-prompting.md` page records Fable 5 prompting guidance: high effort by default, `xhigh` only for capability-sensitive work, concise prompts to avoid over-prescription, long-lived bounded lanes as an option, R020 ground-truth completion, R010 boundary clarity, and Mythos 5 as limited availability / not GA.

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

### v2.1.178 (2026-06-15)

Source: upstream oh-my-customcode v1.0.9 / #1391, Codex port #1524.

- `Tool(param:value)` permission deny syntax, including `Agent(model:opus)`, is Claude settings compatibility vocabulary; Codex/OMX sandboxing remains the active package boundary.
- Compaction now consults `fallbackModel` on overload or model-availability errors, reducing Claude compatibility session failures without changing Codex model routing.
- Nested `.claude/skills` directories load with `<dir>:<name>` disambiguation, nested `.claude/` collisions use closest-wins precedence, and MCP `mcp__*` entries in subagent `disallowedTools` are honored.
- Auto mode classifies subagent spawns before launch; prompt-level pre-delegation scope boundaries remain required as defense-in-depth.
- `claude agents` and `/bg` custom-gateway fixes reduce Claude background-agent false blockers; no package source/runtime change is required.

### v2.1.169 (2026-06-08)

Source: upstream oh-my-customcode #1329, Codex port #1496.

- `--safe-mode` / `CLAUDE_CODE_SAFE_MODE` disables Claude customizations for compatibility regression isolation.
- `disableBundledSkills` / `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` hides bundled skills/workflows/slash commands from the model; this is distinct from advisory `skills:` frontmatter metadata.
- `claude agents --json --all` exposes `id` and `state` for blocked/running/completed session checks.
- `/cd` and MCP/history reliability fixes are Claude operator improvements; no Codex runtime change is required.

### v2.1.156 (2026-05-29)

Source: upstream oh-my-customcode #1245, Codex port #1420.

- Fixed Opus 4.8 thinking-block API errors; prefer v2.1.156 over v2.1.154 for Claude Opus 4.8 compatibility testing.
- No Codex runtime change is required; `.codex/**` and OMX model routing remain primary.
- v2.1.155 had no public release.

### v2.1.154 (2026-05-28)

Source: upstream oh-my-customcode #1244, Codex port #1419.

- Opus 4.8 and the `opus48` alias are Claude-template compatibility vocabulary, not Codex model-routing changes.
- Dynamic Workflows reached GA; keep OMX `$pipeline`, `$team`, and Codex subagents as the primary orchestration surfaces.
- Lean system prompt defaults changed and `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE` was deprecated for new guidance.
- v2.1.155 had no public release.

### v2.1.153 (2026-05-28)

Source: upstream oh-my-customcode #1243, Codex port #1418.

- Statusline scripts can use `COLUMNS` and `LINES` when Claude provides terminal dimensions, while preserving fallbacks.
- Marketplace plugin source config supports `skipLfs`; document it as Claude marketplace compatibility only.
- `claude agents` autocomplete improved without changing packaged agent definitions.

### v2.1.152 (2026-05-27)

Source: upstream oh-my-customcode #1242, Codex port #1417.

- Skill frontmatter supports `disallowed-tools`; Codex rule surfaces still enforce `.codex/**` policy.
- `/reload-skills` and `SessionStart reloadSkills` reload Claude skill state without changing Codex runtime behavior.
- v2.1.151 had no public release.

### Known Platform Issues: Agent tool malformed parsing

Source: upstream oh-my-customcode #1241, Codex port #1416.

- Long or special-character-heavy Claude `Agent` delegation prompts can intermittently report `malformed` because of platform serialization.
- This is not an oh-my-customcodex defect and does not affect Codex-native subagent dispatch.
- Workaround: keep delegation prompts shorter, move large evidence into files, avoid dense shell quoting/backticks/repeated colons in the prompt, and retry with a smaller prompt.

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
- The packaged Claude compatibility statusline prefers those fields and falls back to cached `gh pr view` only when native fields are absent.
- Empty GitHub fields are normalized so the compatibility script's Bash TSV parsing remains stable; Codex does not install this script under `.codex`.

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

### v2.1.200-v2.1.201 compatibility

The Claude compatibility guide now records upstream oh-my-customcode v1.1.7 / #1567: `default` permission mode appears as `Manual` while remaining behaviorally identical, `AskUserQuestion` no longer auto-continues by default, pre-output subagent rate-limit failures surface as clean failures, background daemon lifecycle handling is more robust, `.claude.json` MCP server array mistakes no longer crash startup, and Sonnet 5 harness reminders no longer arrive as mid-conversation `system` role messages. These are Claude-template compatibility notes only; Codex-native routing, sandboxing, and verification remain OMX/Codex governed.
