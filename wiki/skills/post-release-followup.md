---
title: Post-Release Followup
type: skill
updated: 2026-07-19
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

After PR creation in a release workflow, collects unaddressed findings from current ground-truth sources: remaining `verify-ready` issues, the distinct `decision-needed` queue, deep-verify findings, TODO markers in changed files, and PR review feedback. It does not consume an unbound “latest” artifact from the current date.

Deep-verify Source B first resolves the current repository, semantic version, and exact 40-character verified SHA from direct release evidence. It then resolves `artifact-contract.mjs` relative to the currently loaded deep-verify skill and performs deterministic exact-key selection. Missing, undecodable, malformed, stale-release, or wrong-SHA evidence blocks Source B instead of being reported as zero findings; older-artifact and mtime fallback are forbidden. Only a successful selection with an empty unresolved set is a validated clean result.

The selected JSON projection is parsed as data. Unresolved outcome references are joined to `findings.initial`, and only original MEDIUM/LOW findings enter this source. Fixed and false-positive history is retained in the artifact but is not unfinished work. Candidates are then deduplicated and categorized by urgency. Genuine defects, process gaps, and coverage gaps are auto-registered as GitHub issues before any prompt; only code-changing immediate-action items require user input.

## Key Details

- **Scope**: harness
- **User-invocable**: no
- **Effort**: medium
- **Auto-register**: genuine defects/process gaps via `gh issue create --repo baekenough/oh-my-customcodex`
- **Safe mutation input**: body and title are staged through single-quoted temporary files; title is passed as one quoted argv value
- **Mutation evidence**: every created issue is read back directly with number, title, body, and labels
- **Prompt boundary**: ask only for immediate code-changing follow-up actions
- **Deep-verify boundary**: exact repository/version/SHA selection; artifact absence is a blocker, not a clean result

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[release-plan]], [[deep-verify]], [[omcodex-release-notes]]
- **Related workflow**: [[release-workflow]]
- **See also**: [[R020]]

## Sources

- `.codex/skills/post-release-followup/SKILL.md` — skill definition
