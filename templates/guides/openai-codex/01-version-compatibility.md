# OpenAI Codex Version Compatibility

This guide records OpenAI Codex release-note impact decisions for oh-my-customcodex. Use it for Codex/OMX runtime compatibility notes; keep Claude-only release notes in `guides/claude-code/15-version-compatibility.md`.

## oh-my-codex v0.19.1-v0.20.1 / cumulative OMX baseline

Sources: upstream oh-my-codex releases `v0.19.1`, `v0.20.0`, and `v0.20.1`; Codex-port issues #1572, #1575, and #1576.

| Change | Impact on oh-my-customcodex | Action |
| --- | --- | --- |
| `v0.19.1` repairs Ultragoal conductor provenance and aggregate completion, invalid mission-summary recovery, Ralplan terminalization/Stop-cache loops, direct Team state roots, and adds the mission-queue runner MVP. | These are reliability fixes in workflows and state machines supplied by OMX, not package-owned engines. | Include the fixes in the cumulative dependency review; do not copy their implementation into this child package. |
| `v0.20.0` moves the OMX model contract to GPT-5.6 Sol/Terra/Luna, updates exact role pins and cheap-lane classification, preserves explicit overrides as opaque strings, and offers prompt-gated migration from legacy model defaults. | The package already delegates concrete model selection to the active Codex/OMX configuration. Hardcoding the release's model table locally would create a second, stale routing contract. | Require the current runtime and continue resolving models from its live configuration rather than duplicating provider-owned model metadata. |
| `v0.20.0` also makes project setup plugin-first, gates plugin hooks to OMX-launched sessions, keeps resume preflight opt-in, reopens persisted subagents on session start, uses canonical worktree tool context, and adds manual `omx capabilities lock`/`check` preflight commands. | These change upstream runtime/setup semantics but do not add a package-owned plugin manager, session restorer, worktree engine, or automatic capability-lock gate. | Record them as external capabilities. Keep `omcustomcodex init`, `update`, and `doctor` responsible only for their existing package-owned readiness boundary. |
| `v0.20.1` makes generated `AGENTS.md` marker insertion CRLF-safe, permits normalized direct-child Ralplan Markdown drafts, stops seeding legacy multi-agent/context defaults, returns schema-safe Stop responses, recognizes trusted delegated collaboration-child provenance, and hardens incomplete capability inventories plus quoted Bash target parsing. | These fixes directly affect planning, delegation, setup, and hook flows used by this harness, but the behavior remains owned by OMX. | Raise the packaged `MINIMUM_OMX_VERSION` to `0.20.1`; versions through `0.20.0` are stale for `init`, `update`, and `doctor`. |
| The three releases state no intentional breaking CLI/package-layout change; `v0.20.0` changes project setup defaults but retains opaque explicit model overrides. | No package dependency, config-schema, or template-layout migration is required beyond selecting the safe runtime floor. | Keep the provider boundary intact and verify the minimum-version test in both stable CI and release gates. |
| Residual #1610: direct repeated `omx setup --scope project --merge-agents` can still reorder coexisting Codex hook groups in OMX `v0.20.1`, invalidating positional trust; the upstream defect remains open as `Yeachan-Heo/oh-my-codex#3147`. | The v1.0.10 child-harness normalization only mitigates setup flows invoked through `omcustomcodex`; it does not fix direct OMX setup or satisfy #1610's live `hooks/list` acceptance criteria. | Keep #1610 open and retain the bounded local mitigation. Do not describe the `v0.20.1` baseline as resolving upstream hook trust preservation. |

## rust-v0.144.0-rust-v0.144.3 / CLI 0.144.3 final state

Sources: upstream OpenAI Codex releases `rust-v0.144.0`, `rust-v0.144.2`, and `rust-v0.144.3`; Codex-port issues #1573, #1622, and #1623. The closed monitor-only #1574 (`rust-v0.144.1`) is included only as sequence context.

