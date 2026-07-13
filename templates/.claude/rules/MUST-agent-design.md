# [MUST] Agent Design Rules

> **Priority**: MUST | **ID**: R006

## Agent File Format

Location: `.codex/agents/{name}.md` (single file, kebab-case)

### Required Frontmatter

```yaml
name: agent-name           # Unique identifier (kebab-case)
description: Brief desc    # One-line summary
model_lane: frontier       # inherit | frontier | spark
model_reasoning_effort: medium  # none | minimal | low | medium | high | xhigh | ultra | max
tools: [Read, Write, ...]  # Allowed tools
```

### Codex/OMX Model Lanes

Use `inherit`, `frontier`, or `spark`; resolve concrete IDs from the active OMX
contract rather than hardcoding generated capability-table values.

<!-- DETAIL: Codex/OMX model lane resolution
| Lane | Resolution | Use Case |
|------|------------|----------|
| `inherit` | Omit generated TOML `model` | Follow the active Codex session |
| `frontier` | Active Codex model or `OMX_DEFAULT_FRONTIER_MODEL` | Implementation, architecture, verification |
| `spark` | `OMX_DEFAULT_SPARK_MODEL` or OMX low-complexity config | Search, triage, lightweight validation |
-->

### Claude Compatibility Source Aliases

Only `templates/.claude/agents/*.md` uses this upstream schema; the compiler
translates it at the provider boundary.

<!-- DETAIL: Claude compatibility source aliases
| Alias | Full ID | Use Case |
|-------|---------|----------|
| `haiku` | claude-haiku-4-5 | Fast, cheap tasks (search, simple edits) |
| `sonnet` | claude-sonnet-4-6 | General tasks, code generation (default) |
| `opus` | claude-opus-4-6 | Complex reasoning, architecture |
| `opusplan` | claude-opus-4-6 + plan mode | Architecture planning with approval gates |
| `opus47` | claude-opus-4-7 | Latest Opus model, supports xhigh effort |
| `fable` | claude-fable-5 | Claude compatibility only; high default effort; omit `[1m]` |
-->

<!-- DETAIL: Fable and Extended Context Aliases (Claude Code v2.1.170+)
`fable` resolves to `claude-fable-5` for Claude compatibility only: Mythos-class model, tier above Opus; do not change Codex/OMX routing defaults. Extended context suffix `[1m]` (for example, `claude-opus-4-6[1m]`) enables a 1M token context window. For Fable 5, do not append `[1m]`; Claude Code v2.1.173+ strips it because Fable includes 1M context by default.

Fable 5 effort strategy: Fable 5 defaults to high effort; reserve `xhigh` for capability-sensitive architecture, reasoning, or verification work. Its `low`/`medium` effort can exceed earlier-model high-effort quality, so avoid reflexive `xhigh` in Claude-template agents. Mythos 5 (`claude-mythos-5`) is Project Glasswing limited availability, not GA; do not add an alias until it is generally available. See `guides/claude-code/16-fable5-prompting.md` for Fable/Mythos prompting patterns and over-prescription risks.
-->

<!-- DETAIL: Fallback Models and Thinking Toggle (Claude Code v2.1.166+)

Claude Code v2.1.198+ makes the built-in Explore agent inherit the main session model (capped at Opus) instead of staying fixed to Haiku, and makes subagents plus compaction inherit the session's extended-thinking setting. This improves Claude-template delegation quality, but Codex-native subagents still follow the installed OMX role/model contract.

Claude Code v2.1.199+ shows stderr for SessionStart/Setup/SubagentStart hooks that exit 2, improving hard-block/advisory hook debugging. It also loads up to five leading stacked slash-skill calls (for example `/skill-a /skill-b do X`), reducing context loss in chained compatibility skills such as `omcustomcodex:fsd`; keep using explicit `$skill`/namespaced surfaces in Codex sessions.

Claude Code v2.1.201+ changes Claude Sonnet 5 harness-reminder delivery so rule reminders are no longer injected as mid-conversation `system` role messages. This is a Claude-template prompt-shape change only; PostCompact rule reinjection and Codex/OMX session continuity remain governed by this repository's normal hooks and state.

