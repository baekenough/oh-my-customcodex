# Claude Code Version Compatibility

This guide records Claude Code release-note impact that affects the Claude compatibility template. The Codex-native runtime still uses `.codex/**` and OMX as the primary surface.

## v2.1.140

Published: 2026-05-12.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Agent `subagent_type` matching accepts case and separator variants | No runtime change. This repo still documents strict kebab-case agent names so Codex and Claude template references stay deterministic. | Keep examples such as `code-reviewer` and `lang-typescript-expert` in canonical form. |
| Native `/goal` no longer silently hangs under managed-hook restrictions | Compatible with the v0.4.16 namespace split. | Keep the native `/goal` reserved and call the packaged workflow as `/omcustomcodex:goal`. |
| Settings hot reload handles symlinked settings files more reliably | Reduces false `ConfigChange` noise for Claude template users. | No template change required. |
| `claude --bg` and background service startup were hardened | Improves long-running Claude compatibility sessions. | No Codex-side change required. |
| Remote managed settings retry once after a 401 | Reduces transient managed-settings failures. | No template change required. |
| Managed `extraKnownMarketplaces` persistence was fixed | Relevant only when Claude plugin marketplaces are managed externally. | Audit managed settings if plugin marketplace state appears stale. |
| `/loop` avoids redundant polling wakeups | Aligns with the repo's loop guidance to avoid unnecessary background wakeups. | No template change required. |
| Windows missing-executable checks avoid repeated synchronous `where.exe` spawns | Helps Windows users when tools such as `gh` are missing. | Keep hook scripts graceful when optional tools are absent. |
| `Read` offset validation accepts whitespace-padded or plus-prefixed strings | No template change. The repo examples already use numeric offsets plainly. | Keep generated examples simple. |
| Plugin component-folder conflicts now warn in `/doctor`, `claude plugin list`, and `/plugin` | Useful for template compatibility checks. | Run `claude plugin details <name>` and `/doctor` after plugin manifest changes. |

## v2.1.139

Published: 2026-05-11.

| Change | Port decision |
|--------|---------------|
| Hook `args: string[]` exec form | Reviewed. The current hook registry intentionally keeps shell `command` form because most hooks use `jq`, environment expansion, pipes, or inline shell snippets. Use `args` only for new hooks that are a single binary plus static arguments. |
| PostToolUse `continueOnBlock` | Ported for high-signal advisory hooks. `context-budget-advisor.sh`, `stuck-detector.sh`, and `cost-cap-advisor.sh` set `continueOnBlock: true`; scripts use `exit 2` only when model-visible recovery guidance is needed. |
| Native `/goal` | The packaged workflow uses `/omcustomcodex:goal`; native `/goal` stays available for Claude Code completion tracking. |
| `claude agents`, `/scroll-speed`, `claude plugin details <name>`, `/mcp` reconnect | Documented in the CLI, MCP, AGENTS, and CLAUDE template guidance. |

## Compatibility Rules

1. Keep `.codex/**` as the source of truth for the Codex package.
2. Mirror Claude compatibility guidance under `templates/.claude/**` and `templates/guides/**` when behavior affects installed templates.
3. Prefer canonical kebab-case agent names even if Claude Code accepts looser variants.
4. Do not migrate shell hook entries to `args` unless the hook has no shell expansion, no pipes, and no inline script body.
5. Use `continueOnBlock` only for PostToolUse signals that the model can act on immediately.
