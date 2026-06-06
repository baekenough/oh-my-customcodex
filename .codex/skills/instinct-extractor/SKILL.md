---
name: instinct-extractor
description: Extract reusable workflow instincts from git history, sessions, and task outcomes with confidence scoring
scope: harness
version: 1.0.0
user-invocable: true
argument-hint: "[--since <date>] [--source git|sessions|outcomes|all] [--min-confidence low|medium|high]"
---

# Instinct Extractor

Find repeated operator or agent behavior that should become a rule, skill, guide, memory entry, or evaluation case.

## Inputs

| Source | Evidence |
|--------|----------|
| `git` | Commit messages, changed paths, reverted fixes, recurring file clusters |
| `sessions` | `.codex/outputs/sessions/**`, pipeline artifacts, review reports |
| `outcomes` | Task outcome JSONL, hook telemetry, verification failures |
| `all` | Combined evidence with deduplication |

## Confidence

| Confidence | Requirement |
|------------|-------------|
| `low` | One clear event with plausible reuse |
| `medium` | Two or more independent events or one tested release finding |
| `high` | Repeated events plus passing verification or explicit user confirmation |

## Workflow

1. Collect bounded evidence for the requested source.
2. Cluster repeated failures, decisions, and successful recovery patterns.
3. Classify each candidate:
   - `memory` for project/user behavior
   - `rule` for durable safety constraints
   - `skill` for repeatable workflows
   - `guide` for reference knowledge
   - `eval` for regression checks
4. Assign confidence and cite concrete files, commits, or artifacts.
5. Emit proposals only; do not create new rules or skills without an explicit follow-up task.

## Selection Discipline

Before emitting a reusable-asset proposal, apply these filters:

- **Duplicate check**: search existing skills, rules, guides, hooks, and memory entries for equivalent behavior. Prefer extending the existing asset.
- **Skip filter**: explicitly skip ambiguous, sensitive, one-off, or ownership-unclear candidates.
- **Stable interface check**: require stable trigger, input, output, and verification evidence before recommending a skill.
- **Frequency check**: one occurrence is memory/issue material; two direct repetitions can enter a shortlist; three or more direct repetitions or explicit user confirmation can justify promotion.

When a candidate is skipped, include the skip reason so future extraction runs do not re-open the same weak proposal without new evidence.

## Output

```text
candidate: release-version-sync-preflight
type: skill
confidence: high
evidence:
  - .github/scripts/verify-version-sync.sh
  - workflows/auto-dev.yaml
recommendation: keep as release pipeline gate
```
