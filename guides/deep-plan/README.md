# Deep Plan Guide

`deep-plan` turns triaged work into an implementation-ready plan. The skill file should stay small: workflow contract, delegation rules, and sensitive-path guardrails belong inline; long phase detail belongs here.

## Phases

1. Research: collect current repo facts, upstream context, and constraints.
2. Plan: define release units, write ownership boundaries, and identify tests before edits.
3. Verify: challenge the plan against blast radius, sync gates, release gates, and rollback path.
4. Handoff: produce a plan artifact with file scopes, commands, and acceptance criteria.

## Plan Shape

Each release unit should include:

- Issue numbers and user-visible outcome.
- Files/modules likely to change.
- Tests to add before or with implementation.
- Sync surfaces such as `templates/.claude/**`, wiki pages, generated manifests, or lockfiles.
- Release/publish gates that prove completion.

## Guardrails

- Do not group unrelated issues just because they arrived in the same upstream release.
- Do not implement decision/research issues as code until the decision artifact exists.
- Prefer a small release unit that can pass full verification over a broad speculative port.

