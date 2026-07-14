---
name: product-strategy
description: YC-style product pressure test and scope framing for ideas, features, and workflow bets
scope: core
user-invocable: true
argument-hint: "<idea-or-feature>"
---

# Product Strategy

Use this skill when a request needs product pressure, not immediate implementation. It borrows the useful part of the "office hours" pattern: force the conversation to answer hard product questions before work expands.

## When To Use

- feature framing
- product tradeoff review
- CEO / founder style pressure test
- scope negotiation before implementation

## Workflow

### 1. State the bet

Write the feature or idea in one sentence:

- who it is for
- what changes for them
- why it matters now

### 2. Run the six questions

Answer these before moving forward:

1. What user pain becomes meaningfully smaller?
2. Why will the user notice this quickly?
3. What simpler alternative did we reject?
4. What metric or behavior would prove this worked?
5. What gets harder if we ship this?
6. What would we deliberately not build in v1?

### 3. Choose a scope mode

Assign one mode:

- `Expand` — increase ambition because the upside justifies it
- `Selective` — keep only the highest-signal slice
- `Hold` — wait for a prerequisite or stronger evidence
- `Reduce` — cut scope because the current ask is inflated

### 4. Output contract

Return:

- problem statement
- strongest argument for shipping
- strongest argument against shipping
- chosen scope mode
- next 2-3 concrete actions

## Related References

- `guides/browser-automation/README.md` for grounded product review through real browser flows
- `.codex/skills/deep-plan/SKILL.md` for implementation planning once the strategy is accepted
