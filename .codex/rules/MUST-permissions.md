# [MUST] Permission Rules

> **Priority**: MUST | **ID**: R002

## Tool Permission Tiers

| Tier | Tools | Policy |
|------|-------|--------|
| 1: Always | Read, Glob, Grep, ToolSearch | Free use, read-only |
| 2: Default | Write, Edit, NotebookEdit | State changes explicitly, notify before modifying important files |
| 3: Context | Agent, Skill, EnterPlanMode, ExitPlanMode, EnterWorktree, ExitWorktree, LSP, Monitor, TodoWrite, AskUserQuestion, PushNotification | Context-dependent, no user approval needed |
| 4: Approval | Bash, PowerShell, WebFetch, WebSearch | Request user approval on first use |
| 5: Conditional | TeamCreate, TeamDelete, SendMessage, TaskCreate, TaskGet, TaskList, TaskUpdate, TaskStop, TaskOutput | Available when Agent Teams enabled |
| 6: MCP | ListMcpResourcesTool, ReadMcpResourceTool, CronCreate, CronDelete, CronList, RemoteTrigger | MCP/extension tools, available when servers configured |

## Privileged Scope Boundaries

- Approval for one privileged action does not authorize follow-on privileged chaining. A request to remove one tunnel, secret, pod, namespace object, or credential does not authorize creating a replacement, rotating credentials, deleting adjacent resources, or executing inside production workloads.
- Treat credential-store reads as sensitive even when the tool is otherwise available. Never paste raw secret values or full credential-store transcripts into chat; use redacted names, fingerprints, or boolean verification results.
- Reconfirm scope before irreversible shared infrastructure or credential actions, including production pod exec/write, Kubernetes secret mutation, public tunnel creation, credential rotation, and shared namespace deletion.

## File Access

| Operation | Allowed | Prohibited |
|-----------|---------|-----------|
| Read | All source, configs, docs | - |
| Write | Source code, new files in project | .env, .git/config, paths outside project |
| Delete | Temp files created by agent | Existing files (without request), entire directories |

## Claude Code Protected-Path Compatibility

Codex-native `.codex/**` edits are normal project writes and do not require the historical Claude-only `/tmp` bypass pattern.

Claude Code compatibility behavior changed in two steps:

- **CC v2.1.121+**: `--dangerously-skip-permissions` / `bypassPermissions` no longer prompts for writes to `.claude/skills/`, `.claude/agents/`, and `.claude/commands/`.
- **CC v2.1.126+**: the same mode also bypasses prompts for broader protected paths such as `.claude/**`, `.git/**`, `.vscode/**`, and shell config files.

Current guidance:

- Prefer direct Write/Edit/Bash targets for `.codex/**`.
- For `.claude/**` or `templates/.claude/**`, direct writes are acceptable when the target Claude Code runtime is new enough and the session is running with `bypassPermissions`.
- Treat the old `/tmp/{skill}-{timestamp}.md` wrapper flow as a historical fallback only for older Claude Code versions, non-bypass sessions, or interactive runs that still surface a protected-path prompt.


## Deny Rule Glob Patterns (Claude Code v2.1.166+)

Claude Code compatibility templates may rely on v2.1.166+ deny-rule glob behavior:

| Position | Glob support |
|----------|-------------|
| Deny rule tool-name | Supported; `"*"` denies all tools |
| Allow rule tool-name | MCP tool-name globs only; non-MCP globs are rejected |
| Unknown tool in deny rule | Startup warning |

Use `"*"` deny rules only for Claude compatibility settings that intentionally enforce deny-by-default, then add explicit allow rules. This is separate from Codex/OMX sandbox policy and the advisory tool-tier table above.

## Claude Permission Mode Manual Label and AskUserQuestion (v2.1.200+)

Claude Code v2.1.200+ displays the existing `default` permission mode as `Manual` across CLI help and IDE surfaces. `--permission-mode manual` and `"defaultMode": "manual"` are accepted alongside `default` with identical behavior. Document both names in Claude compatibility guidance, but do not translate the UI label into Codex sandbox policy.

The same Claude release changed `AskUserQuestion` so dialogs no longer auto-continue by default; idle-timeout continuation is now explicit `/config` opt-in. Autonomous flows such as `omcustomcodex:fsd` should avoid question tools unless truly blocked and should proceed on best judgment for low-risk reversible work. Non-array `disabledMcpServers` / `enabledMcpServers` values in `.claude.json` no longer crash Claude startup.

<!-- DETAIL: Claude Code v2.1.203-v2.1.208 Permission Compatibility
Claude Code v2.1.203 adds a grey pause badge in the footer when Manual permission mode is active. Claude Code v2.1.207 removes the Auto mode opt-in requirement for Bedrock, Vertex, and Foundry, adds the managed `disableAutoMode` setting, and fixes consent handling for noninteractive remote managed settings. Claude Code v2.1.208 improves permission matcher compilation and caching. These provider-owned changes do not alter the Codex/OMX sandbox or approval policy.
-->

<!-- DETAIL: Claude Code v2.1.210 Permission Matcher Compatibility
Claude Code v2.1.210 warns at startup when permission rules use unsupported path-scoped `Write(path)`, `NotebookEdit(path)`, or `Glob(path)` matchers. In Claude compatibility settings, express file-write scopes with `Edit(path)` and read/glob scopes with `Read(path)` instead. The tool-tier table above lists available tool names; it does not redefine Claude's matcher grammar. This provider-owned validation change does not alter the Codex/OMX sandbox or approval policy.
-->

## Permission Request Format

```
[Permission Request]
Action: {action} | Required: {tool} | Reason: {why} | Risk: Low/Medium/High
Approve?
```

On insufficient permission: do not attempt, notify user, suggest alternative.
