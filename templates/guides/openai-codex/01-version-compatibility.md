# OpenAI Codex Version Compatibility

This guide records OpenAI Codex release-note impact decisions for oh-my-customcodex. Use it for Codex/OMX runtime compatibility notes; keep Claude-only release notes in `guides/claude-code/15-version-compatibility.md`.

## rust-v0.139.0 / CLI 0.139.0

Source: upstream OpenAI Codex release `rust-v0.139.0`, Codex-port issue #1498.

| Change | Impact on oh-my-customcodex | Action |
| --- | --- | --- |
| Code mode can call standalone web search directly, including nested JavaScript tool calls, and receive plaintext results | Improves Codex runtime research ergonomics but does not change packaged skill/tool routing. | Keep repository research guidance source-backed; no package dependency change. |
| Tool and connector schemas preserve `oneOf`/`allOf`; large schemas keep more shallow structure during compaction | Reduces MCP/app connector schema loss for richer tools. | No template migration; continue to prefer connector schemas as runtime ground truth. |
| `codex doctor` includes editor and pager environment details while redacting raw values in JSON output | Aligns with metadata-only diagnostics and secret-redaction rules. | Document compatibility; keep `omcustomcodex doctor` separate. |
| Plugin marketplace automation exposes marketplace source in `list --json` and returns cached catalogs before background refresh | Useful for future plugin inventory automation. | Prefer JSON when automating plugin inventory; no current CLI behavior change. |
| `codex resume --last "..."` and `codex fork --last "..."` treat trailing text as the initial prompt | Reduces operator surprise for resume/fork workflows. | No package change. |
| MCP startup warnings are scoped to the owning thread, image edits use exact referenced paths, URLs with `~` linkify correctly, thread resets preserve cloud requirements, and sandbox execution preserves approved escalation/proxy-only networking more consistently | Runtime stability and evidence quality improvements. | No package change beyond this compatibility record. |

## rust-v0.138.0 / CLI 0.138.0

Source: upstream OpenAI Codex release `rust-v0.138.0`, Codex-port issue #1481.

| Change | Impact on oh-my-customcodex | Action |
| --- | --- | --- |
| `/app` can hand off the current CLI thread into Codex Desktop on macOS and native Windows | Useful operator workflow, but not a packaged template contract. | No runtime change. Mention only when documenting Desktop handoff troubleshooting. |
| Local image attachments and generated images expose saved file paths to the model | Helps visual iteration and image-edit follow-up references. | Keep visual workflows file-path aware; do not store generated image paths as durable release evidence unless explicitly requested. |
| Reasoning effort shortcuts and model-advertised effort ordering improved | Aligns with OMX guidance to prefer `reasoning_effort` over hardcoded model overrides for child agents. | Preserve repo model-routing guidance; avoid stale frontier model names. |
| App-server integrations can read account token usage and auth supports v2 personal access tokens | Useful observability/auth signal for app-server deployments, not required by this package. | Track as external runtime capability; no dependency or config change. |
| Plugin commands gained richer `--json` output and marketplace/source metadata | Can improve future automation around plugin inventory. | Prefer JSON output when automating plugin add/remove/list/detail; keep `omcustomcodex list` as package inventory source. |
| Workspace instruction loading is more accurate for remote and symlinked workspaces | Reduces false AGENTS.md discovery issues in Codex itself. | Keep nested AGENTS.md guidance intact and continue verifying repo-local instructions directly. |
| Startup, MCP credential refresh, large stream processing, and TUI/goal fixes are additive stability improvements | Lower operational friction for Codex sessions. | No package change beyond this compatibility record. |

## Compatibility rule

OpenAI Codex release-monitor issues should be closed as no-op only when there is no repo-owned surface to update. If a release changes workflow vocabulary, diagnostics, plugin automation, AGENTS.md loading, or visual iteration evidence, record the decision here and mirror it into templates.
