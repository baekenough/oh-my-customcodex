# Agent Harness Anatomy

## Purpose

An agent is not only a model call. In this project, an agent is the model plus the surrounding harness: filesystem state, execution tools, sandbox policy, memory, context management, and long-horizon control. This guide maps that six-part harness vocabulary onto existing oh-my-customcodex assets.

## Six Components

| Harness component | Codex + OMX asset | Status |
| --- | --- | --- |
| Filesystems for durable storage | `.codex/`, `.codex/outputs/`, `.codex/project-profile.yaml`, lockfiles | Covered |
| Bash and code execution | Codex tools, R002 tool tiers, `action-validator` | Covered |
| Sandboxes | Worktrees, permission mode, sensitive-path guards | Covered with policy constraints |
| Memory and search | memory skills, wiki/RAG surfaces, project profile | Covered |
| Context management | skills as progressive disclosure, ecomode, result aggregation | Covered |
| Long-horizon execution | `ralph`, `pipeline`, `structured-dev-cycle`, Agent Teams guidance | Covered |

## Working Backward Method

Start from the behavior the agent must reliably produce, then choose harness pieces in this order:

1. Define the observable completion evidence.
2. Pick the minimum skills and guides needed to produce that evidence.
3. Choose the tool boundary and sandbox shape.
4. Add memory/search only when the task benefits from prior context.
5. Add long-horizon control only when the task needs persistence or staged verification.

This is the same design shape as dynamic agent creation: if no expert exists, define the desired behavior first, then create the smallest agent plus skill set that can deliver it.

## Progressive Disclosure

Skills are the main context-disclosure mechanism. Keep large reference material in guides, put short procedural instructions in skills, and keep agent files focused on role and boundaries. This prevents every agent from carrying every harness detail in context.

## Sandbox Selection

| Situation | Preferred isolation |
| --- | --- |
| Dirty main worktree | Temporary git worktree |
| Release or publish work | Release branch from `origin/develop` |
| Risky generated artifacts | `.codex/outputs/` or `/tmp` first |
| Sensitive compatibility paths | Artifact body outside `.claude/**`, then explicit controlled copy only when needed |

## Ralph Loop vs Runtime Loop

`ralph` is a persistence loop with verification and cleanup obligations. `omcodex-loop` is the local runtime continuation surface. Use Ralph when the user asks for guaranteed completion, release follow-through, or "until done" behavior. Use lower-level loop controls only when you are maintaining runtime state, not when you are implementing product changes.

## Evaluation

Pair this guide with `harness-eval` and `agent-eval`. Baselines define the ideal trajectory, invocations capture observed behavior, and `omcustomcodex:improve-report` can later turn repeated regressions into improvement suggestions.
