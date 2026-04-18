---
title: Idea
type: skill
updated: 2026-04-19
sources:
  - .claude/skills/idea/SKILL.md
related:
  - [[analysis]]
  - [[release-plan]]
---

# Idea

Analyze a natural-language idea against the current codebase and turn it into structured issue-ready specs.

## Overview

The `idea` skill reads the current repository surface, estimates scope and risk, and emits structured JSON that can be translated into one or more GitHub issues. It is analysis-first: it does not create issues directly, but it produces issue-ready payloads for downstream tooling or manual triage.

## Key Details

- **Scope**: core
- **User-invocable**: yes
- **Command**: `/idea`
- **Argument hint**: `<idea text>`

## Relationships

- **Related skills**: [[analysis]], [[release-plan]]
- **See also**: `AGENTS.md`, `README.md`, relevant guides and docs

## Sources

- `.claude/skills/idea/SKILL.md` — skill definition
