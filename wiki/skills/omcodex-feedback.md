---
title: Omcodex Feedback
type: skill
updated: 2026-05-24
sources:
  - .codex/skills/omcodex-feedback/SKILL.md
related:
  - [[mgr-gitnerd]]
  - [[R016]]
---

# Omcodex Feedback

Submit user feedback as a GitHub Issue for tracking and improvement.

## Overview

Collects user feedback (bug reports, feature requests, improvement suggestions) and creates a formatted GitHub Issue with appropriate labels. The skill is invocable by both the user and the model so session-end retrospective workflows can draft feedback. Public issue creation still goes through the preview and confirmation gate.

## Key Details

- **Scope**: harness
- **User-invocable**: yes
- **Command**: `/omcustomcodex:feedback`
- **Effort**: not specified
- **Target repo**: `baekenough/oh-my-customcodex`
- **Safety boundary**: model invocation can draft feedback, but cannot create a public issue without confirmation

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[R016]]
- **See also**: [[mgr-gitnerd]]

## Sources

- `.codex/skills/omcodex-feedback/SKILL.md` — skill definition
