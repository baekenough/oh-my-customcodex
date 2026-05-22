# Claude Code Version Compatibility

This guide records Claude Code release-note impact that affects the Claude compatibility template. The Codex-native runtime still uses `.codex/**` and OMX as the primary surface.

## v2.1.146

Published: 2026-05-21.

Source: upstream oh-my-customcode #1205, Codex port #1364.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| `/simplify` was renamed to `/code-review` and accepts effort levels such as `/code-review high` | Native Claude command naming is now closer to review workflows, but this package still exposes its own `dev-review` skill. | No runtime rename. Keep user-facing docs clear that `dev-review` is the package skill and `/code-review` is the native Claude command. |
| Auto mode no longer suppresses `AskUserQuestion` when the user or a skill explicitly relies on it | Ambiguity-gated compatibility workflows can ask explicit questions even in auto mode. | No Codex tool change. Keep `request_user_input`/question usage limited to genuinely branching cases. |
| MCP `resources/list`, `resources/templates/list`, and `prompts/list` pagination was fixed | Large memory or ontology MCP servers are less likely to hide resources after page 1. | No package change; treat complete paginated MCP lists as more reliable evidence. |
| `CLAUDE_CODE_SUBAGENT_MODEL` is forwarded to child processes in multi-agent sessions | Claude compatibility sessions with model env overrides now preserve child-process model intent. | No Codex model override. Codex-native child agents still follow repo model routing and inherited defaults. |
| `/background` accepts skill-only or custom-slash-only input and background sessions preserve granted tool permissions | Long-running Claude compatibility sessions are less likely to stall on already granted permissions. | No Codex change. Keep permission expectations explicit in workflow prompts. |
| Agent SDK streaming end-of-session exception was fixed | Agent SDK plugin experiments should be less noisy at stream completion. | Monitor only; no package change. |

## v2.1.145

Published: 2026-05-19.

Source: upstream oh-my-customcode #1191, Codex port #1353.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Statusline input includes structured GitHub fields such as `gh.repo`, `gh.pr_number`, and `gh.pr_state` | Removes the need to call `gh pr view` on every refresh when Claude compatibility statusline JSON already carries PR context. | Ported. `statusline.sh` now prefers native `gh.*` fields and falls back to the cached `gh pr view` path only when they are absent. |
| Additional statusline fields may be empty strings | Empty fields can collapse TSV parsing if not normalized. | Ported. Empty native GitHub fields are normalized before Bash reads them. |
| Stability fixes for statusline and background sessions are additive | No Codex runtime change beyond template compatibility. | Keep `.codex/**` behavior primary and mirror compatibility docs. |

## v2.1.144

Published: 2026-05-18.

Source: upstream oh-my-customcode #1187, Codex port #1349.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| `claude agents --json` exposes structured background-agent state | Claude compatibility statusline and monitoring can show active agent counts without parsing display text. | Ported. Statusline JSON `agents` arrays render as `A:N` when active agents exist. |
| Stop/SubagentStop input can include `background_tasks` and `session_crons` | Session-end hooks can detect dangling background work and cron state. | Ported. `session-reflection.sh` records counts and summaries when those fields are present. |
| Background-agent status handling became more reliable | Reduces false stale-agent diagnostics for Claude compatibility users. | Keep existing Codex/OMX agent tracking and treat Claude JSON as optional compatibility evidence. |

## v2.1.143

Published: 2026-05-17.

Source: upstream oh-my-customcode #1166, Codex port #1348.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Hook/session lifecycle payloads became richer for background work | The compatibility template can capture more useful session-end evidence without blocking shutdown. | Ported through the advisory `session-reflection.sh` Stop/SubagentStop hook. |
| Background session handling received additional fixes | Helps Claude compatibility workflows that run long-lived agents. | No Codex runtime change; document behavior and keep OMX-native orchestration as primary. |
| Release-note changes are Claude-template oriented | The package must avoid redesigning Codex-native flow for Claude-only payload additions. | Mirror the compatibility guide and add tests that lock template/source docs together. |

## v2.1.142

Published: 2026-05-14.

Source: upstream oh-my-customcode #1158, Codex port #1329.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| `claude agents` added `--add-dir`, `--settings`, `--mcp-config`, `--plugin-dir`, `--permission-mode`, `--model`, `--effort`, and `--dangerously-skip-permissions` | Useful for Claude compatibility sessions that need CLI-level overrides for background agents. Codex-native child agents still use the Codex tool surface and repo model contract. | No Codex runtime change. Keep unattended Claude-template prompts explicit about permission mode. |
| Fast Mode now defaults to Opus 4.7 | Only affects Claude compatibility users running Fast Mode with `model: opus` agents. | Pin with `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE=1` only when a compatibility session needs old behavior. |
| Root-level plugin `SKILL.md` is surfaced as a skill | Does not change this repo's packaged `.claude/skills/<name>/SKILL.md` layout. | No template migration. |
| `/plugin details` shows plugin LSP servers | Improves plugin inventory visibility for compatibility users. | No package change. |
| `/web-setup` warns before replacing an existing GitHub App connection | UX safety improvement outside this harness. | No action. |
| `MCP_TOOL_TIMEOUT` now raises remote HTTP/SSE MCP request timeout as intended | Helpful for slow remote memory or ontology MCP servers. | Set `MCP_TOOL_TIMEOUT` in affected environments only. |
| Background sessions can edit existing git worktrees | Stabilizes Claude compatibility workflows that use git worktrees for parallel branches. | No Codex-side change. |
| Background sessions survive macOS sleep/wake more reliably | Improves long-running Claude compatibility sessions. | No action. |
| `--dangerously-skip-permissions` persists across retire/wake cycles | Reduces unattended permission-mode drops for Claude compatibility sessions. | Keep explicit permission guidance in workflow prompts. |

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

## Known Limitations

### Parent `.gitignore` nested plan pattern

Source: upstream oh-my-customcode #1147, Codex port #1326.

The parent package documented a future-proofing limitation for this pattern:

```gitignore
docs/superpowers/plans/*
!docs/superpowers/plans/*.md
```

That pattern only tracks direct-child Markdown files. Git cannot re-include a file inside a directory that was already excluded by a broader parent pattern unless the directory path is also re-included.

Current Codex-port status: not applicable. This repository does not ignore `docs/superpowers/plans/`, and existing nested plan documents are trackable. If a future ignore rule reintroduces that parent pattern, add explicit subdirectory re-includes before relying on nested plan files.

## Compatibility Rules

1. Keep `.codex/**` as the source of truth for the Codex package.
2. Mirror Claude compatibility guidance under `templates/.claude/**` and `templates/guides/**` when behavior affects installed templates.
3. Prefer canonical kebab-case agent names even if Claude Code accepts looser variants.
4. Do not migrate shell hook entries to `args` unless the hook has no shell expansion, no pipes, and no inline script body.
5. Use `continueOnBlock` only for PostToolUse signals that the model can act on immediately.
