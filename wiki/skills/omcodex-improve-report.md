---
title: Omcustom Improve Report
type: skill
updated: 2026-04-12
sources:
  - .codex/skills/omcustomcodex-improve-report/SKILL.md
related:
  - [[omcodex-auto-improve]]
  - [[sauron-watch]]
  - [[harness-eval]]
---

# Omcustom Improve Report

Read-only report of improvement status based on eval-core findings.

## Overview

Generates a read-only improvement status report by reading eval-core outputs, harness-eval results, and sauron verification findings. Categorizes improvement opportunities by area (agent quality, rule compliance, skill coverage, routing accuracy), assigns priorities, and presents a structured report. Does not apply any changes — use `omcodex-auto-improve` to apply.

## Key Details

- **Scope**: harness
- **User-invocable**: yes
- **Command**: `/omcustomcodex:improve-report`
- **Effort**: not specified

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[omcodex-auto-improve]], [[sauron-watch]], [[harness-eval]]
- **See also**: [[R016]]

## Sources

- `.codex/skills/omcustomcodex-improve-report/SKILL.md` — skill definition