Claude compatibility settings can declare up to three `fallbackModel` entries tried in order when the primary Claude model is overloaded or unavailable. `--fallback-model` also applies to interactive Claude sessions. Treat this as platform availability failover, not Codex-native model routing or outcome-based escalation. Claude Code v2.1.166+ also supports disabling default thinking with `MAX_THINKING_TOKENS=0`, `--thinking disabled`, or the per-model thinking toggle. Claude Code v2.1.169+ adds `--safe-mode` / `CLAUDE_CODE_SAFE_MODE` to disable customizations for regression isolation, plus `disableBundledSkills` / `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` to hide bundled skills/workflows/slash commands when they conflict with project skills. Codex-native agents continue to use the OMX model contract and `reasoning_effort` routing. Claude Code v2.1.172+ applies `availableModels` restrictions to subagent `model:` overrides, the agent dispatch model picker, and the advisor model; compatibility allowlists should account for version-specific IDs and 1M suffix handling. Claude Code v2.1.173+ auto-normalizes Fable 5 IDs with redundant `[1m]` suffixes. Claude Code v2.1.175+ adds `enforceAvailableModels`, which constrains the resolved Default model as well as subagent overrides and prevents user/project settings from widening a managed allowlist.
-->

### Optional Frontmatter

Key native optional fields: `memory`, `model_reasoning_effort`, `skills`, `soul`,
`isolation`, `background`, `maxTurns`, `maxTokens`, `mcpServers`, `hooks`,
`permissionMode`, `disallowedTools`, `limitations`, `domain`, and
`disableSkillShellExecution`. Compatibility templates may use `effort`; the compiler
normalizes it to `model_reasoning_effort`.

<!-- DETAIL: Optional Frontmatter (full yaml block)
```yaml
memory: project            # user | project | local
effort: high               # low | medium | high | xhigh | default | max
skills: [skill-1, ...]     # Skill name references
source:                    # For external agents
  type: external
  origin: github | npm
  url: https://...
  version: 1.0.0
escalation:              # Reasoning escalation policy (optional)
  enabled: true          # Enable auto-escalation advisory
  model_reasoning_effort_path: medium → high → xhigh
  threshold: 2           # Failures before advisory
soul: true                 # Enable SOUL.md identity injection
isolation: worktree | sandbox  # worktree = git worktree, sandbox = restricted bash
sandboxFailIfUnavailable: true  # Exit if sandbox unavailable (v2.1.83+)
background: true           # Run in background
maxTurns: 10               # Max conversation turns
maxTokens: 100000          # Per-turn token ceiling
mcpServers: [server-1]     # MCP servers available
hooks:                     # Agent-specific hooks
  PreToolUse:
    - matcher: "Edit"
      if: "Edit(*.md)"      # Conditional filter (permission rule syntax, v2.1.85+)
      command: "echo hook"
permissionMode: bypassPermissions  # Permission mode
disallowedTools: [Bash]    # Tools to disallow
limitations:               # Negative capability declarations
  - "cannot execute tests"
  - "cannot modify code"
domain: backend              # backend | frontend | data-engineering | devops | universal
disableSkillShellExecution: true  # Disable inline shell execution in skills (v2.1.91+)
```

> **Note**: When `disableSkillShellExecution` is enabled (v2.1.91+), skills that rely on inline shell execution (e.g., `codex-exec`, `gemini-exec`, `rtk-exec`) will have their shell blocks disabled. This is a security hardening option.
-->

