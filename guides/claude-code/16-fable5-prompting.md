# Claude Fable 5 Prompting Guide

> Source: upstream oh-my-customcode v1.1.4 / PR #1442, Codex-port issue #1562. This guide records the summarized compatibility impact for packaged Claude templates. It does not change Codex-native OMX model routing.

## Overview

Claude Fable 5 (`claude-fable-5`) is tracked here as a Claude compatibility model alias and prompting surface. In oh-my-customcodex, Fable guidance applies to packaged `.claude` templates and Claude compatibility sessions only; Codex-native subagents continue to use installed OMX roles, models, and `reasoning_effort` metadata.

Fable 5 differs from prior Opus/Sonnet-tuned harness assumptions because it is stronger at long-horizon autonomy and instruction following. That can improve long-running delegated lanes, but it also means overly procedural prompts can over-constrain the model.

## Behavior Differences to Account For

| Area | Fable 5 guidance | oh-my-customcodex mapping |
|------|------------------|---------------------------|
| Long-horizon autonomy | Permit longer turns when a lane is coherent and bounded. | Keep R009 parallelism for independent work; avoid arbitrary turn chopping inside one lane. |
| Effort strategy | High effort is the practical default; reserve `xhigh` for capability-sensitive architecture, reasoning, or verification. | R006 documents `fable` as Claude-template metadata only. |
| Concise instructions | Prefer goals, boundaries, and evidence requirements over repeating entire rulebooks. | Aligns with R023 shift-left: cheap structure first, not prompt bloat. |
| Ground-truth progress | Require actual artifacts, tests, registry/API checks, or diffs before accepting completion claims. | R020 already owns completion verification. |
| Boundary clarity | State allowed and forbidden actions explicitly for privileged or external work. | R010 pre-delegation privileged-scope boundary already owns this. |
| Parallel delegation | Independent lanes still benefit from parallel dispatch; a single Fable lane may also be reused across related steps. | R009 remains mandatory for independent tasks; long-lived reuse is a Fable-specific option, not a bypass. |
| File memory | Persistent file-backed context can help long tasks. | Use project memory and repo artifacts deliberately; do not pollute AGENTS/rules for one-off facts. |
| Context-budget phrasing | Avoid early stopping by naming the stop condition and required evidence. | R020/R013 cover completion and cost tradeoffs. |

## Core Warning: Over-Prescription Can Lower Quality

Fable 5 follows instructions strongly. If a Fable-targeted agent or skill is given a long sequence of procedural micro-rules, it may spend effort satisfying form over substance. For Fable-targeted compatibility prompts:

1. State the desired outcome and stop condition.
2. State safety/authority boundaries.
3. Name required evidence.
4. Let the model choose the smallest valid execution path.

Do not remove the repository's rule corpus for other models; instead, avoid pasting large rule excerpts into a Fable delegation prompt when a concise boundary plus references is enough.

## GA / Availability Notes

| Item | Value |
|------|-------|
| Claude compatibility model ID | `claude-fable-5` |
| Alias in this package | `fable` (Claude templates only) |
| Context | 1M token context included; omit redundant `[1m]` suffix |
| Effort | high by default; `xhigh` only for capability-sensitive tasks |
| Mythos 5 | `claude-mythos-5` is limited availability / not GA; no package alias yet |

## Cross-References

- R006 (`MUST-agent-design.md`) — model aliases, effort guidance, Fable/Mythos availability distinction.
- R009 (`MUST-parallel-execution.md`) — independent work still parallelizes; long-lived Fable lanes are optional within a bounded lane.
- R010 (`MUST-orchestrator-coordination.md`) — privileged boundary and new-file count-impact pre-check.
- R020 (`MUST-completion-verification.md`) — artifact/evidence-based completion.
- R023 (`SHOULD-verification-ladder.md`) — over-prescription advisory and deterministic guard design.
