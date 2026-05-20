---
title: "Autonomous Challenge Lessons"
type: guide
updated: 2026-05-20
sources:
  - guides/autonomous-challenge-lessons/README.md
related:
  - [[r009]]
  - [[r016]]
  - [[r020]]
  - [[qa-engineer]]
---

# Autonomous Challenge Lessons

Repeatable lessons for long autonomous runs where the agent must inspect an existing challenge environment, produce a fix, and verify the result.

## Key Requirements

- Check for supplied answer artifacts, reference binaries, golden outputs, and runtime mapping versions before implementing a guessed mechanism.
- Stop after two repeated critical launch/tool failures and re-check flag meaning, permission state, process state, or single-instance constraints.
- Split large independent work batches into bounded parallel lanes when one shell command would hide dozens of independent failures.
- Require QA reports to quote selectors, test IDs, mappings, and CLI flags from target code before citation.
- Use browser, screenshot, or runtime evidence for visual work; label indirect evidence as indirect.

## Sources

- `guides/autonomous-challenge-lessons/README.md` — source guide