<!-- DETAIL: CC Version Compatibility History
`isolation`, `background`, `maxTurns`, `maxTokens`, `mcpServers`, `hooks`, `permissionMode`, `disallowedTools`, `limitations` are supported in Claude Code v2.1.63+. Hook types `PostCompact`, `Elicitation`, `ElicitationResult` require v2.1.76+. `CwdChanged`, `FileChanged` hook events and `managed-settings.d/` drop-in directory require v2.1.83+. Conditional `if` field for hooks requires v2.1.85+. `PermissionDenied` hook event requires v2.1.88+. `refreshInterval` setting for status line auto-refresh interval added in v2.1.97+. Monitor tool and subprocess sandboxing (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, `CLAUDE_CODE_SCRIPT_CAPS`) added in v2.1.98+. Settings resilience (unrecognized hook event names no longer cause settings.json to be ignored) improved in v2.1.101+. PreCompact hook block support (exit 2 / `{"decision":"block"}`) added in v2.1.105+. Skill description listing cap raised from 250 to 1,536 characters in v2.1.105+. Plugin `monitors` manifest key for background monitors added in v2.1.105+. `ENABLE_PROMPT_CACHING_1H` and `FORCE_PROMPT_CACHING_5M` env vars for prompt cache TTL control added in v2.1.108+. Skill tool can now discover and invoke built-in slash commands (`/init`, `/review`, `/security-review`) in v2.1.108+. `/recap` session context feature and `/undo` alias for `/rewind` added in v2.1.108+. `/tui` command and `tui` setting for fullscreen rendering added in v2.1.110+. PushNotification tool for mobile push notifications (Remote Control + config required) added in v2.1.110+. `autoScrollEnabled` config for fullscreen mode added in v2.1.110+. SDK/headless `TRACEPARENT`/`TRACESTATE` distributed trace linking added in v2.1.110+. Bash tool maximum timeout enforcement added in v2.1.110+. Write tool IDE diff feedback (informs model when user edits proposed content) added in v2.1.110+. `--resume`/`--continue` now resurrects unexpired scheduled tasks in v2.1.110+. `/focus` command (separated from Ctrl+O) added in v2.1.110+. `xhigh` effort level for Opus 4.7 (between `high` and `max`; other models fall back to `high`) added in v2.1.111+. `/effort` interactive slider with arrow-key navigation (when called without arguments) added in v2.1.111+. Auto mode no longer requires `--enable-auto-mode` in v2.1.111+. PowerShell tool progressive rollout (`CLAUDE_CODE_USE_POWERSHELL_TOOL` env var) added in v2.1.111+. Read-only bash commands with glob patterns (`ls *.ts`) and `cd <project-dir> &&` prefix no longer trigger permission prompt in v2.1.111+. `/less-permission-prompts` built-in skill for permission allowlist scanning added in v2.1.111+. `/ultrareview` parallel multi-agent cloud code review added in v2.1.111+. `/skills` menu sorting by estimated token count (press `t`) added in v2.1.111+. `OTEL_LOG_RAW_API_BODIES` env var for full API request/response body logging added in v2.1.111+. Plan files named after prompt content (not random words) in v2.1.111+. Plugin error handling improvements (dependency conflict errors, stale version recovery, install recovery) in v2.1.111+.
`sandbox.network.deniedDomains` setting for domain blocking within `allowedDomains` wildcards added in v2.1.113+. Subagent mid-stream stall detection with auto-fail after 10 minutes added in v2.1.113+. Bash `find -exec`/`-delete` no longer auto-approved under `Bash(find:*)` allow rules in v2.1.113+. Bash deny rules now match exec wrappers (`env`/`sudo`/`watch`/`ionice`/`setsid`) in v2.1.113+. Native binary spawning (per-platform optional dependency) replaces bundled JavaScript in v2.1.113+. `/loop` Esc now cancels pending wakeups in v2.1.113+.
Agent frontmatter `hooks:` fire when the agent runs as a main-thread agent via `--agent` flag in v2.1.116+. Hook JSON output `terminalSequence` field for desktop notifications, window title changes, and terminal bells without controlling terminal added in v2.1.141+. `claude agents --cwd <path>` for directory-scoped session lists added in v2.1.141+. Background agents launched via `/bg` preserve current permission mode in v2.1.141+. `CLAUDE_CODE_PLUGIN_PREFER_HTTPS` and `ANTHROPIC_WORKSPACE_ID` environment variables added in v2.1.141+ for HTTPS plugin clones and workspace-scoped federation.
-->

