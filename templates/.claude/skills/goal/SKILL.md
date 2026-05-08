---
name: goal
description: Goal-to-execution workflow for disciplined Codex + OMX task completion
scope: core
version: 1.0.0
user-invocable: true
argument-hint: "<objective>"
---

# /goal - Goal-To-Execution Workflow

Use `/goal <objective>` when the user wants Codex to keep a concrete objective in view until it is genuinely complete.

This is the Codex + OMX port of the upstream goal workflow. It is implemented as a normal skill surface and does not depend on native Codex feature flags such as `features.goals`.

## Contract

When invoked with an objective:

1. Treat the supplied text as the concrete goal.
2. Ask only for requirements that are materially missing, risky, or blocking.
3. Inspect the relevant repository context before planning implementation.
4. Produce a short execution plan for non-trivial work.
5. Execute using existing project conventions, routing skills, and specialist agents when useful.
6. Verify completion before claiming the goal is done.
7. Report changed files, verification evidence, and remaining risks.

## Workflow

### 1. Capture Goal

Restate the objective in one sentence. If the runtime exposes goal tracking, register the objective there. Otherwise keep the objective visible in the active task state.

Do not broaden the goal beyond the user's words without confirming the added scope.

### 2. Clarify Only Blockers

Ask at most three short questions, and only when the answer changes the implementation path or risk profile. If reasonable defaults exist, state the assumption and continue.

### 3. Inspect Context

Search and read the smallest useful set of files before editing. Prefer `rg`/`rg --files` for repository discovery. Identify:

- Existing implementation patterns.
- Tests or validators that cover the affected surface.
- Provider-boundary constraints for this repository.
- User or worktree changes that must be preserved.

### 4. Plan

For non-trivial work, produce a concise plan with:

- Files or modules likely to change.
- Verification commands.
- Risks or assumptions.

Skip the visible plan for tiny, obvious changes, but still do the context check.

### 5. Execute

Use the repository's established tools and style. Keep edits scoped to the goal. Delegate through routing skills or agents when the task crosses ownership boundaries, needs specialized review, or benefits from parallel independent work.

In oh-my-customcodex, use `omcustomcodex` in command examples and operator guidance. Do not introduce `omcustom` instructions.

### 6. Verify

Run the narrowest meaningful verification first, then broaden when the change touches shared behavior, generated catalogs, release flow, or user-facing docs. If verification cannot run, report why.

### 7. Complete

Finish with:

- What changed.
- Verification evidence.
- Remaining risks or follow-up work.

Do not mark the goal complete until the acceptance criteria are satisfied or the user explicitly accepts a partial result.

## Acceptance Checklist

- Objective stayed fixed unless the user changed it.
- Blocking ambiguity was resolved or called out.
- Relevant context was inspected before edits.
- Implementation followed local patterns.
- Verification evidence is current.
- Final response includes changed files and residual risk.
