---
title: mgr-sauron
type: agent
updated: 2026-07-18
sources:
  - .codex/agents/mgr-sauron.md
related:
  - [[mgr-gitnerd]]
  - [[mgr-supplier]]
  - [[mgr-updater]]
  - [[mgr-claude-code-bible]]
---

# mgr-sauron

Automated R017 verification specialist — the "all-seeing eye" that runs five cost-aware manager rounds plus three mandatory deep review rounds before any commit or push.

## Overview

`mgr-sauron` is the system integrity guardian. No git push is permitted without `mgr-sauron:watch` passing first (enforced by [[mgr-gitnerd]]). Manager Rounds 1-2 run the supplier and documentation checks; Rounds 3-4 may be recorded as `SKIPPED (clean)` only when both earlier rounds report exactly zero issues. Any warning, error, issue, or indeterminate result requires both re-verification rounds. Round 5 consumes deterministic template, wiki, version, fork-list, and documentation script evidence before semantic frontmatter, skill-reference, memory-scope, and routing review. All three deep review rounds remain mandatory, including on the exact-clean path.

It can auto-fix count mismatches, missing memory fields, and outdated doc references, but flags missing agent files, invalid memory scopes, and philosophy violations for manual review.

## Key Details

- **Model**: sonnet
- **Domain**: universal
- **Tools**: Read, Write, Edit, Grep, Glob, Bash
- **Skills**: `sauron-watch`
- **Memory**: local
- **Effort**: high
- **Max Turns**: 25

## Commands

| Command | Description |
|---------|-------------|
| `mgr-sauron:watch` | Full R017 verification; manager Rounds 3-4 skip only on the exact-clean path, while all 3 deep rounds always run |
| `mgr-sauron:quick` | Quick single-pass check |
| `mgr-sauron:report` | Generate verification status report |

## Relationships

- **Depends on**: [[mgr-supplier]] (dependency audit), [[mgr-updater]] (docs sync), [[mgr-claude-code-bible]] (spec compliance)
- **Used by**: [[mgr-gitnerd]] (push prerequisite), R017 rule enforcement, `$omcustomcodex:sauron-watch` in Codex/OMX (`/omcustomcodex:sauron-watch` in Claude Code)
- **See also**: [[mgr-creator]] (creation of verified agents), [[mgr-supplier]], [[mgr-updater]]

## Sources

- `.codex/agents/mgr-sauron.md` — agent definition