<!-- DETAIL: Claude Compatibility Notes for Packaged `.claude` Templates
This Codex port ships `.claude` compatibility templates. When updating those templates, account for recent Claude Code behavior even though the active runtime surface is Codex/OMX:

- v2.1.159: no user-facing template action required (internal infrastructure release).
- v2.1.160: `acceptEdits` prompts for build-tool config writes; grep/egrep/fgrep of a single file can satisfy read-before-edit in Claude Code, but Codex agents should still follow the active Codex read/edit policy.
- v2.1.161: independent parallel tool calls no longer cancel siblings when one Bash call fails; this supports R009 same-message batching for independent work.
- v2.1.162: `claude agents --json` includes waiting/blocker metadata and explicit `--tools Grep/Glob` behavior is fixed; compatibility prompts may use those fields when diagnosing stuck Claude sessions.
- v2.1.163: managed `requiredMinimumVersion`/`requiredMaximumVersion`, `/plugin list`, Stop/SubagentStop `hookSpecificOutput.additionalContext`, and skill command literal `\$` escaping are available. Hook/skill template changes should preserve these affordances.
- v2.1.165: bug-fix/reliability release; no local template change required beyond compatibility confirmation. v2.1.166: fallbackModel availability failover and thinking-disable controls are Claude compatibility settings, not Codex/OMX routing. v2.1.167/v2.1.168: bug-fix-only compatibility confirmation.
- v2.1.169: `--safe-mode` / `CLAUDE_CODE_SAFE_MODE` disables all customizations for Claude regression isolation; `disableBundledSkills` / `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` hides bundled skills/workflows/slash commands from the model. Keep distinct from advisory `skills:` frontmatter metadata.
- v2.1.170: Claude compatibility sessions gain access to the `fable` alias (`claude-fable-5`) and fix a VS Code integrated-terminal transcript persistence bug. Skills that rely on transcript replay (for example `homework`) should prefer v2.1.170+ in Claude-template sessions. No Codex runtime model-routing change.
- v2.1.173: Fable 5 model IDs carrying `[1m]` are auto-normalized because Fable includes 1M context by default; omit the suffix in packaged Claude compatibility metadata.
- v2.1.175: managed `enforceAvailableModels` constrains the Default model in addition to subagent model overrides, dispatch picker, and advisor model; document this as Claude enterprise config behavior, not Codex model routing.
-->

## Hook Event Types

27 event types documented: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure, Notification, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, Stop, StopFailure, TeammateIdle, InstructionsLoaded, ConfigChange, CwdChanged, FileChanged, WorktreeCreate, WorktreeRemove, PreCompact, PostCompact, Elicitation, ElicitationResult, PostMessage, SessionEnd. 4 handler types: command, prompt, http, agent. See full reference table via Read tool.

<!-- DETAIL: Hook Event Types Full Reference

