---
name: reasoning-sandwich
description: Template for pre-reasoning → action → post-verification model allocation
scope: core
user-invocable: false
---

# Reasoning Sandwich Pattern

## Purpose

A model allocation pattern that wraps implementation actions with stronger-model reasoning phases. The "sandwich" structure ensures complex tasks get proper analysis before and verification after the core action.

## Pattern

```
[Pre-reasoning] → stronger model (frontier/high)
  ├── Analyze requirements
  ├── Identify edge cases
  └── Define success criteria

[Action] → balanced model (frontier/medium)
  ├── Implement solution
  ├── Generate code/content
  └── Execute plan

[Post-verification] → balanced or lighter lane (`frontier`/`medium` or `spark`/`low`)
  ├── Verify against criteria
  ├── Check for regressions
  └── Validate completeness
```

## Capability / Effort Allocation Table

| Phase | Recommended Lane / Effort | Rationale |
|-------|------------------|-----------|
| Pre-reasoning (analyze/plan) | frontier/high | Complex architectural reasoning, edge case detection |
| Action (implement/generate) | frontier/medium | Optimized for code generation, balanced cost |
| Post-verification (review/test) | frontier/medium or spark/low | Structural verification, checklist validation |

## Reasoning Budget Allocation

Allocate deeper reasoning to phases that shape the harness or verify completion:

| Workflow phase | Reasoning budget | Notes |
|----------------|------------------|-------|
| Requirements and boundary mapping | high | Identify missing context, owner boundaries, and verification evidence |
| Mechanical edits | medium | Follow the established plan and local patterns |
| Test failure diagnosis | high | Reconstruct the failing boundary before editing again |
| Release verification | high | Confirm public surfaces, package versions, tags, and issue state |
| Routine formatting | low | Use existing formatters and avoid new abstractions |

If a phase repeats without new evidence, run `loop-detection-middleware` before spending more reasoning budget on the same path.

## When to Apply

| Scenario | Apply Sandwich? | Reason |
|----------|----------------|--------|
| New feature implementation | Yes | Needs analysis → code → verification |
| Bug fix with clear root cause | No | Direct action sufficient |
| Architecture decision | Yes | Heavy pre-reasoning, lighter action |
| Batch file edits | No | Mechanical action, no reasoning needed |
| Security-sensitive changes | Yes | Extra verification phase critical |

## Integration

This pattern is used by:
- `structured-dev-cycle` — stages map to sandwich phases
- `evaluator-optimizer` — generator/evaluator model selection guidance
- `deep-plan` — research (pre) → plan (action) → verify (post)
- `middleware-patterns` — uses this skill as the `wrap_model_call` substitute for Codex + OMX

## Anti-patterns

| Anti-pattern | Problem | Fix |
|-------------|---------|-----|
| High reasoning effort for everything | Wasteful, slow | Reserve high effort for reasoning-heavy phases |
| Low reasoning effort for complex planning | Insufficient depth | Use high effort when architecture or ambiguity requires it |
| Skipping verification | False completion risk | Always include post-verification phase |

## Runtime Support Gate

Reasoning-effort support is model-dependent. Read the active OMX model table, choose the lowest supported effort that satisfies the phase, and fall back to the nearest supported effort when necessary. Do not infer tool-use behavior from a model-family name or hardcode a concrete model ID in this pattern.
