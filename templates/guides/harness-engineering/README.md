# Harness Engineering

## Purpose

Harness engineering improves agent behavior by changing the system around the model: prompts, tools, memory, verification, and execution flow. Treat it as an optimization loop with measured evidence, not as ad hoc prompt tweaking.

## Eval-Driven Hill Climbing

Use this six-step loop when improving agents, skills, or rules:

1. Source and tag evals.
2. Split evals into optimization and holdout sets.
3. Record the baseline.
4. Optimize one harness change at a time.
5. Validate against holdout and prior passing evals.
6. Require human or reviewer sign-off for behavior-changing edits.

## Eval Tags

Each eval should carry enough metadata to decide how it can be used:

```yaml
id: routing-miss-001
capability: routing
source: user-feedback
split: optimization
tags: [routing, agent-selection, regression]
expected_outcome: "specialist agent selected without fallback"
```

Use `split: holdout` for cases that should not guide immediate optimization. Holdout evals are generalization checks.

## Passing Evals Become Regression Tests

When a harness change makes an eval pass, preserve that eval as a regression case. Passing evals should not disappear into a release note. Store enough evidence to rerun or review it later:

- input/task summary
- expected output or decision
- relevant tool boundary
- observed pass evidence
- version or commit where it first passed

## Spring Cleaning

Review eval sets periodically:

| Signal | Action |
| --- | --- |
| Eval is saturated and always passes | Keep one representative case, archive duplicates |
| Eval checks obsolete behavior | Archive with rationale |
| Eval is flaky because evidence is ambiguous | Rewrite acceptance criteria before optimizing |
| Eval overlaps a stronger regression | Merge or demote the weaker case |

## Instruction Patch Patterns

Common harness fixes:

| Failure pattern | Patch shape |
| --- | --- |
| Agent skips evidence collection | Add an explicit verification command or retrieval step |
| Agent loops on same error | Add loop-detection guidance and force re-planning |
| Agent overuses tools | Batch retrieval and require a pre-tool plan |
| Agent declares completion early | Strengthen R020 completion evidence |

## Tooling Relationships

- `harness-eval` defines repeatable benchmark suites.
- `adaptive-harness --learn` reads failures and proposes profile or skill changes.
- `loop-detection-middleware` detects repeated errors, edit loops, and repeated tool-target calls.
- `agent-eval` stores correctness and trajectory ratios.