| Change | Impact on oh-my-customcodex | Action |
| --- | --- | --- |
| `rust-v0.144.0` adds typed/expiring usage-credit redemption, a `writes` app-approval mode, default interactive MCP authentication, host-provided app-server authentication with hosted redirects, global pnpm install detection, and an Ultra/high-concurrency usage warning. | These improve Codex account, app, MCP, installation, and TUI behavior outside the package's installed template contract. | Record the capabilities as external runtime behavior; do not add local approval, authentication, usage-credit, package-manager, or concurrency-warning implementations. |
| The same release recovers compaction that references retired models, fixes Intel macOS Code Mode, lets Windows sandboxes delete within writable roots and reach the managed runtime, sanitizes pasted terminal controls, refreshes hosted `codex_apps` authentication, preserves proxy/CA-aware Responses WebSockets, and improves plugin loading and review selection. | These reliability fixes reduce false blockers during harness use without changing package-owned source or configuration. | Rely on the installed Codex runtime and preserve evidence-based package verification; no local runtime migration is required. |
| `rust-v0.144.1` fixes standalone release-metadata parsing, macOS Code Mode host packaging, and embedded-runtime fallback when the companion host is absent. | #1574 was already closed as monitor-only, so it is not part of the v1.0.16 release unit. | Retain it only as final-state context between the pinned `0.144.0` and `0.144.2` releases. |
| Guardian final state: `rust-v0.144.0` changed automatic review prompting, but `rust-v0.144.2` reverted that change and restored the previous Guardian auto-review policy, request format, prompting, and tool behavior. | The intermediate `0.144.0` prompting change is not the behavior operators receive at the `0.144.3` endpoint. Guardian remains a Codex runtime feature rather than a packaged reviewer implementation. | Document the rollback as the final state; do not port the superseded prompt or claim that `oh-my-customcodex` implements Guardian. |
| The official `rust-v0.144.3` release note calls it a version-only release with no merged pull-request changes since `rust-v0.144.2`, but tag comparison shows divergent ancestry with direct commit `8a4d35a` (`feat(tui): add an advanced reasoning picker`) before the release-note/version commit. | Release-note text alone would omit a TUI capability present in the tagged ancestry. The direct commit is not a package-owned model-routing or picker contract, and "no merged pull request" does not prove that no direct commit exists. | Preserve the release-note-versus-tag-ancestry discrepancy explicitly. Treat the advanced reasoning picker as external Codex UI behavior and verify both release notes and tag ancestry when triaging future version-only releases. |

## rust-v0.143.0 / CLI 0.143.0

Source: upstream OpenAI Codex release `rust-v0.143.0`, Codex-port issue #1571.

| Change | Impact on oh-my-customcodex | Action |
| --- | --- | --- |
| Remote plugins are enabled by default with richer catalog/version metadata and npm marketplace sources; MCP tools use tool search by default and hosted MCP servers can request session authentication. | Runtime plugin, marketplace, and MCP discovery become more capable without changing the package's installed skill or connector schemas. | Use the active runtime inventory as ground truth; do not mirror catalogs or implement MCP tool search locally. |
| macOS and Windows system proxy routing covers authentication and Responses API traffic, including PAC/WPAD; `codex remote-control pair` can create manual pairing codes. | Proxy and pairing behavior belongs to Codex transport/authentication. | Keep package diagnostics metadata-only and never read or echo proxy credentials, tokens, or pairing secrets. |
| Amazon Bedrock adds GPT-5.6 Sol/Terra/Luna and `max` reasoning effort, while app-server clients can inspect environments, list descendant threads, and fork history through a selected turn. | These are external model and app-server surfaces. They do not authorize hardcoded model names or a package-owned thread API. | Continue resolving current model lanes from Codex/OMX and use app-server capabilities only when supplied by the runtime. |
| Windows ConPTY/sandbox handling, stale TUI safety prompts, cancelled-review MCP state, offline exec-server recovery, remote-control refresh, realtime shutdown, incremental WebSocket comparison, and installer release-metadata reuse are hardened. | The fixes improve runtime reliability around package workflows but require no template or source migration. | Record compatibility and keep local completion claims grounded in direct command/test evidence. |
| Bundled OpenSSL, Hono, fast-uri, quick-xml, and crossbeam-epoch receive security updates. | These are upstream Codex dependency fixes, not dependencies shipped by `oh-my-customcodex`. | Require operators to update Codex through its own distribution path; do not duplicate or claim these dependency patches locally. |

