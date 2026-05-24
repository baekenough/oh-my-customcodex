---
title: Post-Release Followup
type: skill
updated: 2026-05-24
sources:
  - .codex/skills/post-release-followup/SKILL.md
related:
  - [[release-plan]]
  - [[deep-verify]]
  - [[professor-triage]]
---

# Post-Release Followup

Analyze release workflow findings and recommend follow-up actions — execute immediately or register as issues.

## Overview

After PR creation in a release workflow, collects unaddressed findings from multiple sources (remaining open issues, deep-verify findings, triage deferred items, TODO markers in changed files, PR review feedback from omc_pr_analyzer). Deduplicates and categorizes by urgency. Genuine defects, process gaps, and coverage gaps are auto-registered as GitHub issues before any prompt; only code-changing immediate-action items require user input.

## Key Details

- **Scope**: harness
- **User-invocable**: no
- **Effort**: medium
- **Auto-register**: genuine defects/process gaps via `gh issue create --repo baekenough/oh-my-customcodex`
- **Prompt boundary**: ask only for immediate code-changing follow-up actions

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[release-plan]], [[deep-verify]], [[professor-triage]], [[omcodex-release-notes]]
- **See also**: [[R020]]

## Sources

- `.codex/skills/post-release-followup/SKILL.md` — skill definition
