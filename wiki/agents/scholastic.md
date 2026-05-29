---
title: scholastic
type: agent
updated: 2026-05-29
sources:
  - .codex/agents/scholastic.md
related:
  - [[wiki/architecture/agent-taxonomy]]
  - [[wiki/agents/arch-speckit-agent]]
  - [[wiki/agents/qa-planner]]
---

# scholastic

Ontology-first reasoning reviewer for category mistakes, hidden assumptions, modality separation, scholastic critique, and minimal-repair proposals.

## Overview

`scholastic` reviews arguments before implementation or planning decisions harden. It defines key terms, checks whether a claim collapses through a category mistake, separates categorical failures from empirical failures, and only then evaluates logic. It is intentionally read-only: the agent should diagnose reasoning quality, provide concrete counterexamples, and propose the smallest ontology-safe repair rather than rewriting code or inventing runtime features.

## Key Details

- **Model**: sonnet
- **Domain**: universal
- **Tools**: Read, Grep, Glob
- **Memory**: project
- **Effort**: high
- **Limitations**: read-only reviewer; must distinguish ontology failures from empirical failures

## Review Pattern

1. Define key terms and normalize ambiguous usage.
2. Validate ontology against concrete examples.
3. Label failures as categorical or empirical.
4. Surface hidden assumptions and modality shifts.
5. Present premises, reasoning steps, and conclusion.
6. Propose the minimal safe repair when the ontology fails.

## Sources

- `.codex/agents/scholastic.md` — agent definition
