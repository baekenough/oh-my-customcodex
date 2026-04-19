---
name: token-efficiency-audit
description: Audit and tune Claude/Codex settings for lower token usage without changing code
scope: package
argument-hint: "[audit|apply-interactive|apply-ci|status]"
user-invocable: true
---

# Token Efficiency Audit

Audit and tune Claude Code / Codex configuration for better token efficiency.

This skill is for configuration-level optimization, not runtime behavior shaping. It complements:

- `guides/cc-token-saver/README.md` for plugin-level token protection
- R013 ecomode for runtime compression
- `omcodex:monitoring-setup` for telemetry and usage visibility

## Modes

### `audit` (default)

Inspect the current token-efficiency posture without changing files.

Check these sources when they exist:

- `.codex/settings.local.json`
- `.codex/settings.json`
- `~/.codex/config.toml`
- shell startup files such as `~/.zshrc`, `~/.bashrc`, `~/.bash_profile`

Audit for:

- Claude-side knobs
  - `includeGitInstructions`
  - `autoConnectIde`
  - output caps such as `BASH_MAX_OUTPUT_LENGTH`
  - file-read / MCP output token caps
- Codex-side knobs
  - `features.apps`
  - `web_search`
  - `tool_output_token_limit`
- worker-only flags that should not be silently enabled in normal interactive sessions

Report:

1. current settings found
2. low-risk improvements
3. high-risk / CI-only improvements
4. expected tradeoffs

### `status`

Summarize the current posture in a compact status report:

- configuration files found
- safe interactive settings present / missing
- CI-only settings present / missing
- main token-risk hotspots

### `apply-interactive`

Apply only low-risk settings suitable for human interactive sessions.

Preferred targets:

- `.codex/settings.local.json` for session-local settings
- user shell rc files only when environment variables are the right fit

Safe defaults to consider:

- disable unnecessary git instruction injection when not needed
- disable unnecessary IDE auto-connect when not needed
- set sane output ceilings to reduce runaway tool output without over-truncating
- reduce Codex tool output limits to a practical level
- disable unneeded app surfaces when they are not part of the user workflow

Guardrails:

- preserve existing user config
- never overwrite unrelated settings
- do not apply CI-only flags here
- explain tradeoffs before writing

### `apply-ci`

Apply stronger settings for non-interactive worker / CI contexts.

This mode is intentionally stricter and must call out risk clearly.

Examples of CI-only candidates:

- disable auto-memory features
- disable built-in agent surfaces not needed for batch execution
- disable nonessential MCP / app surfaces
- tighten output limits more aggressively than interactive mode

Required warning:

- these settings can reduce convenience or disable important harness behaviors
- they should be scoped to CI/worker environments, not broad local defaults

## Output Contract

### Audit / Status

```text
[Token Efficiency]

Mode: audit|status
Posture: good|mixed|wasteful

Safe interactive wins:
- ...

CI-only wins:
- ...

Watchouts:
- ...
```

### Apply Modes

```text
[Token Efficiency]

Mode: apply-interactive|apply-ci
Files updated:
- ...

Settings applied:
- ...

Tradeoffs:
- ...

Rollback:
- restore prior values from git diff / file backup
```

## Heuristics

- Prefer smaller, reversible config edits over broad environment mutation
- Keep interactive and CI profiles separate
- Do not set output limits so low that users trigger repeated re-runs and spend more tokens overall
- When uncertain, recommend `audit` first and `apply-*` second
