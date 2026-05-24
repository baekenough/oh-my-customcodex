# [MUST] Continuous Improvement Rules

> **Priority**: MUST | **ID**: R016 | **Trigger**: User points out rule violation

## Core Rule

When user points out a violation: update the relevant rule → commit → then continue original task.

Update the relevant rule rather than just acknowledging the violation.

## Workflow

1. Acknowledge violation
2. Identify root cause (which rule was weak/unclear?)
3. Update the rule (add clarity, examples, self-checks)
4. Commit the change
5. Continue original task following updated rules

## Integration

| Situation | Action |
|-----------|--------|
| User points out violation | Update rule → Continue |
| Self-detected violation | Fix immediately, consider rule update |
| Ambiguous situation | Ask user, then update if needed |

## Defect Response Matrix

| Defect Type | Rule Update | Memory | Issue |
|-------------|:-----------:|:------:|:-----:|
| Rule violation (agent behavior) | ✅ | — | — |
| CI/infra defect | — | ✅ | ✅ |
| Process gap (workflow hole) | ✅ | ✅ | ✅ |
| Repeatable system bug | — | ✅ | ✅ |
| Agent selection failure (wrong agent routed) | — | ✅ | — |
| External repository convention miss | ✅ | ✅ | ✅ |

When CI failure, process gap, or repeatable system defect is found:
1. Record feedback memory (defend current session)
2. Register GitHub issue (trackable improvement item)
3. Both required — memory alone is NOT sufficient for system-level defects

> Auto-register directive: genuine defects and process gaps surfaced during release workflows, including `post-release-followup`, must be registered as GitHub issues automatically without asking for confirmation. Only code-changing immediate-action items require user confirmation. Pure cosmetic or subjective notes are excluded.

### Adaptive Harness Integration

When repeating agent failures or suboptimal routing is detected:
1. Record as feedback memory (immediate session defense)
2. Run `/omcustomcodex:adaptive-harness --learn` to update project profile with failure patterns
3. Profile updates improve future agent selection and harness optimization

This connects R016's continuous improvement loop with the adaptive-harness skill's learning capability.

## External Repository Contribution Pre-Check

Before creating or modifying assets for an external repository or upstream contribution target, inspect that repository's local contract before implementing:

1. Read the nearest `AGENTS.md` or equivalent agent guidance.
2. Read `CONTRIBUTING.md`, plugin/skill authoring docs, or project-specific creation guides when present.
3. Identify required metadata enums, naming conventions, validation commands, and forbidden paths.
4. Add the discovered constraints to the task plan before editing.
5. If the repo lacks guidance, state that explicitly and use the smallest conventional change.

Late discovery of contribution rules is a process defect. Record it as memory and an issue when the miss is repeatable or affected delivered work.

## Anti-Patterns — 5 patterns: "I'll update later", "one-time exception", "doesn't cover this", "finish task first", "calibration during action-oriented tone". See table via Read tool.

<!-- DETAIL: Anti-Patterns
| Anti-Pattern | Why It's Wrong | Correct Action |
|-------------|----------------|----------------|
| "I'll update the rule later" | Deferred fixes are forgotten | Update rule NOW, before continuing |
| "This is a one-time exception" | Exceptions become patterns | If the rule is wrong, fix it; if it's right, follow it |
| "The rule doesn't cover this case" | Missing coverage = rule gap | Add the case to the rule immediately |
| "Let me finish the task first" | Rule violations compound | Fix rule first (5 min), then continue (prevents N future violations) |
| "Calibration/humility during action-oriented tone (auto mode, ㄱㄱ, 계속해)" | Self-questioning wastes time when user signals action; action-mode preempts meta-reflection | Defer calibration to post-task feedback memory; respond with short action confirmation |
-->

## Timing — Rule updates MUST happen before continuing original task, in the same session.

<!-- DETAIL: Timing
Rule updates MUST happen:
- **Before** continuing the original task
- **In the same session** as the violation
- **Not** as a separate TODO or follow-up issue
-->
