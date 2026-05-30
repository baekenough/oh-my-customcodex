# [MUST] Agent Teams Rules (Conditional)

> **Priority**: MUST | **ID**: R018
> **Condition**: Agent Teams enabled (`OMCODEX_AGENT_TEAMS=1`)
> **Fallback**: When disabled, R009/R010 apply

## Detection

Available when `OMCODEX_AGENT_TEAMS=1` or `TeamCreate` / `SendMessage` exists.

## Decision Matrix

| Scenario | Preferred | Reason |
|----------|-----------|--------|
| Simple independent subtasks | Agent Tool | Lower cost, no coordination overhead |
| Mechanical disjoint-file refactors/deletions | Agent Tool | Explicit write scopes can avoid Team runtime overhead/stalls |
| Sequential-dependency init/scaffolding | Agent Tool | Avoid blocked agents polling |
| Multi-step with shared state | **Agent Teams** | Shared task list, peer messaging |
| Research requiring discussion | **Agent Teams** | Iterative discovery and synthesis |
| Complex debugging across modules | **Agent Teams** | Cross-module state sharing |
| Code review + fix cycle | **Agent Teams** | Review → fix → re-review loop |
| Dynamic agent creation + usage | **Agent Teams** | Create → test → iterate cycle |
| Multi-issue release batch | **Agent Teams** | Shared task tracking and coordinated release |

When enabled and criteria match, Agent Teams is required.

## Scope: Intra-Session vs Cross-Session

| Scope | Tool | Use Case |
|-------|------|----------|
| Intra-session | `SendMessage` (Agent Teams) | Multi-agent collaboration in one session |
| Cross-session | `send_message` (claude-peers-mcp) | Multi-terminal/project coordination |

Do not confuse these mechanisms.

## Self-Check Before Agent Tool

Quick rule: explicit user preference for plain subagents wins. Otherwise use Teams for 3+ agents, review cycles, shared state, complex debugging, dynamic creation, or multi-issue batches; use Agent Tool for 1-2 simple tasks, sequential scaffolding, or mechanical disjoint-file batches with explicit scopes.

<!-- DETAIL: Self-Check Before Agent Tool
0. Did the user explicitly prefer plain subagents this session? YES → Agent Tool.
1. Is Agent Teams unavailable? YES → Agent Tool with R009/R010.
2. Will 3+ agents be involved? YES → Agent Teams.
3. Is there a review → fix → re-review cycle? YES → Agent Teams.
4. Are 2+ issues fixed in the same release batch? YES → prefer Agent Teams.
5. Are tasks sequentially dependent init/scaffold work? YES → Agent Tool.
6. Is this a mechanical disjoint-file refactor/deletion batch with explicit write scopes where Team runtime overhead or stall risk exceeds coordination value? YES → Agent Tool allowed.
7. Otherwise, use Agent Teams when collaboration or shared state has material value.
-->

## Spawn Completeness

Spawn all members for a parallel team slice in one message; partial/sequential spawning needs correction.

<!-- DETAIL: Spawn Completeness
Before spawning, count required members (N) and spawn all N in one message. Partial spawn (1/N) and one-member-per-message sequencing break the team contract because early workers begin without the intended peer set and shared coordination context.
-->

## External Skill Conflict Resolution

External skills define workflow; R018 defines execution method. Keep skill logic but use Teams when R018 criteria match.

<!-- DETAIL: External Skill Conflict Resolution
Examples:
- Skill says “Use Agent tool for N tasks”; R018 says 3+ agents → use Agent Teams.
- Skill suggests sequential spawning; R009 says independent tasks → spawn in parallel.
- Skill says “skip coordination”; shared state/review cycles → use Team coordination.
-->

## Retrospective Hardening

