---
title: mgr-creator
type: agent
updated: 2026-07-18
sources:
  - .codex/agents/mgr-creator.md
related:
  - [[mgr-sauron]]
  - [[mgr-supplier]]
  - [[mgr-updater]]
  - [[arch-documenter]]
---

# mgr-creator

Agent creation specialist that follows R006 design guidelines, auto-researches authoritative references before creating agents, and supports dynamic agent creation as a routing fallback.

## Overview

`mgr-creator` is the **only** agent permitted to create files in `.codex/agents/*.md`, `.codex/skills/*/SKILL.md`, and `guides/*/` (new directories) per R010 Protected Paths. It operates in two modes:

- **Explicit mode** (`$omcustomcodex:create-agent` in Codex/OMX; `/omcustomcodex:create-agent` in Claude Code): Follows a full research-driven 3-phase workflow (Research → Create → Auto-discover)
- **Dynamic mode** (routing fallback): When no existing agent matches a task, receives detected domain/keywords, auto-discovers relevant skills and guides, and creates a minimal viable agent with `local` memory metadata immediately without user confirmation

The agent runs for up to 25 turns to allow thorough research and creation.

## Sensitive Compatibility Paths

Codex-native `.codex/**` edits stay on the normal direct edit path. For Claude compatibility surfaces, the universal `/tmp` wrapper is a legacy fallback only: Claude Code `bypassPermissions` can write `.claude/{skills,agents,commands}/**` directly on v2.1.121+ and broader protected paths on v2.1.126+. Use the fallback only on older or still-prompting runtimes.

## Key Details

- **Model**: sonnet
- **Domain**: universal
- **Tools**: Read, Write, Edit, Grep, Glob, Bash
- **Skills**: `create-agent`, `agent-eval-framework`
- **Memory**: local
- **Effort**: high
- **Max Turns**: 25
- **Agent frontmatter permission mode**: `bypassPermissions` (distinct from native `spawn_agent` call parameters)

## Creation Workflow

1. Research authoritative references (official docs, style guides)
2. Create `.codex/agents/{name}.md` with proper R006 frontmatter and the managed `local` memory default
3. Auto-discover and link relevant skills from `.codex/skills/`
4. Agent auto-discovered by routing; no registry update needed

## Relationships

- **Depends on**: `create-agent` skill, `.codex/skills/` and `guides/` for auto-discovery
- **Used by**: R010 (Protected Paths rule), routing skills (dynamic fallback), `$omcustomcodex:create-agent` in Codex/OMX (`/omcustomcodex:create-agent` in Claude Code)
- **See also**: [[mgr-supplier]] (post-creation validation), [[mgr-sauron]] (structural integrity check), [[mgr-updater]] (external agent updates)

## Sources

- `.codex/agents/mgr-creator.md` — agent definition
