---
title: Instinct Extractor
type: skill
updated: 2026-05-19
sources:
  - .codex/skills/instinct-extractor/SKILL.md
related:
  - [[skill-extractor]]
  - [[memory-save]]
---

# Instinct Extractor

Extract reusable workflow instincts from git history, sessions, and task outcomes with confidence scoring.

## Overview

Finds repeated operator or agent behavior that should become a rule, skill, guide, memory entry, or evaluation case. It reads bounded evidence from git history, session artifacts, task outcomes, or all sources, clusters repeated failures and successful recovery patterns, assigns confidence, and emits proposals only.

## Key Details

- **Scope**: harness
- **User-invocable**: yes
- **Command**: `/instinct-extractor`
- **Effort**: not specified
- **Argument hint**: `[--since <date>] [--source git|sessions|outcomes|all] [--min-confidence low|medium|high]`

## Relationships

- **Related skills**: [[skill-extractor]], [[memory-save]]
- **See also**: [[agent-eval-framework]], [[harness-eval]]

## Sources

- `.codex/skills/instinct-extractor/SKILL.md` — skill definition