- Mechanical disjoint-file refactors/deletions may use standalone parallel agents when prompts have explicit write scopes and Team runtime overhead or stall risk outweighs coordination value.
- Agent Teams task status is advisory only; verify completion with deterministic evidence such as `git diff`, `git status`, search, scripts, tests, or build output.
- Split giant delegated prompts by domain, file group, and write scope so assignees can finish without touching another agent's files.
- Do not misuse `AskUserQuestion` or other user-facing prompts for internal coordination; use peer channels, runtime state, or repository evidence.
- In zsh snippets, avoid the reserved `status` variable; use names like `exit_status` or `cmd_status`.

<!-- DETAIL: Retrospective Hardening
#1430/#1431 hardening intent:
- Mechanical disjoint-file batches are not inherently collaborative. Standalone agents may be safer when each owns a non-overlapping file set and Team runtime coordination would add token cost, idle polling, or stall risk.
- Team task status, TaskList state, member status, and peer claims are coordination signals, not proof. The orchestrator must confirm outcomes through repository state and repeatable commands before declaring completion.
- Giant prompts create cross-scope edits and confused ownership. Split by domain/file group/write scope, include explicit boundaries, and require agents to report rather than self-assign extra work.
- AskUserQuestion is for human decisions, not internal agent coordination. Internal coordination belongs in Agent Teams peer messages, cross-session peer messaging, runtime state, or direct repo evidence.
- zsh reserves `status`; shell snippets that assign to it can fail. Use `exit_status`, `cmd_status`, or another non-reserved name.
-->

## Common Violations

Wrong: 3+ collaborative standalone agents, uncoordinated review/fix loops, or one-at-a-time team spawns. Correct: create team, spawn together, coordinate via `SendMessage`, verify deterministically.

<!-- DETAIL: Common Violations
Wrong: three researchers launched as unrelated Agent calls while Agent Teams is available.
Correct: TeamCreate("research-team") + researcher-1/2/3 spawned together + SendMessage coordination.

Wrong: reviewer → implementer → reviewer as disconnected calls.
Correct: reviewer and implementer are team members; reviewer sends findings, implementer fixes, reviewer re-checks.

Wrong: completed member browses TaskList and edits another member's files.
Correct: completed member reports completion and waits silently unless reassigned by the lead.
-->

## Cost Guidelines

Agent Tool: 1-2 simple independent agents. Agent Teams: 3+ agents, shared state, review cycles, complex work, multi-issue batches, or dynamic creation.

## Team Patterns

Common patterns: Research, Development, Debug, Dynamic Creation, and Codex Hybrid.

<!-- DETAIL: Team Patterns
Research: parallel researchers gather evidence; synthesizer merges and checks conflicts.
Development: implementer changes code, reviewer challenges, tester verifies.
Debug: investigators isolate causes across modules; fixer implements after evidence converges.
Dynamic Creation: mgr-creator creates missing expertise, validator checks immediate usability.
Codex Hybrid: codex-exec generates implementation, Claude team member reviews/refines, then verification closes the loop.
-->

## Blocked Agent Behavior

Prefer deferred spawn over idle polling. Blocked/completed members wait silently, check infrequently, and never edit outside scope.

<!-- DETAIL: Blocked Agent Behavior
Strategies: defer spawn when dependency chain is clear; silent wait for short blocks; reassign after sustained blocking. Prompts should say: “If blocked, wait silently. Check TaskList at most once per minute. After completing, report via SendMessage and do not browse or edit outside your scope.”
-->

## Lifecycle

`TeamCreate → TaskCreate → Agent(spawn members) → SendMessage → TaskUpdate → ... → TeamDelete`.

<!-- DETAIL: Lifecycle diagram
TeamCreate → TaskCreate → Agent(spawn members) → SendMessage(coordinate) → TaskUpdate(progress) → verify → shutdown members → TeamDelete.
-->

## Fallback

If Teams unavailable, use Agent tool with R009/R010. If available, prefer Teams for qualifying collaboration.

## Active Preference Rule

Default to Teams for multi-step/multi-issue collaboration. Fall back only for simple single-issue work, explicit user preference, sequential scaffolding, or low-coordination mechanical disjoint-file batches.
