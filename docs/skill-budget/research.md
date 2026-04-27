# Skill Context Budget Research

## Question

Should skill loading use static project profiles, memory-derived dynamic profiles, or both?

## Findings

Static project profiles are the safer default for release automation. They are deterministic, can be reviewed in pull requests, and do not depend on a live memory backend. They also let `init`, `doctor`, and pipeline verification explain exactly why a skill was loaded.

Memory-derived dynamic profiles are useful for ranking and reminders, but they introduce drift. A stale memory record can over-select old skills, and a sensitive memory record can leak context into unrelated tasks if filtering is weak.

## Recommendation

Use a hybrid design:

- Static profile: authoritative allowlist, denylist, and budget limits.
- Memory hints: advisory ranking signals with provenance.
- Runtime cap: enforce a visible byte/token budget before spawning forked agents.

## Measurement Plan

Track three metrics per pipeline phase:

- Visible bytes loaded from skill bodies.
- Number of forked agents that received each skill.
- Completion quality/regression outcome for the phase.

This makes token-savings work measurable without making memory a hard dependency.

