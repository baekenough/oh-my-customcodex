# Claude Code Version Compatibility

This guide records Claude Code release-note impact that affects the Claude compatibility template. The Codex-native runtime still uses `.codex/**` and OMX as the primary surface.

## v2.1.141

Published: 2026-05-13.

Source: upstream oh-my-customcode #1137, Codex port #1310.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Hook JSON output can include `terminalSequence` for desktop notifications, window titles, and terminal bells | Optional complement to stderr HUD events and the command statusline; no Codex hook change is required for this release. | Record the option in R012 and defer any hook implementation until there is a concrete UX need. |
| `CLAUDE_CODE_PLUGIN_PREFER_HTTPS` clones GitHub plugin sources over HTTPS instead of SSH | Helps Claude-template users install plugins in CI or locked-down networks without GitHub SSH keys. | No command change; document as opt-in environment behavior. |
| `ANTHROPIC_WORKSPACE_ID` scopes workload identity federation tokens to one workspace | Useful only for multi-workspace enterprise Claude environments. | No Codex-side change required. |
| `claude agents --cwd <path>` scopes the session list to a directory | Reduces noise when monitoring Claude compatibility sessions from a monorepo or multi-project workspace. | Track as a P3 CLI-flags guide follow-up; keep canonical project examples on `oh-my-customcodex`. |
| `/feedback` can include recent sessions from the last 24 hours or 7 days | Improves upstream bug reports for multi-session agent behavior. | No harness change required. |
| Rewind menu can summarize earlier context while preserving recent turns | Complements manual context management and memory handoff guidance. | No hook change required. |
| Auto-mode permission dialogs explain which `permissions.ask` rule caused a prompt | Makes Claude-template permission debugging easier. | Keep permission guidance explicit; no template mutation needed. |
| IDE file-edit prompts restored the "view diff in your IDE" option | UX restoration only. | No action. |
| Background agents launched via `/bg` or `←←` preserve the current permission mode | Removes a historical source of unattended permission prompts in Claude compatibility sessions. | Add an R010 note; keep delegated tool policy explicit for workflows that rely on unattended writes. |
| `claude agents` marks completed agents correctly even if a background shell remains | Improves R009/R018 monitoring for long-running compatibility sessions. | No Codex-side change required. |
| Spinner, plugin menu, provider fallback, daemon, and Windows fixes are additive stability improvements | No direct package behavior change. | No action beyond this compatibility record. |

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
