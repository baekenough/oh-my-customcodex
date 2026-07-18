---
title: Dev Lead Routing
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/dev-lead-routing/SKILL.md
related:
  - [[lang-golang-expert]]
  - [[lang-python-expert]]
  - [[lang-typescript-expert]]
  - [[lang-rust-expert]]
  - [[lang-kotlin-expert]]
  - [[lang-java21-expert]]
  - [[fe-vercel-agent]]
---

# Dev Lead Routing

Routes development tasks to the correct language/framework expert agent.

## Overview

Routing skill for software development tasks. Detects the appropriate language or framework expert based on file extensions, keywords, and project context, then delegates to that role. Codex uses installed `agent_type` routing and active runtime permissions without a `mode` parameter; Claude compatibility `Agent` calls use `mode: "bypassPermissions"` only when the Claude session is already in bypass mode. Unmatched tasks fall back to dynamic creation through [[mgr-creator]].

## Key Details

- **Scope**: core
- **User-invocable**: no
- **Context**: fork
- **Permission boundary**: native Codex and Claude compatibility calls follow distinct R010 contracts

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[secretary-routing]], [[de-lead-routing]], [[qa-lead-routing]], [[intent-detection]]
- **See also**: [[R010]], [[R015]], [[R019]]

## Sources

- `.codex/skills/dev-lead-routing/SKILL.md` — skill definition
