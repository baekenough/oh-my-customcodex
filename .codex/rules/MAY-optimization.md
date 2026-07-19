# [MAY] Optimization Guide

> **Priority**: MAY | **ID**: R005

## Efficiency

> **Tool availability note**: On first exploration, do not assume a specific tool surface is available without confirming the current session's tool set. Prefer the available native repository inspection tools; fall back to bounded shell `find`/`grep`/`rg` when higher-level glob/search tools are unavailable.

| Strategy | When | Example |
|----------|------|---------|
| Parallel | 3+ independent I/O tasks | Read multiple files simultaneously |
| Caching | Same data accessed repeatedly | Cache file contents, reuse search results |
| Lazy Loading | Large datasets, partial use | Read only needed files, stream results |

### Capability-Aware Tool Scheduling

When dispatching parallel tool calls, consider per-tool capabilities to optimize scheduling:

| Capability | Parallelizable? | Example |
|-----------|----------------|---------|
| Read-only, no side effects | Yes | Read, Glob, Grep |
| Write with independent targets | Yes | Write(file-A) + Write(file-B) |
| Write with shared target | No | Sequential edits to same file |
| External with rate limits | Throttle | WebFetch, API calls |

This aligns with R009 (parallel execution) detection criteria and extends it with tool-level scheduling awareness.

Inspired by [ouroboros PR #353](https://github.com/Q00/ouroboros/pull/353) capability graph pattern.

<!-- DETAIL: Claude Code v2.1.208 Tool Reliability Compatibility
Claude Code v2.1.208 fixes settings and environment parsing for numbers written in scientific notation, along with Edit, Read, Grep, and Glob reliability defects. These are provider-owned fixes; retain capability-aware scheduling and validate the active Codex/OMX tool result rather than assuming cross-provider parity.
-->

<!-- DETAIL: Claude Code v2.1.210 Auto-Background and Grep Compatibility
Claude Code v2.1.210 distinguishes timeout-driven auto-background from an explicit background request and reports that `cd` inside an auto-backgrounded command does not change the session working directory. Use absolute paths for dependent follow-up commands after that Claude transition. The release also fixes Grep content mode returning `No matches found` when pagination has moved past the final result; on older Claude versions, treat that message as a possible page boundary rather than proof that the pattern is absent. These are provider-owned tool behaviors; keep verifying the active Codex/OMX result and do not copy Claude working-directory state into this runtime.
-->

<!-- DETAIL: Claude Code v2.1.212 MCP Auto-Background Compatibility
Claude Code v2.1.212 moves MCP tool calls that run longer than 2 minutes into the background by default; compatibility sessions may tune or disable that threshold with `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`. Treat a slow MCP call as provider-managed background work rather than a hang, while continuing to verify its terminal result. This provider-owned behavior does not change Codex/OMX tool scheduling, timeout, or completion semantics.
-->

### Display-pipe exit status

A **display pipe** such as `command | head`, `command | tail`, or `command | tee` is not proof that the producer succeeded: the shell commonly reports the final consumer's status. Keep dependent release and verification gates sequential, and inspect the producer directly.

When a display pipe is unavoidable, execute it under **explicit Bash** with `set -o pipefail` and capture `${PIPESTATUS[0]}` before running another command. Do not assume zsh and Bash expose the same pipeline-status variables. A zero status from `head`, `tail`, or `tee` never overrides a non-zero producer status.

## Token Optimization

- Include only necessary info, remove duplicates, use summaries
- Concise expressions, minimize code blocks, no unnecessary repetition

## Task Optimization

- **Batch**: Group similar tasks (edit 10 files at once)
- **Incremental**: Process only changed parts

## When to Optimize

| Do | Don't |
|----|-------|
| Repetitive tasks, clear bottleneck, measurable gain | One-time tasks, already fast, complexity > benefit |

Readability > Optimization. No optimization without measurement.


### Measure-Before-Adopt Gate

For new workflow heuristics, TIDE-style discovery shortcuts, or routing optimizations, measure before adoption. A small proof-of-concept that fails its confidence gate should be recorded as deferred rather than promoted into default guidance. Future adoption needs a broader multi-session corpus or deterministic benchmark evidence, not a single-session impression.

## Context Optimization via HTML Comments (v2.1.72+)

HTML comments in all auto-injected .md files (AGENTS.md and rules/*.md) are hidden from the model during auto-injection but visible via Read tool.

| Use Case | Example |
|----------|---------|
| Metadata tags | `<!-- agents: 44, skills: 74 -->` in AGENTS.md |
| Validation checksums | `<!-- validate-docs: hash=abc123 -->` in AGENTS.md |
| Conditional context | `<!-- detailed-architecture: see guides/architecture/ -->` in AGENTS.md |
| Rule detail hiding | `<!-- DETAIL: Self-Check ... -->` in rules/*.md |

**Rule**: Move model-unnecessary metadata into HTML comments to reduce context token usage. Keep actionable instructions as visible text.

<!-- DETAIL: Claude Code v2.1.206 Context Optimization Compatibility
Claude Code v2.1.206 makes `/doctor` flag checked-in `CLAUDE.md` content that can be derived or trimmed. This is a provider-owned diagnostic: use the finding as measurement input, but do not auto-rewrite project guidance or change Codex/OMX configuration without repository evidence.
-->
