---
title: Vercel Deploy
type: skill
updated: 2026-07-18
sources:
  - .codex/skills/vercel-deploy/SKILL.md
related:
  - [[fe-vercel-agent]]
  - [[react-best-practices]]
  - [[typescript-best-practices]]
---

# Vercel Deploy

Deploy applications to Vercel with framework auto-detection and preview URLs.

## Overview

Detects supported frameworks from `package.json`, excludes `node_modules/`, `.git/`, and environment files from the deployment bundle, uploads the prepared project to Vercel, and returns preview and claim URLs. Authenticated deployment requires the Vercel CLI or an API token; claimable anonymous deployments have temporary preview URLs. The current skill has no repository-local deployment-wrapper dependency.

## Key Details

- **Scope**: core
- **User-invocable**: yes
- **Command**: `$vercel-deploy` (Codex/OMX); `/vercel-deploy` (Claude Code compatibility)
- **Effort**: not specified

## Relationships

- **Used by agents**: [[fe-vercel-agent]]
- **Related skills**: [[react-best-practices]], [[typescript-best-practices]]
- **See also**: [[mgr-gitnerd]], [[R001]]

## Sources

- `.codex/skills/vercel-deploy/SKILL.md` — skill definition