| Event | Trigger | Data Available | Handler Types | CC Version |
|-------|---------|---------------|---------------|------------|
| `PreToolUse` | Before tool execution | tool, tool_input | command, prompt | v2.1.63+ |
| `PermissionRequest` | Permission dialog shown | tool_name, tool_input, permission_context | command, prompt | v2.1.113+ |
| `PermissionDenied` | Auto-mode classifier denies tool use | tool, tool_input, denial_reason | command, prompt | v2.1.88+ |
| `PostToolUse` | After tool execution | tool, tool_input, tool_output | command, prompt | v2.1.63+ |
| `PostToolUseFailure` | After tool execution fails | tool, tool_input, error | command, prompt | v2.1.113+ |
| `PreCompact` | Before context compaction | — | command, prompt | v2.1.76+ |
| `PostCompact` | After context compaction | — | command, prompt | v2.1.76+ |
| `Stop` | Session ending | — | command, prompt | v2.1.63+ |
| `StopFailure` | Turn ends with API error | error, error_details | command, prompt | v2.1.113+ |
| `SessionStart` | Session begins | — | command | v2.1.63+ |
| `SessionEnd` | Session fully closes | — | command | v2.1.76+ |
| `SubagentStart` | Subagent spawned | agent_type, model, description | command | v2.1.63+ |
| `SubagentStop` | Subagent completed | agent_type, model, result | command, prompt | v2.1.63+ |
| `UserPromptSubmit` | User submits prompt | user_input | command, prompt | v2.1.76+ |
| `Notification` | Long-running op completes | message | command | v2.1.76+ |
| `InstructionsLoaded` | AGENTS/CLAUDE/rules file loaded | path, source | command | v2.1.113+ |
| `ConfigChange` | Config file changed during session | path, scope | command | v2.1.113+ |
| `CwdChanged` | Working directory changes | old_cwd, new_cwd | command | v2.1.83+ |
| `FileChanged` | External file modification | file_path, change_type | command | v2.1.83+ |
| `WorktreeCreate` | Worktree is being created | worktree_path | command | v2.1.113+ |
| `WorktreeRemove` | Worktree is being removed | worktree_path | command | v2.1.113+ |
| `Elicitation` | Agent requests user input | question | command, prompt | v2.1.76+ |
| `ElicitationResult` | User responds to elicitation | answer | command, prompt | v2.1.76+ |
| `PostMessage` | After message sent | message_type | command | v2.1.76+ |
| `TeammateIdle` | Agent Teams member idle | teammate_id | command | v2.1.83+ |
| `TaskCreated` | Task created | task_id, description | command | v2.1.83+ |
| `TaskCompleted` | Task completed | task_id, result | command | v2.1.83+ |

### Hook Handler Types

| Type | Behavior | Use Case |
|------|----------|----------|
| `command` | Execute shell command, stdin receives JSON context | Scripts, validation, logging |
| `prompt` | Inject text into model context | Rule reinforcement, advisory guidance |
| `http` | POST to HTTP endpoint | External integrations, webhooks |
| `agent` | Spawn agent to handle event | Complex event-driven workflows |

### PreToolUse Hook Return Values

| Return | Behavior | CC Version |
|--------|----------|------------|
| `exit 0` | Allow tool execution | All |
| `exit 1` | Block silently | All |
| `exit 2` + stderr | Block with message | All |
| `{"decision": "defer"}` | Pause execution; resume with `-p --resume` | v2.1.89+ |

The `defer` decision allows headless sessions to pause at a tool call for human review.

### PreCompact Hook Return Values

| Return | Behavior | CC Version |
|--------|----------|------------|
| `exit 0` | Allow compaction | All |
| `exit 2` + stderr | Block compaction with message | v2.1.105+ |
| `{"decision": "block"}` | Block compaction (JSON response) | v2.1.105+ |

PreCompact hooks can now prevent context compaction, useful for preserving critical context during multi-step workflows.

### Hook Matcher Syntax

```yaml
hooks:
  PreToolUse:
    - matcher: "tool == \"Edit\""       # Match specific tool
      if: "Edit(*.md)"                  # Conditional filter (v2.1.85+)
      command: "echo hook"
    - matcher: "*"                       # Match all
      command: "echo hook"
```

> **v2.1.85+**: `if` field supports permission rule syntax for conditional hook execution. **v2.1.88** extended `if` matching to support compound commands (`ls && git push`) and commands with env-var prefixes (`FOO=bar git push`).
-->

## Permission Mode Guidance

CC defaults `mode` to `acceptEdits` if not specified — always pass `mode: "bypassPermissions"` explicitly in Agent tool calls when the session uses bypass permissions. See guidance details via Read tool.

| Mode | Behavior |
|------|----------|
| `default` | CC decides per-tool prompting |
| `acceptEdits` | Auto-accept file edits, prompt for others |
| `bypassPermissions` | Skip all permission prompts |
| `plan` | Require plan approval |
| `dontAsk` | Non-interactive, deny unapproved |
| `auto` | AI decides safety |

<!-- DETAIL: Permission Mode Guidance (reasoning)
When spawning agents via the Agent tool, CC applies a default `mode` of `acceptEdits` if not explicitly specified. To maintain consistent permission behavior:

