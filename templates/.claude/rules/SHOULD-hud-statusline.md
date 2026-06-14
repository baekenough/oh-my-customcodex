# [SHOULD] HUD Statusline Rules

> **Priority**: SHOULD | **ID**: R012

## Two-System Architecture

| Aspect | HUD Events | Statusline API |
|--------|-----------|----------------|
| Channel | stderr (hooks) | stdout (dedicated statusline) |
| Location | Inline in conversation log | Persistent bar at screen bottom |
| Trigger | PreToolUse (Agent/Task matcher) | Message update cycle (~300ms) |
| Role | Event notifications | Persistent session status |

## HUD Events (Hook-based)

Format: `─── [Spawn] {subagent_type}:{model} | {description} ───` — implemented in `.codex/hooks/hooks.json` (PreToolUse → Agent/Task matcher). Display for multi-step/parallel/long-running ops only.

> **Claude Code v2.1.141+ compatibility**: Hook JSON output can include `terminalSequence` to emit desktop notifications, window title changes, or terminal bells without a controlling terminal. Treat this as an optional companion to stderr HUD events and the command statusline; do not add terminal-control hook behavior until there is a concrete Codex-compatible UX need.

> **v2.1.174+ Claude compatibility**: The `/usage` account dialog shows usage attribution for cache misses, long context, subagents, and per-skill/agent/plugin/MCP breakdowns over the last 24 hours or 7 days in VS Code. This complements `monitoring-setup`; it is an interactive Claude-client view, not a Codex/OMX telemetry source.

> **v2.1.176+ Claude compatibility**: `footerLinksRegexes` can render regex-matched link badges in the footer row, and session titles are generated in the conversation language when configured. Treat these as Claude-template statusline composition options; keep `.codex/statusline.sh` as the Codex/OMX primary status surface.

> **v2.1.172+ Claude compatibility**: The `claude_code.lines_of_code.count` OTEL metric includes a `model` attribute, so lines-of-code telemetry can be sliced by model when monitoring is enabled. This extends the per-dimension slicing configured through the `monitoring-setup` skill.

<!-- DETAIL: HUD Events full spec
### When to Display: Multi-step tasks, parallel execution, long-running operations. Skip for single brief operations.
### Parallel Display:
─── [Agent] secretary | [Parallel] 4 ───
  [1] Agent(mgr-creator):sonnet → Create agent
  [2] Agent(lang-golang-expert):haiku → Code review
-->

## Statusline API (Command-based)

Format: `{Cost} | {project} | {branch} | RL:{rate_limit}% {countdown} | WL:{weekly_limit}% {countdown} | CTX:{usage}%`

Config in `.codex/settings.local.json`: `statusLine.type: "command"`, `statusLine.command: ".codex/statusline.sh"`. Requires CC v2.1.80+ for RL/WL segments. `refreshInterval` setting (v2.1.97+): Auto-refresh interval in seconds for the status line command. Set in `statusLine.refreshInterval` in settings.json.

<!-- DETAIL: Statusline configuration JSON and color coding
```json
{ "statusLine": { "type": "command", "command": ".codex/statusline.sh", "padding": 0 } }
```
Color coding: Cost (<$1 green, $1-4.99 yellow, >=5 red), RL/WL (<50% green, 50-79% yellow, >=80% red), CTX (<60% green, 60-79% yellow, >=80% red).
Countdown format: >=1d → "{d}d{h}h", >=1h → "{h}h{m}m", <1h → "{m}m", unavailable → omitted.
RL/WL segments omitted on CC older than v2.1.80.
-->

## Integration

Integrates with R007 (Agent ID), R008 (Tool ID), R009 (Parallel).

## External Plugin Statusline Conflict

| Plugin | Component | Resolution |
|--------|-----------|------------|
| cc-token-saver | Live Status Line | R012 `.codex/statusline.sh` has priority. Disable cc-token-saver statusline to avoid duplicate status bars. |

Internal statusline (`.codex/statusline.sh`) is the primary status display. External plugin status lines are supplementary or disabled.
