---
title: AgentShield Wrapper
type: skill
updated: 2026-05-19
sources:
  - .codex/skills/sec-agentshield-wrapper/SKILL.md
related:
  - [[adversarial-review]]
  - [[cve-triage]]
---

# AgentShield Wrapper

Pre-flight AgentShield-style security suite wrapper for agent harness changes.

## Overview

Runs an AgentShield-style pre-flight review before risky agent, skill, hook, or MCP changes. It prefers a connected AgentShield scanner when available and otherwise falls back to local static checks that inspect tool authority, prompt injection, secret exposure, path boundaries, and MCP risk.

## Key Details

- **Scope**: harness
- **User-invocable**: yes
- **Command**: `/sec-agentshield-wrapper`
- **Effort**: not specified
- **Argument hint**: `<path> [--strict] [--report <file>]`

## Relationships

- **Related skills**: [[adversarial-review]], [[cve-triage]]
- **See also**: [[action-validator]], [[sec-codeql-expert]]

## Sources

- `.codex/skills/sec-agentshield-wrapper/SKILL.md` — skill definition
