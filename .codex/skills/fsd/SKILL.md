---
name: omcustomcodex:fsd
description: Full Self Driving — autonomous release loop that processes all auto-dev-eligible GitHub issues until none remain, by repeatedly running /pipeline auto-dev then /homework.
scope: harness
user-invocable: true
argument-hint: "[<max-releases>]"
version: 0.1.0
effort: high
---

# /omcustomcodex:fsd — Full Self Driving

Autonomous release loop. Equivalent to running:

```
/omcustomcodex:goal "모든 이슈가 처리될 때까지" /omcustomcodex:loop "/pipeline auto-dev -> /homework"
```

This is a **thin alias / orchestrator skill**. It does not implement loop, issue-polling, release, or verification logic — it delegates entirely to existing skills.

## Usage

```
/omcustomcodex:fsd               # Run until all auto-dev-eligible issues are exhausted
/omcustomcodex:fsd 3             # Optional: cap at N releases (default: unlimited)
```

No arguments are required. The default behavior runs until the auto-dev-eligible issue set is empty.

## What It Does

FSD expands into:

1. **`/omcustomcodex:goal` wrapper** — applies disciplined goal-to-execution workflow:
   - Objective: "모든 이슈가 처리될 때까지"
   - Delegates planning, gap detection, and R020 completion verification to the `goal` skill
2. **`/omcustomcodex:loop` recurrence** — self-paced loop, each iteration runs:
   1. `/pipeline auto-dev` — full release pipeline for the next eligible issue or release unit
   2. `/homework` — retrospective 찐빠 audit gate

### Loop Convergence

The loop converges naturally when the auto-dev-eligible issue set reaches 0. Issue eligibility follows `/pipeline auto-dev` label selection exactly:

- **Included**: `verify-ready` (preferred), unlabeled auto-dev candidates
- **Excluded**: `verify-done`, `needs-review`, `decision-needed` labels

Do NOT invent new label logic here — defer to the `pipeline` skill's auto-dev issue selection.

### Iteration Flow (per iteration)

```
[FSD Iteration N]
├── /pipeline auto-dev        → one release (PR create → merge → npm publish → milestone close)
├── /homework                 → extract 찐빠, confirm gate (or --dry-run if requested)
└── Check: any eligible issues remain?
    ├── YES → next iteration
    └── NO  → [FSD Done] converged naturally
```

## Safety and Discipline

Each iteration operates under full project rules — no relaxation because FSD is autonomous:

| Rule | Applies |
|------|---------|
| R001 (safety) | Destructive ops still require explicit approval. Credential guardrails always active. |
| R009 (parallel) | Independent subtasks within each pipeline iteration run in parallel. |
| R010 (orchestration) | File modifications follow repo delegation/ownership rules. |
| R017 (sync verification) | Structural verification passes before any commit. |
| R020 (completion verification) | Each release verified via `npm view`, `gh release view`, closed issues before `[Done]`. |

`/homework` runs as a **retrospective gate** between iterations — findings go through `omcustomcodex:feedback`'s preview/confirmation gate. The loop does NOT skip homework because it is "automated". If homework requires user confirmation, the loop pauses and waits.

If a release operation triggers the safety classifier, the current iteration stops and surfaces the block before continuing.

## When to Use

| Scenario | Use FSD? |
|----------|----------|
| Multiple eligible issues ready to process autonomously | YES |
| Session where the user wants to "let it run" through the backlog | YES |
| Verifying the autonomous release loop pattern from session memory | YES |
| Single targeted issue fix | NO — use `/pipeline auto-dev` directly |
| Exploratory research / planning only | NO — use `/research` or `/deep-plan` |
| Only one issue and it needs human judgment | NO — use `/pipeline auto-dev` with manual oversight |

## When NOT to Use

- When issues require stakeholder approval or design decisions before implementation
- When the issue set includes `decision-needed` or `needs-review` items only
- When cost sensitivity is high and the issue backlog is large — inspect the eligible set first before running FSD

## Optional Release Cap

Pass a numeric argument to cap at N releases:

```
/omcustomcodex:fsd 3    # Process at most 3 releases this FSD run
```

The cap is advisory — the pipeline itself may stop earlier if the eligible set runs out before the cap is reached.

## Session 114 Precedent

This skill was extracted from the upstream manual pattern used in Session 114 (2026-06-09):

```
/goal "모든 이슈가 처리될 때까지" /loop "/pipeline auto-dev -> /homework"
```

The Codex port keeps the intent but uses `omcustomcodex:` namespaced goal/loop surfaces to avoid native runtime command collisions.

## Cross-References

| Skill / Rule | Role |
|--------------|------|
| `omcustomcodex:goal` | Disciplined goal-to-execution wrapper — objective parse, gap detection, R020 verification |
| `omcustomcodex:loop` | Session auto-continuation during background work |
| `pipeline` | `/pipeline auto-dev` — the core release pipeline per iteration |
| `homework` | Retrospective 찐빠 audit gate per iteration |
| R001 (safety) | Destructive ops require approval; credential guardrails |
| R009 (parallel execution) | Parallel subtasks within each pipeline iteration |
| R010 (orchestrator coordination) | File ownership and delegation discipline |
| R017 (sync verification) | Structural verification before commit/push |
| R020 (completion verification) | Actual outcome verified before declaring each release done |

## Design Notes

This skill is intentionally a **thin alias**. It does NOT duplicate issue polling, loop cadence, release steps, retrospective analysis, or completion verification. If the underlying skills evolve, FSD automatically benefits.

## Artifact Output

Artifacts from each iteration follow the constituent skills' conventions:

- Pipeline artifacts: `.codex/outputs/sessions/{YYYY-MM-DD}/pipeline-auto-dev-{HHmmss}.md`
- Homework artifacts: `.codex/outputs/sessions/{YYYY-MM-DD}/homework-{HHmmss}.md`
