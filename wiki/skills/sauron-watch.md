---
title: Sauron Watch
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/sauron-watch/SKILL.md
related:
  - [[mgr-sauron]]
  - [[audit-agents]]
  - [[fix-refs]]
  - [[R017]]
---

# Sauron Watch

Cost-aware R017 structural verification — the all-seeing eye for system integrity.

## Overview

Runs the complete R017 verification. Manager Rounds 1-2 perform the initial supplier and documentation checks. Rounds 3-4 may be recorded as `SKIPPED (clean)` only when both earlier rounds report exactly zero issues; any warning, error, issue, or indeterminate result requires both rounds to run. Round 5 consumes deterministic template, wiki, version, fork-list, and documentation-script evidence before semantic checks. All three deep review rounds always run. The skill must pass before any `git push` and delegates its verification role to [[mgr-sauron]].

## Key Details

- **Scope**: harness
- **User-invocable**: yes
- **Command**: `$omcustomcodex:sauron-watch` (Codex/OMX); `/omcustomcodex:sauron-watch` (Claude Code compatibility)
- **Effort**: not specified
- **Clean-path rule**: only manager Rounds 3-4 can be skipped; deep review never skips

## Relationships

- **Used by agents**: [[mgr-sauron]]
- **Related skills**: [[audit-agents]], [[fix-refs]], [[update-docs]]
- **See also**: [[R017]], [[R010]]

## Sources

- `.codex/skills/sauron-watch/SKILL.md` — skill definition
