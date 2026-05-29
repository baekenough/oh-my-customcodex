# Claude Code Version Compatibility

This guide records Claude Code release-note impact that affects the Claude compatibility template. The Codex-native runtime still uses `.codex/**` and OMX as the primary surface.

## v2.1.156

Published: 2026-05-29.

Source: upstream oh-my-customcode #1245, Codex port #1420.

Note: v2.1.155 had no public release.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Fixed Opus 4.8 thinking-block API errors | Claude compatibility sessions using the v2.1.154 Opus 4.8 surface are more stable. Codex-native model routing is unchanged. | No package change. Prefer v2.1.156 over v2.1.154 when testing Claude Opus 4.8 compatibility. |

## v2.1.154

Published: 2026-05-28.

Source: upstream oh-my-customcode #1244, Codex port #1419.

Note: v2.1.155 had no public release.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Opus 4.8 and the `opus48` alias were introduced | Relevant to Claude-template agent model notes only; Codex-native child agents still follow the OMX model contract. | Document as compatibility vocabulary. Do not replace Codex model routing with Claude alias behavior. |
| Dynamic Workflows reached general availability | Conceptually overlaps with OMX workflows, but remains a Claude-native orchestration surface. | Keep OMX `$pipeline`, `$team`, and Codex subagents primary. Mention Dynamic Workflows only in Claude compatibility guidance. |
| Lean system prompt defaults and Fast Mode override deprecation were announced | Claude compatibility sessions may see changed prompt weight and deprecation of `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE` after 2026-06-01. | No template change; avoid relying on the deprecated override for new guidance. |

## v2.1.153

Published: 2026-05-28.

Source: upstream oh-my-customcode #1243, Codex port #1418.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Statusline environment now includes `COLUMNS` and `LINES` | Claude-template statusline scripts can size output with terminal dimensions when available. | No Codex statusline change required; keep fallbacks for missing env values. |
| Marketplace plugin sources support `skipLfs` | Helpful for Claude plugin installs that should avoid Git LFS assets. | Document as Claude marketplace compatibility only. |
| `claude agents` autocomplete improved | Improves Claude CLI UX without changing packaged agent definitions. | No package change. |

## v2.1.152

Published: 2026-05-27.

Source: upstream oh-my-customcode #1242, Codex port #1417.

Note: v2.1.151 had no public release.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Skill frontmatter supports `disallowed-tools` | Useful Claude-template metadata for constraining tools; Codex rule surfaces still enforce `.codex/**` policy. | No package migration. Preserve explicit tool-policy rules instead of relying solely on Claude frontmatter. |
| `/reload-skills` and `SessionStart reloadSkills` reload skill state | Helps Claude compatibility sessions pick up skill edits without restart. | No Codex runtime change; keep installed templates deterministic and test mirrored files. |

## Known Platform Issues

### Agent tool malformed parsing on long / special-character prompts

Source: upstream oh-my-customcode #1241, Codex port #1416.

| Issue | Impact on oh-my-customcodex | Workaround |
|-------|------------------------------|------------|
| Agent tool malformed parsing can occur when delegation prompts are very long or contain heavy special characters such as backticks, repeated colons, or shell-variable syntax. | This is a Claude Code platform serialization issue, not an oh-my-customcodex defect. Codex-native subagent dispatch is unaffected. | Keep Claude `Agent` prompts shorter, move large evidence into files, avoid dense shell quoting in delegation text, and retry with a smaller prompt when `malformed` appears. |

## v2.1.150

Published: 2026-05-23.

Source: upstream oh-my-customcode #1220, Codex port #1380.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Internal infrastructure improvements only | No user-facing Claude compatibility behavior changed for templates, agents, skills, hooks, or rules. | No package change. Record the no-op review so release-monitor ports can be closed with evidence instead of staying open. |

## v2.1.149

Published: 2026-05-22.

