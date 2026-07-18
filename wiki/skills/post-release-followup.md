---
title: Post-Release Followup
type: skill
updated: 2026-07-16
sources:
  - .codex/skills/post-release-followup/SKILL.md
related:
  - [[release-plan]]
  - [[deep-verify]]
  - [[release-workflow]]
---

# Post-Release Followup

Analyze release workflow findings and recommend follow-up actions — execute immediately or register as issues.

## Overview

After PR creation in a release workflow, collects unaddressed findings from current ground-truth sources: remaining `verify-ready` issues, the distinct `decision-needed` queue, deep-verify findings, TODO markers in changed files, and PR review feedback. It does not consume an unbound “latest professor-triage” artifact from the current date, avoiding stale cross-run evidence. Candidates are deduplicated and categorized by urgency. Genuine defects, process gaps, and coverage gaps are auto-registered as GitHub issues before any prompt; only code-changing immediate-action items require user input.

## Key Details

- **Scope**: harness
- **User-invocable**: no
- **Effort**: medium
- **Auto-register**: genuine defects/process gaps via `gh issue create --repo baekenough/oh-my-customcodex`
- **Safe mutation input**: body and title are staged through single-quoted temporary files; title is passed as one quoted argv value
- **Mutation evidence**: every created issue is read back directly with number, title, body, and labels
- **Prompt boundary**: ask only for immediate code-changing follow-up actions

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[release-plan]], [[deep-verify]], [[omcodex-release-notes]]
- **Related workflow**: [[release-workflow]]
- **See also**: [[R020]]

## Sources

- `.codex/skills/post-release-followup/SKILL.md` — skill definition