## oh-my-codex v0.19.0 / OMX baseline

Source: upstream oh-my-codex release `v0.19.0`, Codex-port issue #1565.

| Change | Impact on oh-my-customcodex | Action |
| --- | --- | --- |
| Planning-gate and handoff transport lock-down, conductor contract, typed subagent provenance/lane fences, Ralplan consensus/terminal-state handling, Madmax fixes, Ultragoal HUD, and Rust flake fix | These are upstream OMX runtime reliability and safety fixes for workflows this package delegates to rather than reimplementing locally. | Raise the packaged `MINIMUM_OMX_VERSION` to `0.19.0` so `init`, `update`, and `doctor` require the fixed runtime. |
| Release note states no intended breaking CLI/package/plugin-layout/config changes | No source migration, package dependency change, or template format change is required beyond the runtime baseline. | Record compatibility disposition and keep Codex/OMX runtime behavior external. |

## oh-my-codex v0.18.17 / OMX baseline

Source: upstream oh-my-codex release `v0.18.17`, Codex-port issue #1556.

| Change | Impact on oh-my-customcodex | Action |
| --- | --- | --- |
| Ultragoal null `get_goal` loop recovery, Ralplan/planning-gate state-write guards, and stop-keyword path false-positive fixes | These are upstream OMX runtime safety fixes for workflows this package delegates to rather than reimplementing locally. | Raise the packaged `MINIMUM_OMX_VERSION` to `0.18.17` so `init`, `update`, and `doctor` require the fixed runtime instead of copying runtime internals into this child package. |
| Team worker startup path fixes for MSYS, Windows psmux question rendering, exact-role worker CLI resolution, and tmux-session test hardening | Cross-platform Team/Question behavior belongs to the installed OMX runtime; local repo has no `src/team`, `src/question`, or `ultragoal` engine surface to patch. | Treat as runtime dependency compatibility; `omcustomcodex doctor` now flags older OMX installs as stale. |
| Auth slot isolation/invalid token rotation and notification fallback fixes | Operational reliability improvements in upstream runtime/auth layers. | Covered by the baseline bump; no package-owned credential or notification implementation copied. |
| Docs/dependency/model-table release churn | No direct package-owned behavior unless this repo mirrors that runtime metadata exactly. | Skip as source changes; keep this compatibility record as evidence. |

## rust-v0.141.0 / CLI 0.141.0

Source: upstream OpenAI Codex release `rust-v0.141.0`, Codex-port issue #1526.

