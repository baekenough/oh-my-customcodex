---
name: roundtable-debate
description: Structured multi-agent debate that preserves dissent with a mandatory devil's advocate and two-round cap
scope: core
user-invocable: true
argument-hint: "<topic-or-document> [--rounds 1|2] [--decision required|advisory]"
effort: high
version: 1.0.0
---

# Roundtable Debate

## Purpose

Run a bounded debate when convergence would hide useful disagreement. Unlike `agora`, which drives toward consensus, this workflow preserves minority positions and requires explicit justification before dismissing them.

## When To Use

- Architecture or product choices with multiple defensible paths.
- Review work where anchoring or groupthink is likely.
- Decisions where a minority risk could be more important than the majority preference.

## Workflow

1. **Independent-first analysis**: spawn 3-5 reviewers in parallel. Do not share intermediate opinions before each reviewer submits an initial view.
2. **Mandatory devil's advocate**: one reviewer argues against the emerging default, even if they personally agree with it.
3. **Round 1 synthesis**: group findings into majority positions, minority positions, and unresolved facts.
4. **Round 2 challenge**: reviewers respond only to disputed claims and missing evidence.
5. **Decision record**: keep the final recommendation and any protected dissent.

Hard cap: two debate rounds. If the decision still depends on missing facts, stop and gather evidence instead of debating longer.

## Output

```markdown
# Roundtable Debate Result

## Topic
{topic}

## Majority Recommendation
{recommendation}

## Protected Dissent
| Position | Advocate | Why It Was Not Dismissed |
|----------|----------|--------------------------|
| {position} | devil's advocate | {evidence or risk} |

## Decision
{adopt | defer | reject | gather-more-evidence}
```

## Relationship To Agora

| Workflow | Goal | Best For |
|----------|------|----------|
| `agora` | adversarial consensus | release gates, spec approval |
| `roundtable-debate` | dissent preservation | ambiguous strategy, architectural tradeoffs |

Use `agora --anti-groupthink` when you need consensus plus explicit dissent handling.
