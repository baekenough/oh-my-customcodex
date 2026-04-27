# Professor Triage Guide

Keep detailed issue-triage phases outside `professor-triage/SKILL.md` while preserving inline guardrails in delegated prompts.

## Scope

- Analyze GitHub issues against the current codebase.
- Classify issues as resolved, not applicable, duplicate, monitoring, or action required.
- Produce evidence for release planning.
- Preserve the sensitive-path artifact protocol for `.claude/**` and `templates/.claude/**`.

## Phases

1. Intake issue state, labels, upstream references, and current body.
2. Search current code, tests, templates, and docs for evidence.
3. Assess release or automation risk.
4. Decide action, priority, and size.
5. Write a session artifact.
6. Update GitHub only after attaching evidence.

