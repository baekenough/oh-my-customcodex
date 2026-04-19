---
title: Pre-Generation Architecture Check
type: skill
updated: 2026-04-19
sources:
  - .codex/skills/pre-generation-arch-check/SKILL.md
related:
  - [[adversarial-review]]
  - [[deep-verify]]
  - [[structured-dev-cycle]]
---

# Pre-Generation Architecture Check

Check a planned code change for architecture and responsibility violations before implementation starts.

## Overview

This skill acts like a pre-generation architecture lint pass. It examines a requested change and flags likely violations of R006 separation of concerns, compilation-metaphor boundaries, wrong-layer ownership, or speculative abstractions before code is written. It complements post-generation checks such as `adversarial-review` and `deep-verify`.

## Key Details

- **Scope**: package
- **User-invocable**: yes
- **Command**: `/pre-generation-arch-check`
- **Effort**: not specified
- **Argument hint**: `<change-request-summary>`

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[adversarial-review]], [[deep-verify]], [[structured-dev-cycle]]
- **See also**: `R006`

## Sources

- `.codex/skills/pre-generation-arch-check/SKILL.md` — skill definition