1. **Agent frontmatter `permissionMode`**: Declares the agent's intended permission level. CC respects this when the agent is spawned via Agent tool.
2. **Agent tool `mode` parameter**: Overrides frontmatter at spawn time. Routing skills should pass this explicitly.
3. **Recommendation**: For agents that modify files, set `permissionMode: bypassPermissions` in frontmatter if the project uses `bypassPermissions` mode.

Claude Code v2.1.200+ displays `default` permission mode as `Manual` in CLI help and IDE surfaces, and accepts `--permission-mode manual` / `"defaultMode": "manual"` alongside `default` with the same behavior. This is a Claude compatibility label change only; Codex/OMX approval policy and sandbox state remain controlled by the current Codex runtime.
-->

<!-- DETAIL: Isolation/Token/Limitations/Escalation details
### Isolation Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `worktree` | Isolated git worktree copy | Code changes that need rollback safety |
| `sandbox` | Restricted Bash environment | Agents running untrusted or scan commands |

When `isolation: sandbox` is set, the agent's Bash calls run with restricted permissions. This is advisory metadata — enforcement depends on the execution environment.

### Token Ceiling

When `maxTokens` is set, it serves as advisory metadata for the orchestrator to manage agent turn budgets. The orchestrator should track output and consider escalation or task splitting when an agent approaches its ceiling.

### Negative Capabilities (Limitations)

The `limitations` field declares what an agent explicitly CANNOT or SHOULD NOT do. This enables:
1. **Clearer routing**: Orchestrator knows agent boundaries
2. **Safer delegation**: Prevents accidental capability overreach
3. **Better documentation**: Makes agent scope explicit

### Escalation Policy

When `escalation.enabled: true`, the model-escalation hooks will track outcomes for this agent type and advise escalation when failures exceed the threshold. This is advisory-only — the orchestrator decides whether to accept the recommendation.

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | false | Enable escalation tracking for this agent |
| `model_reasoning_effort_path` | medium → high → xhigh | Reasoning-effort upgrade sequence |
| `threshold` | 2 | Failure count before escalation advisory |
-->

## Memory Scopes

| Scope | Location | Git Tracked |
|-------|----------|-------------|
| `user` | `~/.codex/agent-memory/<name>/` | No |
| `project` | `.codex/agent-memory/<name>/` | Yes |
| `local` | `.codex/agent-memory-local/<name>/` | No |

When enabled: first 200 lines of MEMORY.md loaded into system prompt.

## Soul Identity

Optional per-agent identity layer. `soul: true` in frontmatter enables personality/style via `.codex/agents/souls/{name}.soul.md`. Behavioral memory (R011) overrides soul defaults.

<!-- DETAIL: Soul Identity full spec
| Aspect | Location | Purpose |
|--------|----------|---------|
| Capabilities | `.codex/agents/{name}.md` | WHAT the agent does |
| Identity | `.codex/agents/souls/{name}.soul.md` | HOW the agent communicates |

### Soul File Format: agent: {name}, version: 1.0.0 — Sections: Personality, Style, Anti-patterns
### Activation: frontmatter soul:true → routing skill reads souls/{name}.soul.md at spawn (Step 5) → prepend to prompt → missing file = graceful fallback
-->

## Artifact Output Convention

Skills persist output to `.codex/outputs/sessions/{YYYY-MM-DD}/{skill-name}-{HHmmss}.md`. Opt-in, git-untracked. Final subagent writes (R010).

<!-- DETAIL: Artifact Output full spec
**Format**: Metadata header with `skill`, `date`, `query` fields, followed by skill output content.
**Rules**: Opt-in per skill, final subagent writes with a file-write API that creates missing parent directories (R010 compliance), do not pre-create session output directories with Bash, .codex/outputs/ is git-untracked, no indexing required.
-->

## Sensitive Path Handling

Claude Code still treats `.claude/` and `templates/.claude/` as protected compatibility surfaces, but the current behavior is version-sensitive rather than a universal prompt wall.