| Change | Impact on oh-my-customcodex | Action |
| --- | --- | --- |
| Remote executors use authenticated end-to-end encrypted Noise relay channels | Strengthens Codex remote execution transport without changing package-owned templates or CLI behavior. | Record compatibility; no package dependency or config migration required. |
| Cross-platform remote execution preserves executor-native working directories, shells, and filesystem permission paths across app-server and exec-server boundaries | Reduces path/shell mismatch during Codex runtime sessions, especially remote or mixed-platform work. | Keep repo guidance path-explicit and verify local evidence; no source change. |
| Selected executor plugins can activate stdio MCP servers per thread; plugin discovery adds created-by-me marketplace and auth-specific curated catalogs | Improves runtime plugin/MCP availability and inventory vocabulary. | Continue treating connector schemas and selected plugins as runtime ground truth; no packaged skill migration. |
| App-server clients can list immediate child threads, correlate external-agent imports with detailed results, and read or redeem rate-limit reset credits | Adds observability for app-server and external-agent workflows. | Mention as external runtime capability; package workflows still require local artifact/evidence checks before completion claims. |
| Realtime clients can append speech explicitly, control how Codex responses enter conversations, and omit startup context | Realtime behavior improves outside this package's installed documentation/runtime surface. | No package action beyond this compatibility record. |
| TUI input prompts can auto-resolve after inactivity with a countdown that pauses on interaction | Aligns with non-blocking prompt behavior for Codex sessions. | Keep asking only for materially blocking input; no package workflow change. |
| Hook trust bypass persists through `codex exec` thread start/resume, and blocking `PostToolUse` hooks reject code-mode tool calls correctly | Hardens Codex hook boundaries relevant to repository safety guidance. | Preserve repo hook/safety guidance; no `omcustomcodex` source change required. |
| Plugin capabilities route by authentication mode, deduplicate conflicting App/MCP declarations, and preserve remote marketplace ordering | Reduces duplicate or misrouted tool exposure in plugin-heavy sessions. | Prefer runtime connector/tool metadata as the source of truth; no template change. |
| Windows sandbox execution repairs stale credentials and gives PowerShell commands more time before backgrounding | Improves Windows reliability for Codex runtime users. | No package migration; continue documenting shell-specific assumptions explicitly. |
| Idle exec-server relays stay connected and steered user input interrupts `wait_agent` immediately | Reduces false blockers in long-running or multi-agent Codex sessions. | No package action beyond compatibility tracking. |
| Bundled SQLite is pinned to a WAL-reset corruption fix; TLS supports P-521 certificate signatures used by enterprise proxies | Improves storage/network reliability under Codex itself. | No package dependency change; keep credential and enterprise-proxy diagnostics metadata-only. |
| Tool-search caching, request/history copy reduction, bounded prompt-image cache, bounded feedback upload subtrees, and always-on terminal resize reflow reduce latency, memory, and stale UI behavior | Runtime performance and UX improvements may make documentation/test sessions less fragile. | No source/runtime change in this package. |

## rust-v0.140.0 / CLI 0.140.0

Source: upstream OpenAI Codex release `rust-v0.140.0`, Codex-port issue #1522.

| Change | Impact on oh-my-customcodex | Action |
| --- | --- | --- |
| `/usage` adds daily, weekly, and cumulative account token activity views | Useful runtime cost signal, but not a packaged `omcustomcodex` telemetry contract. | Keep Codex usage evidence source-specific; continue using OMX/status/trace or local command evidence for package workflows. |
| Native `/goal` preserves oversized text, large pasted blocks, and image attachments, including remote app-server sessions | Reduces data loss in Codex-native goal tracking while this package keeps its namespaced `omcustomcodex:goal` workflow. | Do not shadow native `/goal`; keep long objective handoff text in artifacts when package workflows need durable release evidence. |
| `codex delete`, `/delete`, and app-server `thread/delete` can permanently delete sessions with safeguards and subagent cleanup | Destructive lifecycle operation outside this package's installed template surface. | Treat permanent thread deletion as an explicit user-authorized runtime action; do not automate it from package skills. |
| `/import` selectively imports setup, project configuration, and recent chats from Claude Code | Helpful migration path for operators moving Claude context into Codex. | Keep `omcustomcodex init/update` as the package-owned template path; mention import only as a Codex runtime migration helper, not as a replacement for template sync. |
| Typing `@` opens a unified mentions menu for files, plugins, and skills | Matches connector/plugin/skill routing vocabulary in current instructions. | No template change; continue to prefer exact file, plugin, and skill references when a task depends on them. |
| Managed Amazon Bedrock API-key auth and encrypted local storage for CLI/MCP OAuth credentials | Improves Codex credential handling but does not change this package's credential boundary. | Keep R001 metadata-only credential diagnostics; never read or echo stored credential values. |
| SQLite recovery, MCP startup/auth fixes, remote plugin uninstall fixes, update-dismissal persistence, stale hook cleanup, and interruptible non-TTY background commands | Runtime reliability improvements that reduce false blockers during package workflows. | No package dependency or config migration required beyond this compatibility record. |

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