Source: upstream oh-my-customcode #1219, Codex port #1379.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| `/usage` now breaks limit usage down by skills, subagents, plugins, and MCP servers | Useful diagnostic vocabulary for Claude compatibility sessions; Codex-native reporting still comes from OMX status, trace, and local CLI surfaces. | No runtime change. Keep cost and status reports source-specific instead of treating Claude `/usage` output as Codex evidence. |
| `/diff` detail view supports keyboard scrolling and Markdown renders GFM task-list checkboxes | Improves Claude terminal UX for reviews and release notes. | No template change. Continue writing normal Markdown task lists; Claude now renders them more faithfully. |
| Enterprise `allowAllClaudeAiMcps` can load claude.ai cloud MCP connectors next to managed MCP config | Only affects managed Claude enterprise workspaces. | Document as Claude-template compatibility only; Codex MCP routing remains configured through Codex/OMX config. |
| PowerShell `cd` aliases, wildcard prefix rules, and stale directory-variable tracking were hardened | Permission-analysis fixes reduce Claude compatibility sandbox escapes. | No Codex shell-policy change. Do not copy PowerShell-specific assumptions into Codex Bash approvals. |
| Git worktree sandbox allowlists now cover only the shared `.git` directory, not the whole main repo | Aligns with this repo's preference for isolated worktrees during auto-dev sweeps. | Keep release and issue-sweep work in clean worktrees and verify dirty-tree boundaries explicitly. |
| Bash `find` no longer exhausts macOS file/vnode tables on large trees | Large repository scans are safer for Claude compatibility sessions. | Still prefer `rg`/targeted `find` in Codex sessions and keep scans bounded. |
| `/ultraplan` and remote sessions no longer fail when there are no real uncommitted changes | Reduces false blockers for clean-tree planning. | No package change; continue verifying `git status` before declaring clean boundaries. |
| `otelHeadersHelper` reports path-with-spaces failures in `/doctor` and debug logs | Helps diagnose local telemetry setup drift. | Keep hook and doctor guidance path-safe, especially under workspace paths that may contain spaces. |

## v2.1.148

Published: 2026-05-22.

Source: upstream oh-my-customcode #1218, Codex port #1378.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Fixed a v2.1.147 regression where the Bash tool returned exit code 127 for every command for some users | Claude compatibility sessions on affected versions may have produced false command-not-found failures. | Treat suspicious all-command `127` reports from Claude v2.1.147 as environment/version evidence to verify before changing repo code. No Codex runtime change. |

## v2.1.147

Published: 2026-05-21.

Source: upstream oh-my-customcode #1216 and #1222, Codex ports #1376 and #1381.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Added the `Workflow` tool for deterministic multi-agent orchestration, gated by `CLAUDE_CODE_WORKFLOWS=1` | This overlaps conceptually with OMX `$pipeline`, but it is a Claude-native tool surface. | Do not replace Codex/OMX pipeline routing with Claude Workflow. Mention the env gate when documenting Claude-template sessions. |
| Pinned background sessions stay alive when idle, restart in place for updates, and are shed after non-pinned sessions under memory pressure | Claude compatibility background agents are more durable. | Keep Codex-native child-agent and OMX session lifecycle separate; pinned Claude sessions are not proof of active OMX work. |
| `/simplify` was renamed to `/code-review`; it now reports correctness bugs at chosen effort levels and the old cleanup-and-fix behavior was removed | Potential naming confusion with this package's `dev-review` and `dev-refactor` skills. | Keep package commands as `dev-review` for best-practice review and `dev-refactor` for cleanup/refactor. Do not add a dead `simplify` route. |
| REPL and Workflow sandboxes were hardened against prototype-pollution and thenable-based escapes | Security hardening applies to Claude runtime internals. | No package code change; keep security reviews focused on repo-owned hooks, scripts, and generated templates. |
| Auto-updater retries transient network failures and reports specific error categories plus current version on update failure | Helps distinguish transient update problems from package regressions. | For publish/update triage, verify registry token, workflow logs, and current version before making permanent workflow edits. |
| Large diff rendering and prompt-history duplicate handling improved | UX-only for Claude compatibility sessions. | No template change. |
| Enterprise login restrictions are enforced against third-party-provider and API-key sessions | Managed Claude environments behave more consistently. | No Codex auth change. Treat enterprise login policy as external environment state. |
| Headless/SDK unknown slash commands now show an error instead of silently doing nothing | Broken generated commands should be easier to detect. | Keep template command names explicit and test packaged command references. |
| Plugin agents declaring multiple `Agent(...)` tool types no longer drop all but the last one | Compatibility templates with multi-agent tool declarations are safer. | Continue using canonical, explicit agent names in package docs and frontmatter. |
| Hook `if` conditions such as `PowerShell(git push*)` were fixed to match as intended | Claude hook compatibility improved. | Keep Codex hook routing Bash-first unless a hook is explicitly PowerShell-specific. |

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