This Codex port uses `.codex/` as the active runtime surface. `.codex/**` edits should use the normal Codex edit/patch flow with no Claude-only `/tmp` wrapper.

**Current compatibility rule**:

- **CC v2.1.121+**: `bypassPermissions` no longer prompts for direct writes to `.claude/skills/`, `.claude/agents/`, and `.claude/commands/`.
- **CC v2.1.126+**: `bypassPermissions` also bypasses prompts for broader protected paths such as `.claude/**`, `.git/**`, `.vscode/**`, and shell config files.
- **Historical fallback only**: if the target runtime is older than v2.1.121, not running with `bypassPermissions`, or still surfaces a protected-path prompt, use `/tmp/{skill}-{timestamp}.md` only as a compatibility fallback for the final `.claude/**` or `templates/.claude/**` write.

<!-- DETAIL: Sensitive Path Behavior table and Recommended practice
| Path pattern | Guidance |
|--------------|----------|
| `.claude/skills/**`, `.claude/agents/**`, `.claude/commands/**` | Direct writes are acceptable in Claude Code `bypassPermissions` on v2.1.121+ |
| `.claude/**`, `.git/**`, `.vscode/**`, shell config files | Direct writes are acceptable in Claude Code `bypassPermissions` on v2.1.126+ |
| `templates/.claude/**` | Mirror deliberately; use the historical `/tmp` fallback only when the runtime still prompts |
| `.codex/**` | Normal Codex runtime writes; still follow R010/R017 |
| `.codex/outputs/**` and `.claude/outputs/**` | Treat as constrained artifact paths; use file-write APIs that create parents and do not pre-create with Bash |

Recommended practice:

1. Prefer direct Write/Edit for `.codex/**` and for compatible `.claude/**` targets when the runtime version and permission mode allow it.
2. Keep allow rules only as defensive documentation; current behavior depends on Claude Code version and permission mode, not allow-rule wishful thinking.
3. In this Codex port, update `.codex/...` source files and their `templates/.claude/...` mirrors deliberately instead of bulk-copying with shell commands.
4. Use the historical `/tmp` artifact-body fallback only for legacy Claude Code versions or sessions that still prompt on protected paths.
5. When compatibility-template writes still require a fallback, verify the resulting diff and remove stale wrapper boilerplate from repeated prompts.
-->

Delegation prompt requirement:

Delegated prompts touching `.claude/**`, `templates/.claude/**`, `.claude/outputs/**`, or read-only measurement of those paths MUST include this block:

> Sensitive-path compatibility note: Codex-managed `.codex/**` edits use the normal edit/patch flow. On Claude Code v2.1.121+ with `bypassPermissions`, direct writes to `.claude/skills/`, `.claude/agents/`, and `.claude/commands/` are allowed; on v2.1.126+ that also extends to broader protected paths such as `.claude/**`, `.git/**`, and `.vscode/**`. Only fall back to `/tmp/{skill}-{timestamp}.md` when the target runtime is older than v2.1.121, not running with `bypassPermissions`, or still surfaces a protected-path prompt.

## Separation of Concerns

| Location | Purpose | Contains |
|----------|---------|----------|
| `.codex/agents/` | WHAT the agent does | Role, capabilities, workflow |
| `.codex/skills/` | HOW to do tasks | Instructions, scripts, rules |
| `guides/` | Reference docs | Best practices, tutorials |

Agent body: purpose, capabilities overview, workflow. NOT detailed instructions or reference docs.

## Fast Mode

Fast Mode uses the same model with faster output. Activated via `/fast` toggle or `fastMode` setting. Does NOT switch to a different model.

| Aspect | Normal | Fast Mode |
|--------|--------|-----------|
| Model | As configured | Same model |
| Output speed | Standard | ~2.5x faster |
| Reasoning depth | Full | Reduced |

See activation, effort interaction, and default effort change details via Read tool.

<!-- DETAIL: Fast Mode Activation, Effort Interaction, Default Effort Change
### Activation

- `/fast` — toggle in current session
- `fastMode: true` in settings.json
- `CLAUDE_CODE_DISABLE_FAST_MODE=1` — env var to disable

