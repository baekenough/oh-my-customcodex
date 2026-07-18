---
title: Adaptive Harness
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/adaptive-harness/SKILL.md
related:
  - [[analysis]]
  - [[r016]]
  - [[harness-eval]]
---

# Adaptive Harness

Auto-detect project context and optimize the oh-my-customcodex harness — deactivate unused agents/skills, suggest missing experts, generate project profile.

## Overview

Scans project tech stack, maps detections to agents/skills, and generates a `.claude/project-profile.yaml`. Supports `--scan`, `--optimize`, `--learn`, `--export`, `--import`, and `--dry-run` modes. Learning reads managed usage patterns from `.codex/agent-memory-local/` and can consume harness-eval output via `$harness-eval` in Codex/OMX or `/harness-eval` in Claude Code.

## Key Details

- **Scope**: harness
- **User-invocable**: yes
- **Effort**: high
- **Command**: `$omcustomcodex:adaptive-harness` (Codex/OMX); `/omcustomcodex:adaptive-harness` (Claude Code compatibility)

## Relationships

- **Integrates with**: [[analysis]], [[r016]], [[harness-eval]]
- **Triggers**: SessionStart hook (adaptive-harness-scan.sh)
- **See also**: [[mgr-creator]], [[dynamic-creation]]

## Sources

- `.codex/skills/adaptive-harness/SKILL.md` — skill definition
