---
title: Playwright Compress
type: skill
updated: 2026-04-19
sources:
  - .codex/skills/playwright-compress/SKILL.md
  - .codex/hooks/scripts/playwright-compress.sh
related:
  - [[token-efficiency-audit]]
  - [[browser-automation-guide]]
---

# Playwright Compress

Compress verbose Playwright MCP output while preserving actionable refs, URLs, and browser evidence.

## Overview

`playwright-compress` is a narrow runtime compression surface for noisy browser-tool results. It reduces large Playwright MCP payloads after successful tool execution while keeping the parts that matter for follow-up interaction: `ref=` tokens, URLs, and high-signal lines.

## Key Details

- **Scope**: core
- **User-invocable**: yes
- **Runtime surface**: `.codex/hooks/hooks.json` + `.codex/hooks/scripts/playwright-compress.sh`

## Relationships

- **Related skills**: [[token-efficiency-audit]]
- **See also**: [[browser-automation-guide]]

## Sources

- `.codex/skills/playwright-compress/SKILL.md` — skill definition
- `.codex/hooks/scripts/playwright-compress.sh` — hook implementation
