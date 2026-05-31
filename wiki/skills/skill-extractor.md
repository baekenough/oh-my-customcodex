---
title: Skill Extractor
type: skill
updated: 2026-06-01
sources:
  - .codex/skills/skill-extractor/SKILL.md
related:
  - [[mgr-creator]]
  - [[R006]]
  - [[R020]]
  - [[R016]]
---

# Skill Extractor

Analyze recurring task trajectories and evidence to propose reusable workflow packaging candidates.

## Overview

Collects evidence from recent session outcomes (`/tmp/.codex-task-outcomes-$PPID`), memory/session summaries, rollout or release summaries, optional Chronicle/history integrations, and the existing skills/agents inventory. It builds an evidence-first shortlist before proposing any reusable artifact.

Each shortlist entry records the workflow, evidence and dates, frequency/confidence, recommended form (`Skill`, `Custom subagent`, `Automation`, or `Skip`), duplicate/overlap check, why, and why-not. Approved `Skill` or `Custom subagent` work is delegated to `mgr-creator`; deterministic `Automation` candidates are handed off as scoped implementation recommendations. Nothing is created without explicit user approval.

## Key Details

- **Scope**: core
- **User-invocable**: yes
- **Command**: `/skill-extractor`
- **Argument hint**: `[--threshold <n>] [--dry-run] [--all]`
- **Default threshold**: 3 source-attributed evidence points
- **Guardrails**: user approval, duplicate/overlap checks, R006 responsibility boundaries, and R020 verification evidence

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[mgr-creator]], [[skills-sh-search]], [[memory-recall]], [[memory-management]]
- **See also**: [[R016]], [[R006]], [[R020]]

## Sources

- `.codex/skills/skill-extractor/SKILL.md` — skill definition
