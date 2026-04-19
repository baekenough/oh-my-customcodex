---
name: pre-generation-arch-check
description: Check planned code changes for architecture and responsibility violations before implementation
scope: package
argument-hint: "<change-request-summary>"
user-invocable: true
---

# Pre-Generation Architecture Check

Review a requested change before code generation begins and warn about likely architecture violations.

This skill fills a gap between planning and implementation:

- `adversarial-review` focuses on attacker-minded risk after code exists
- `deep-verify` focuses on release-quality verification after code exists
- `pre-generation-arch-check` focuses on architecture hygiene before code is written

## What It Checks

The skill looks for likely violations of:

- R006 separation of concerns
- compilation metaphor integrity
- wrong-layer ownership
- accidental orchestrator responsibility expansion
- speculative wrappers or abstractions that do not earn their cost

## Inputs

Provide a short request summary, optionally including likely files or modules.

Examples:

```text
/pre-generation-arch-check add a background sync service to updater.ts
/pre-generation-arch-check move routing logic into the agent file instead of the routing skill
```

## Output Contract

### No concern

```text
[ARCH-CHECK] CLEAR

Request appears consistent with current architecture.
```

### Warning

```text
[ARCH-WARNING] Severity: MEDIUM
Boundary: routing vs agent definition
Concern: Request would move reusable routing logic into an agent artifact
Why: Violates compilation metaphor and R006 separation of concerns
Safer shape: Keep logic in a skill or routing layer; keep agent file declarative
```

## Heuristics

- warn when a request mixes skill logic with agent artifacts
- warn when orchestrator responsibilities expand into direct file-writing logic
- warn when a request introduces a new abstraction without a clear reuse or boundary win
- warn when a change smells like the wrong layer owns the behavior
- prefer concise warnings with one safer alternative

## Integration

Use before:

- major refactors
- new workflow or routing features
- multi-file cross-layer changes

Good pairings:

- `pre-generation-arch-check` -> `deep-plan`
- `pre-generation-arch-check` -> `structured-dev-cycle`
- `pre-generation-arch-check` -> implementation
