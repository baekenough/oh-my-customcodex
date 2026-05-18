---
title: Manifest Install
type: skill
updated: 2026-05-19
sources:
  - .codex/skills/manifest-install/SKILL.md
related:
  - [[harness-export]]
  - [[update-docs]]
---

# Manifest Install

Selective manifest-driven installation profiles for oh-my-customcodex assets.

## Overview

Installs only the agent-stack assets a project profile needs while keeping the package manifest, template tree, and Codex runtime layout consistent. Profiles include minimal, standard, full, codex, and claude. The workflow resolves include/exclude rules, produces an install plan, preserves user-owned files, and treats count drift as a halt condition unless the run is a dry run.

## Key Details

- **Scope**: harness
- **User-invocable**: yes
- **Command**: `/manifest-install`
- **Effort**: not specified
- **Argument hint**: `--profile minimal|standard|full|codex|claude [--target <dir>] [--dry-run]`

## Relationships

- **Related skills**: [[harness-export]], [[update-docs]]
- **See also**: [[pipeline]], [[fix-refs]]

## Sources

- `.codex/skills/manifest-install/SKILL.md` — skill definition