### Interaction with Effort

When Fast Mode is active, it reduces effective reasoning depth but does NOT override the `effort` frontmatter field. The effort field controls task complexity allocation; Fast Mode controls output generation speed.

### Default Effort Change (CC v2.1.94+)

Starting with Claude Code v2.1.94, the default effort level changed from `medium` to `high` for API-key, Bedrock/Vertex/Foundry, Team, and Enterprise users. Console (free-tier) users retain `medium` as the default.

This means agents WITHOUT an explicit `effort` field now run at `high` effort by default on paid tiers. To maintain previous behavior, set `effort: medium` explicitly in agent frontmatter.
-->

## Skill Frontmatter

Location: `.codex/skills/{name}/SKILL.md`

### Required Fields

```yaml
name: skill-name           # Unique identifier (kebab-case)
description: Brief desc    # One-line summary
```

### Optional Fields

Key optional fields: `scope`, `context`, `version`, `effort`, `model`, `agent`, `hooks`, `paths`, `shell`, `allowed-tools`, `keep-coding-instructions`. Skill `effort` takes precedence over agent `effort` when both specified. See full optional fields via Read tool.

<!-- DETAIL: Skill Optional Fields (full yaml block)
```yaml
scope: core                # core | harness | package (default: core)
context: fork              # Forked context for isolated execution
version: 1.0.0             # Semantic version
user-invocable: false      # Whether user can invoke directly
disable-model-invocation: true  # Prevent model from auto-invoking
effort: medium              # low | medium | high | default | max — overrides model effort level when invoked
argument-hint: "<arg> [--flag]"  # CLI-style usage hint displayed in /help and command listings
model_lane: frontier               # Resolve through the active OMX model contract
model_reasoning_effort: medium     # Override invocation reasoning effort
agent: mgr-creator                 # Preferred agent to execute this skill
hooks:                             # Skill-specific hooks (same syntax as agent hooks)
  PreToolUse:
    - matcher: "Bash"
      command: "echo hook"
paths: ["src/**/*.ts"]             # Conditional loading — skill auto-injected when matching files are open
shell: "bash"                      # Shell for embedded script execution
allowed-tools: [Read, Write, Bash] # Restrict tools available during skill execution
keep-coding-instructions: true     # Preserve coding instructions in plugin output styles (v2.1.94+)
```

When both an agent and its invoked skill specify `effort`, the skill's value takes precedence (more specific invocation-time setting).
-->

<!-- DETAIL: Skill Effectiveness Tracking
Skills can optionally track effectiveness metrics via auto-populated fields:
  effectiveness.invocations, effectiveness.success_rate (0.0-1.0), effectiveness.last_invoked (ISO-8601)
Read-only from skill perspective — sys-memory-keeper updates at session end via task-outcome-recorder data.
-->

## Skill Scope

| Scope | Purpose | Deployed via init? |
|-------|---------|-------------------|
| `core` | Universal development tools | Yes |
| `harness` | Agent/skill/rule maintenance | Yes |
| `package` | Package-specific (npm publish, etc.) | No |

Default: `core` (when field is omitted)

### Context Fork Criteria

Use `context: fork` for multi-agent orchestration skills only. Cap: **12 total**. Current: 10/12 (secretary-routing, dev-lead-routing, de-lead-routing, qa-lead-routing, dag-orchestration, task-decomposition, worker-reviewer-pipeline, pipeline-guards, deep-plan, professor-triage).

<!-- DETAIL: Context Fork decision table
| Use context:fork | Do NOT use context:fork |
| Routing skills, Workflow orchestration (DAG), Multi-agent coordination, Task decomposition | Best-practices skills, Hook/command skills, Single-agent reference, External tool integrations |
-->

## Naming

| Type | Pattern | Example |
|------|---------|---------|
| Agent file | `kebab-case.md` | `fe-vercel-agent.md` |
| Skill dir | `kebab-case/` | `react-best-practices/` |
| Skill file | UPPERCASE | `SKILL.md` |
