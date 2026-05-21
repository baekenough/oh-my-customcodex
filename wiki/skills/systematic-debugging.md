---
title: Systematic Debugging
type: skill
updated: 2026-05-20
sources:
  - .codex/skills/systematic-debugging/SKILL.md
related:
  - [[dev-review]]
  - [[adversarial-review]]
  - [[stuck-recovery]]
---

# Systematic Debugging

Structured debugging workflow for any bug, test failure, or unexpected behavior.

## Overview

Provides a reproduce-first, root-cause-first debugging process. The current gate set requires blocker triage, explicit problem definition, reproduction or instrumentation, evidence gathering, a single falsifiable root-cause hypothesis, a failing guard, one targeted fix, and verification against the same path. It explicitly rejects guess-and-check patches and false fixes.

## Key Details

- **Scope**: core
- **User-invocable**: no
- **Hard gates**: 7, including the retry/cache/timeout false-fix audit
- **Extended phases**: timeline correlation, retry/cache/timeout audit, amplification detection, fault injection

## Extended Phase Guides

| Guide | Use when |
|-------|----------|
| `phases/timeline-correlation.md` | Incident timing, deploy timing, config drift, or dependency events may explain the failure |
| `phases/retry-cache-timeout-audit.md` | A proposed fix changes retry, cache, timeout, pooling, backoff, debounce, or rate limits |
| `phases/amplification-detection.md` | Retries, queues, fan-out, background jobs, cron overlap, or pool exhaustion could cascade |
| `phases/fault-injection.md` | A fix claims resilience against dependency failure, timeout, corrupt input, restart, or partial writes |

## Relationships

- **Used by agents**: all agents when encountering bugs
- **Related skills**: [[dev-review]], [[adversarial-review]], [[stuck-recovery]]
- **See also**: [[R004]]

## Sources

- `.codex/skills/systematic-debugging/SKILL.md` — skill definition
- `.codex/skills/systematic-debugging/phases/*.md` — mandatory phase guides for specific debugging shapes
