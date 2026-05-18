---
title: Harness Export
type: skill
updated: 2026-05-19
sources:
  - .codex/skills/harness-export/SKILL.md
related:
  - [[manifest-install]]
  - [[pipeline]]
---

# Harness Export

Export-plan generator for translating oh-my-customcodex assets to other agent harness formats.

## Overview

Generates a conservative dry-run export plan from oh-my-customcodex assets into another agent harness format. Cross-harness export is treated as an adapter layer: skills remain source, agents remain build artifacts, rules remain compiler specs, and export output is a derived compatibility artifact. Writing target files requires a separate explicit task.

## Key Details

- **Scope**: harness
- **User-invocable**: yes
- **Command**: `/harness-export`
- **Effort**: not specified
- **Argument hint**: `--target cursor|codex|opencode|zed|gemini|copilot [--dry-run]`

## Relationships

- **Related skills**: [[manifest-install]], [[pipeline]]
- **See also**: [[harness-synthesizer]], [[harness-eval]]

## Sources

- `.codex/skills/harness-export/SKILL.md` — skill definition
