# Claude Code Version Compatibility

This guide records Claude Code release-note impact that affects the Claude compatibility template. The Codex-native runtime still uses `.codex/**` and OMX as the primary surface.

The v2.1.202-v2.1.214 entries below are **provider-owned** external behavior and require **no local runtime implementation**. Codex/OMX remains the active runtime; the compatibility notes only keep packaged Claude templates and operator expectations accurate. The parent-package meanings were reviewed from oh-my-customcode commits [`a406854e`](https://github.com/baekenough/oh-my-customcode/commit/a406854e052e), [`2329bced`](https://github.com/baekenough/oh-my-customcode/commit/2329bcede), [`aa185c36`](https://github.com/baekenough/oh-my-customcode/commit/aa185c369a9208ede60f6d8304b5ac2ac90f71ff), [`66adb8e`](https://github.com/baekenough/oh-my-customcode/commit/66adb8e), [`b396e43`](https://github.com/baekenough/oh-my-customcode/commit/b396e43), [`e138929`](https://github.com/baekenough/oh-my-customcode/commit/e138929), and [`8ec0cc9`](https://github.com/baekenough/oh-my-customcode/commit/8ec0cc9).

## v2.1.214

Reviewed: 2026-07-19.

Source: [official release](https://github.com/anthropics/claude-code/releases/tag/v2.1.214), tag commit [`07dcb0e13580b21174ff1bf6a7e1d5ead3b61d60`](https://github.com/anthropics/claude-code/commit/07dcb0e13580b21174ff1bf6a7e1d5ead3b61d60); parent oh-my-customcode v1.1.23; Codex port issue #1688.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Single-segment `dir/**` hook `if:` conditions and allow rules now match only `<cwd>/dir`; `**/dir/**` is required for any-depth matching, while `deny` and `ask` remain any-depth | Claude compatibility templates can no longer assume the same depth semantics for allow versus deny/ask rules. | Record in R002/R006; preserve Codex/OMX native matcher and sandbox behavior. |
| A hook exit code 2 blocks as documented even when stdout JSON fails schema validation | Claude hard-block hooks no longer lose enforcement because their structured output is malformed. | Record in R021; keep local Codex/OMX advisory-first and fail-closed semantics unchanged. |

These are provider-owned Claude changes and do not implement or alter Codex/OMX runtime behavior.

## v2.1.212

Reviewed: 2026-07-19.

Source: [official release](https://github.com/anthropics/claude-code/releases/tag/v2.1.212), tag commit [`67f390c9a0b1440d369aebe2ff6a5023db35bf8e`](https://github.com/anthropics/claude-code/commit/67f390c9a0b1440d369aebe2ff6a5023db35bf8e); parent oh-my-customcode v1.1.23; Codex port issue #1688.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| MCP calls longer than two minutes move to the background by default, configurable with `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` | Long Claude MCP operations should not be mischaracterized as hangs when the provider transitions them. | Record in R005; keep active Codex/OMX MCP scheduling and terminal-result verification native. |
| Agent/Task `mode` is deprecated and ignored; subagents inherit the parent session permission mode | Claude compatibility guidance that relied on per-call permission overrides becomes stale on new clients. | Record in R002/R006/R010; retain old-version compatibility but do not add a native Codex `mode` parameter. |
| A `continue:false` hook halt survives tool failure or mid-stream completion and hook infrastructure errors are not reported as user rejection | Claude hook decisions are less likely to disappear or create phantom user blocks. | Record in R021; keep Codex/OMX enforcement policy unchanged. |

These are provider-owned Claude changes and do not implement or alter Codex/OMX runtime behavior.

## v2.1.211

Reviewed: 2026-07-19.

Source: [official release](https://github.com/anthropics/claude-code/releases/tag/v2.1.211), tag commit [`c39cb0f14bfe8bb519bae5bfc55add6867c5e2ab`](https://github.com/anthropics/claude-code/commit/c39cb0f14bfe8bb519bae5bfc55add6867c5e2ab); parent oh-my-customcode v1.1.23; Codex port issue #1688.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Background agent reporting waits for real completion instead of fabricating a result and reports still-running status | One Claude background agent false-completion mode is removed, but delegated prose is still not ground truth. | Record in R020; preserve Codex/OMX repository, test, registry, and API readback. |
| Auto mode no longer overrides a PreToolUse hook's `ask` decision for unsandboxed Bash | Claude compatibility enforcement keeps `ask` as the minimum prompt floor. | Record in R021; do not map Claude Auto mode onto the Codex/OMX approval policy. |

These are provider-owned Claude changes and do not implement or alter Codex/OMX runtime behavior.

## v2.1.210

Reviewed: 2026-07-19.

Source: [official release](https://github.com/anthropics/claude-code/releases/tag/v2.1.210), tag commit [`b7784f2c63ed4585c32bc20b94d3b64cf4fe6df3`](https://github.com/anthropics/claude-code/commit/b7784f2c63ed4585c32bc20b94d3b64cf4fe6df3); parent oh-my-customcode v1.1.21; Codex port issue #1673.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Unsupported path-scoped `Write(path)`, `NotebookEdit(path)`, and `Glob(path)` permission matchers now produce a startup warning | Claude compatibility settings can expose invalid matcher assumptions instead of silently accepting them. | Record in R002; use `Edit(path)` for writes and `Read(path)` for reads while keeping Codex/OMX sandbox policy unchanged. |
| Timeout-driven auto-background messages distinguish a timeout from an explicit background request and state that an internal `cd` does not change the session working directory | Claude follow-up commands no longer need to infer whether the foreground command hung or whether its directory transition persisted. | Record in R005; use absolute paths after Claude auto-background and do not add Codex working-directory behavior. |
| Grep content mode no longer returns `No matches found` merely because pagination moved past the final result | Older Claude output can represent a page boundary rather than proof that a pattern is absent. | Record in R005; verify page state and keep active Codex/OMX result handling native. |
| Unmatched positional placeholders such as `$1` and `$2` are preserved verbatim instead of silently removed | Claude compatibility skills that relied on removal can leave literal placeholders in the expanded prompt. | Record in R006; handle absent arguments explicitly with defaults, an `$ARGUMENTS` guard, or `argument-hint`; do not change Codex skill parsing. |
| A `MEMORY.md` write that exceeds the read limit returns an explicit error instead of relying on silent truncation | Oversized Claude memory indexes become recoverable rather than appearing successfully updated. | Record in R011; archive or trim Cold entries and retry while preserving the non-blocking Codex/OMX memory boundary. |
| A hook callback timeout is no longer reported to the model as a user rejection | Prevents a phantom rejection from stopping unattended Claude sessions. | Record in R021; retain real hook-failure propagation and the local fail-closed enforcement model. |

## v2.1.209

Reviewed: 2026-07-16.

Source: [official release](https://github.com/anthropics/claude-code/releases/tag/v2.1.209), tag commit [`988b3e56432775c09bba903ba22522b97cd0f2fb`](https://github.com/anthropics/claude-code/commit/988b3e56432775c09bba903ba22522b97cd0f2fb); parent oh-my-customcode v1.1.18; Codex port issue #1660.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| `/model` and other dialogs work in background `claude agents` sessions | Removes a Claude background-session interaction blocker. | Record in R010 as provider-owned compatibility; no Codex/OMX dialog, routing, or daemon change. |

## v2.1.208

Reviewed: 2026-07-16.

Source: [official release](https://github.com/anthropics/claude-code/releases/tag/v2.1.208), tag commit [`1fb278b85d4546c7c04db3b3590e031b5a8a7571`](https://github.com/anthropics/claude-code/commit/1fb278b85d4546c7c04db3b3590e031b5a8a7571); parent oh-my-customcode v1.1.18; Codex port issue #1660.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Agent `tools:` lists that resolve empty now name unrecognized entries | Claude compatibility agents fail clearly instead of receiving an accidental empty tool set. | Record in R006; keep Codex native dispatch on installed OMX roles and `agent_type`. |
| Permission matcher compilation is cached | Improves Claude permission-check performance without changing policy meaning. | Record in R002; no Codex sandbox or approval-policy change. |
| `/release-notes` no longer pollutes context, temporary 200k context display resets correctly, and completed background agents remain in `/tasks` | Improves Claude context/status accuracy. | Record in R012; OMX HUD and Codex statusline remain authoritative for this runtime. |
| Catastrophic removal inside shell substitution or a subshell receives the same prompt as a plain command | Adds provider defense in depth for destructive shell forms. | Record in R001; retain repository target, recovery, and approval checks. |
| Settings and environment numbers in scientific notation parse correctly; Edit, Read, Grep, and Glob reliability improves | Removes Claude parser/tool false failures. | Record in R005 and continue evidence-based tool verification. |
| `CLAUDE_CODE_PROCESS_WRAPPER` and background reply, attach, version-selection, and daemon fixes | Improves Claude process integration and background reliability. | Record in R010; no local process wrapper or daemon implementation. |

## v2.1.207

Reviewed: 2026-07-16.

Source: [official release](https://github.com/anthropics/claude-code/releases/tag/v2.1.207), tag commit [`d4d8fbbb333c627d8fe2c1c583a5ccc26fdb1aed`](https://github.com/anthropics/claude-code/commit/d4d8fbbb333c627d8fe2c1c583a5ccc26fdb1aed); parent oh-my-customcode v1.1.13; Codex port issue #1650.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Auto mode on Bedrock, Vertex, and Foundry no longer requires opt-in; managed settings add `disableAutoMode`; noninteractive remote managed-settings consent is fixed | Changes Claude provider enablement and enterprise control only. | Record in R002; do not map Claude Auto mode onto Codex approval policy. |

## v2.1.206

Reviewed: 2026-07-16.

Source: [official release](https://github.com/anthropics/claude-code/releases/tag/v2.1.206), tag commit [`15a21e1b4e240e2da6a4953d5f148a806c9c9bb2`](https://github.com/anthropics/claude-code/commit/15a21e1b4e240e2da6a4953d5f148a806c9c9bb2); parent oh-my-customcode v1.1.13; Codex port issue #1651.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| `/doctor` detects checked-in `CLAUDE.md` content that can be derived or trimmed | Provides a Claude context-optimization diagnostic. | Record in R005; measure before editing and do not auto-trim Codex guidance. |
| `/commit-push-pr` auto-allows `git push` to configured `remote.pushDefault` or the sole remote, in addition to `origin` | Reduces Claude permission friction for the configured push target. | Record in R010; retain repository git authority and explicit remote verification. |

## v2.1.205

Reviewed: 2026-07-16.

Source: [official release](https://github.com/anthropics/claude-code/releases/tag/v2.1.205), tag commit [`be02c39841a59e2ac1f35ac12285def02acdbb5a`](https://github.com/anthropics/claude-code/commit/be02c39841a59e2ac1f35ac12285def02acdbb5a); parent oh-my-customcode v1.1.13; Codex port issue #1652.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Auto mode blocks transcript tampering | Hardens Claude session integrity. | Record in R001; keep Codex transcript and state protections unchanged. |
| Windows worktree removal avoids deleting targets outside the worktree through junctions or symlinks | Reduces provider cleanup blast radius. | Record in R001; still inspect targets and recovery before destructive cleanup. |

## v2.1.204

Reviewed: 2026-07-16.

Source: [official release](https://github.com/anthropics/claude-code/releases/tag/v2.1.204), tag commit [`d0f5bebd40c098c5913b6419a2ecfc7104f0cd41`](https://github.com/anthropics/claude-code/commit/d0f5bebd40c098c5913b6419a2ecfc7104f0cd41); parent oh-my-customcode v1.1.13; Codex port issue #1653.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Headless `SessionStart` hook output streams correctly so active remote workers are not reaped as idle | Removes a Claude hook/worker lifecycle false failure. | Record in R006; no Codex hook-streaming or worker lifecycle implementation. |

## v2.1.203

Reviewed: 2026-07-16.

Source: [official release](https://github.com/anthropics/claude-code/releases/tag/v2.1.203), tag commit [`00ea2924471e5c226e872d42229fbb1dae41f442`](https://github.com/anthropics/claude-code/commit/00ea2924471e5c226e872d42229fbb1dae41f442); parent oh-my-customcode v1.1.13; Codex port issue #1654.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| A grey pause badge appears in the footer while Manual permission mode is active | Clarifies Claude permission state in its native footer. | Record in R002; do not treat the badge as OMX HUD or Codex sandbox state. |

## v2.1.202

Reviewed: 2026-07-16.

Source: [official release](https://github.com/anthropics/claude-code/releases/tag/v2.1.202), tag commit [`7930e1c82d997b013af28673501f3b95569a71cb`](https://github.com/anthropics/claude-code/commit/7930e1c82d997b013af28673501f3b95569a71cb); parent oh-my-customcode v1.1.13; Codex port issue #1655.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| `/config` offers small, medium, and large Dynamic workflow size choices, but the choice is advisory rather than an enforced cap | Claude teams still require actual-capacity and roster checks. | Record in R009/R018; preserve active Codex/OMX concurrency limits. |
| Workflow-spawned agent telemetry includes `workflow.run_id` and `workflow.name` | Improves Claude workflow attribution. | Record in R012; do not add local telemetry fields or alter OMX trace ownership. |

## v2.1.201

Reviewed: 2026-07-06.

Source: upstream oh-my-customcode v1.1.7 / #1567.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Claude Sonnet 5 sessions no longer receive harness reminders as mid-conversation `system` role messages | Prompt-shape compatibility change for packaged Claude templates only. PostCompact rule reinjection and Codex/OMX continuity are unchanged. | Document in R006 and keep Codex-native routing/state on AGENTS.md plus OMX surfaces. |

## v2.1.200

Reviewed: 2026-07-06.

Source: upstream oh-my-customcode v1.1.7 / #1567.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| `default` permission mode is displayed as `Manual`; `manual` is accepted alongside `default` | Claude compatibility templates and operator docs should recognize both names as the same behavior. | Document in R002/R006; do not map the UI label onto Codex sandbox policy. |
| `AskUserQuestion` no longer auto-continues by default | Unattended Claude compatibility flows can now block indefinitely if they ask questions without a real blocker. | Document in R002; FSD/auto-dev should continue using best judgment for low-risk reversible work. |
| Subagents rate-limited before first output now return clean failure instead of an empty result | Reduces silent-empty delegated results, but does not remove the need for ground-truth verification. | Document in R020 and keep deterministic `git status`/validation/test/API checks. |
| Background-session and daemon lifecycle fixes cover sleep/wake stalls, stale locks, daemon freshness, roster/orphan cleanup, record preservation, and socket auth token handling | Fewer Claude background-agent false blockers. | Document in R010; Codex/OMX release flow still verifies branch, PR, tag, registry, and working-tree state directly. |
| `.claude.json` non-array MCP server lists no longer crash startup | Claude compatibility config is more forgiving. | Mention in R002 as Tier-6/MCP startup resilience; no Codex config schema change. |

## v2.1.199

Reviewed: 2026-07-05.

Source: upstream oh-my-customcode v1.1.3 / #1561 and v1.1.6 / #1564.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| SessionStart/Setup/SubagentStart hooks now surface stderr when exiting 2 | Improves Claude-template hard-block/advisory hook debugging. | Document in R006/R021; Codex/OMX enforcement remains advisory-first plus local hooks. |
| Stacked slash-skill calls load up to five leading skills | Reduces context loss for chained Claude compatibility skill invocations. | Document in R006; keep `omcustomcodex:` namespaced skill surfaces for this package. |
| Subagent rate-limit/server errors return partial work and API errors are no longer reported as success | Lowers false-success risk for Claude subagents and Agent Teams. | Document in R018/R020; still require deterministic repository/test/API evidence before accepting completion. |

## v2.1.198

Reviewed: 2026-07-05.

Source: upstream oh-my-customcode v1.1.3 / #1561.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Built-in Explore agent inherits the main session model and subagents/compaction inherit extended-thinking settings | Improves Claude-template exploration/delegation quality. | Record as Claude compatibility only; Codex-native subagents still use installed OMX roles and model metadata. |
| Background agents can auto-commit/push/open draft PRs after completing work, with better transient-network retry behavior | Reduces false blockers for Claude background-agent flows. | Document in R010; keep release branches and PR state explicitly verified by Git/GitHub evidence. |
| Background agent notifications fire for needs-input and completed states | Better observability for long-running Claude compatibility sessions. | Document in R012; Codex/OMX status remains native OMX HUD and Codex TUI footer state. |
| Agent Teams reports teammate API failures and wakes stuck teammates on message | Improves retry behavior but does not make SendMessage self-report authoritative. | Document in R018 and keep deterministic ground-truth checks. |

## Claude Fable 5 prompting guide

Reviewed: 2026-07-05.

Source: upstream oh-my-customcode v1.1.4 / #1562.

`guides/claude-code/16-fable5-prompting.md` records Fable 5 prompting guidance for packaged Claude compatibility sessions: high effort by default, `xhigh` only for capability-sensitive work, concise prompts over over-prescription, long-lived bounded lanes when appropriate, and Mythos 5 as limited availability / not GA. This does not change Codex-native OMX model routing.

## v2.1.178

Published: 2026-06-15.

Source: upstream oh-my-customcode v1.0.9 / #1391, Codex-port issue #1524.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Permission rules support `Tool(param:value)` with `*` wildcards, such as `Agent(model:opus)` | Claude compatibility settings can now deny a specific tool-parameter shape instead of only a tool name. This complements `availableModels` and explicit subagent permission-mode guidance, but Codex/OMX sandboxing remains the active runtime boundary here. | Document as Claude-template R002 compatibility; do not translate Claude permission syntax into Codex policy. |
| Compaction honors the configured `fallbackModel` chain on overload or availability errors | Claude compatibility sessions using fallback models are less likely to fail during compaction. This extends the v2.1.166 fallback behavior to the compaction path. | Document under Claude agent/model compatibility; keep Codex subagent routing on OMX model metadata and `reasoning_effort`. |
| Nested `.claude/skills` directories load for files in that subtree, name collisions surface as `<dir>:<name>`, and directory-qualified skills avoid non-interactive permission prompts | Nested Claude template trees can coexist with root skills without silently hiding same-named entries. | Keep this package's installed `.codex/**` and flat template layout primary; mention the nested Claude behavior only for compatibility sessions. |
| Subagent `disallowedTools` now honors MCP-spec entries such as `mcp__server`, `mcp__server__*`, and `mcp__*` | Claude subagent frontmatter can constrain MCP surfaces that were previously ignored. | Record as Claude R006 compatibility; continue using repo-owned Codex/OMX tool boundaries for this package. |
| When nested `.claude/` definitions collide, the closest agent, workflow, or output-style to the working directory wins; project-scope workflow saves target the closest existing `.claude/workflows/` | Monorepo Claude compatibility sessions may resolve names differently from root-only assumptions. | Document closest-wins behavior; avoid inferring Codex skill/workflow precedence from it. |
| Auto mode evaluates subagent spawns with the safety classifier before launch | Claude adds a platform-level pre-launch gate for subagent actions. It complements, but does not replace, prompt-level scope boundaries. | Keep pre-delegation scope statements in guidance; treat classifier gating as defense-in-depth for Claude sessions only. |
| `claude agents` workers behind `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` no longer fail with `401 Invalid bearer token`; `/bg` sessions no longer show `Working` forever after completion | Reduces false blockers in Claude background-agent and custom-gateway workflows. | Document as Claude background-agent reliability; no Codex runtime or package source change. |

## v2.1.177

| Change | Impact | oh-my-customcodex action |
|--------|--------|---------------------------|
| Bug-fix/reliability release following v2.1.176 | No new Codex/OMX runtime contract. | Record compatibility confirmation; no package behavior change. |

## v2.1.176

| Change | Impact | oh-my-customcodex action |
|--------|--------|---------------------------|
| `footerLinksRegexes` renders regex-matched footer link badges; session titles are generated in the conversation language when configured | Useful for packaged Claude compatibility statusline UX. | Document in R012 as compatibility-only; Codex uses OMX HUD and the native `/statusline` footer. |

## v2.1.175

| Change | Impact | oh-my-customcodex action |
|--------|--------|---------------------------|
| Managed `enforceAvailableModels` constrains the resolved Default model as well as subagent model overrides, dispatch picker, and advisor model | Enterprise Claude templates can prevent user/project settings from widening model allowlists. | Document in R006 as Claude enterprise config behavior; do not change Codex native model routing. |

## v2.1.174

| Change | Impact | oh-my-customcodex action |
|--------|--------|---------------------------|
| `/usage` shows attribution for cache misses, long context, subagents, and per-skill/agent/plugin/MCP usage | Better Claude-client cost diagnostics without standing up OTEL. | Document in R012; keep `monitoring-setup` as the Codex/OMX telemetry path. |
| Workflow `agent()` subagents include per-agent attribution headers | Aligns Workflow fan-out with R008 traceability expectations. | Document in R008; Codex-native subagents still require explicit OMX `agent_type`. |
| Background sessions stop inheriting foreign `ANTHROPIC_*` provider env and pre-warmed workers recover auth correctly | Reduces Claude `/bg` isolation/auth false blockers. | Document in R010; keep explicit Codex/OMX routing and permission boundaries. |

## v2.1.173

| Change | Impact | oh-my-customcodex action |
|--------|--------|---------------------------|
| Fable 5 model IDs with redundant `[1m]` suffix are auto-normalized because Fable includes 1M context by default | Avoids confusing Claude compatibility model strings. | Document in R006; omit `[1m]` from Fable metadata while leaving Opus/Sonnet extended context suffix guidance intact. |

## v2.1.170

Published: 2026-06-10.

Source: upstream oh-my-customcode #1352/#1354, Codex port #1504.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Claude Fable 5 is available through the `fable` alias (`claude-fable-5`) | Useful only for packaged Claude compatibility sessions needing mythos-class reasoning; Codex-native subagents continue to use the OMX model contract and `reasoning_effort`. | Document in R006 as Claude-compatibility metadata. Do not change Codex routing defaults. |
| VS Code integrated-terminal sessions save transcripts correctly and show them in `--resume` | Improves Claude-template workflows that depend on transcript replay, including imported `homework`/retrospective flows. | Prefer Claude Code v2.1.170+ when testing Claude compatibility transcript-dependent skills. No Codex runtime change. |

## v2.1.169

Published: 2026-06-08.

Source: upstream oh-my-customcode #1329, Codex port #1496.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| `--safe-mode` and `CLAUDE_CODE_SAFE_MODE` start Claude Code with all customizations disabled | Useful for isolating whether a packaged `.claude` template, skill, hook, plugin, or MCP server causes a Claude-compatibility regression. | Document in R006; do not change Codex/OMX runtime loading. |
| `disableBundledSkills` and `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` hide bundled skills, workflows, and built-in slash commands from the model | Helps when Claude bundled skills duplicate or conflict with project skills. Distinct from advisory `skills:` frontmatter metadata. | Record as Claude platform setting; keep Codex skill roots unchanged. |
| `claude agents --json` includes blocked and just-dispatched sessions; `--all` includes completed sessions; output includes `id` and `state` | Strengthens Claude-template Agent Teams completion checks. | Prefer `--all` + `state` when diagnosing Claude Agent Teams; Codex/OMX uses native runtime state plus repo evidence. |
| `/cd` command and reliability fixes for MCP policy/history behavior | Claude operator convenience only. | No Codex runtime change. |

## v2.1.168

Published: 2026-06-07.

Source: upstream oh-my-customcode #1315, Codex port #1479.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Bug-fix/reliability release after the v2.1.166 compatibility surface | No new repo-owned template, agent, skill, hook, or rule behavior was identified beyond the v2.1.166 notes. | Record as compatibility-confirmed; do not add speculative runtime behavior. |

## v2.1.167

Published: 2026-06-07.

Source: upstream oh-my-customcode #1313, Codex port #1479.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Bug-fix/reliability release after the v2.1.166 compatibility surface | No new repo-owned template, agent, skill, hook, or rule behavior was identified beyond the v2.1.166 notes. | Record as compatibility-confirmed; do not add speculative runtime behavior. |

## v2.1.166

Published: 2026-06-07.

Source: upstream oh-my-customcode #1314/#1316, Codex port #1479.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Deny rules support glob patterns in the tool-name position, including `"*"` to deny all tools; allow-rule globs remain limited to MCP tool-name globs | Relevant to Claude compatibility settings and permission debugging. Codex/OMX sandboxing remains the active runtime boundary for this package. | Port R002 compatibility note; do not treat Claude settings globs as Codex policy. |
| `fallbackModel` supports up to three ordered fallback models and `--fallback-model` applies to interactive sessions | Useful Claude platform availability failover. It is distinct from per-agent `model:` metadata, the `model-escalation` skill, and Codex-native model routing. | Port R006 note; keep Codex child agents on the OMX model contract and `reasoning_effort`. |
| `MAX_THINKING_TOKENS=0`, `--thinking disabled`, and per-model thinking toggles can disable default thinking | Claude compatibility sessions can reduce thinking overhead for low-effort work. | Document as Claude-only compatibility; do not infer Codex reasoning behavior. |
| Cross-session relayed `SendMessage` no longer carries user authority; relayed permission requests are refused and auto mode blocks them | Hardens peer-relay workflows against privilege escalation between Claude sessions. Intra-session Agent Teams are unaffected. | Port R018 note and keep privileged actions scoped to the receiving session. |

## v2.1.158

Published: 2026-05-30.

Source: upstream oh-my-customcode #1264, Codex port #1436.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Auto mode is available on Bedrock, Vertex, and Foundry for Opus 4.7 and Opus 4.8 via `CLAUDE_CODE_ENABLE_AUTO_MODE=1` | Claude compatibility sessions can opt into provider-backed auto mode for those Opus surfaces. Codex-native model routing and approval policy are unchanged. | Document as Claude provider compatibility only. Do not infer Codex auto-mode behavior from this env var. |

## v2.1.157

Published: 2026-05-29.

Source: upstream oh-my-customcode #1265, Codex port #1437.

| Change | Impact on oh-my-customcodex | Action |
|--------|------------------------------|--------|
| Plugins under `.claude/skills` auto-load, `claude plugin init <name>` scaffolds plugins there, and `/plugin` has argument autocomplete | Useful for Claude compatibility plugin setup. Codex-native skills remain under `.codex/skills`, `.agents/skills`, and OMX skill roots. | Keep `.codex/OMX` primary. Mention `.claude/skills` only when documenting Claude plugin compatibility. |
| `claude agents` honors the `agent` field in `settings.json`, with `--agent <name>` as an override | Claude dispatched sessions can inherit a configured default agent unless explicitly overridden. | Do not mirror this into Codex routing. Codex native subagents still follow prompt routing, role metadata, and explicit delegation. |
| `EnterWorktree` can switch between Claude-managed worktrees mid-session, and Claude-managed worktrees are left unlocked for `git worktree remove`/`prune` cleanup | Claude worktree lifecycle is more flexible and less likely to leave locked cleanup blockers. | Keep auto-dev work in clean worktrees, verify `git status`, and do not treat Claude-managed worktree state as OMX state. |
| `tool_decision` telemetry can include `tool_parameters` such as Bash commands and MCP/skill names when `OTEL_LOG_TOOL_DETAILS=1` | Telemetry may contain more detailed operational data, including command and tool-parameter strings. | Treat logs as potentially sensitive. Avoid exporting transcripts or telemetry that may expose secrets, credentials, or privileged commands. |
| Background/session fixes cover parked subagents, leaked background shells, orphaned `.claude/worktrees`, resume state, date after sleep/wake, fullscreen picker cleanup, current linked worktree return, image placeholders, network prompts, and tmux clipboard behavior | Reduces false blockers and stale-state surprises in Claude compatibility sessions. | No Codex runtime change. Continue using OMX state, Codex worktree checks, and direct command evidence for Codex-native completion claims. |

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
