---
title: Goal
type: skill
updated: 2026-05-08
sources:
  - .codex/skills/goal/SKILL.md
related:
  - [[deep-plan]]
  - [[structured-dev-cycle]]
  - [[R020]]
---

# Goal

Goal-to-execution workflow for disciplined Codex + OMX task completion.

## Overview

`/goal <objective>` keeps a concrete user objective visible through the full task lifecycle. It captures the objective, asks only for materially blocking clarification, inspects repository context, creates a short plan for non-trivial work, executes with local conventions, verifies completion, and reports changed files plus residual risk.

This is the Codex + OMX port of the upstream goal workflow. It is packaged as a normal skill surface and does not depend on native Codex feature flags such as `features.goals`.

## Key Details

- **Scope**: core
- **User-invocable**: yes
- **Command**: `/goal`
- **Argument hint**: `<objective>`

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[deep-plan]], [[structured-dev-cycle]]
- **See also**: [[R020]]

## Sources

- `.codex/skills/goal/SKILL.md` — skill definition
