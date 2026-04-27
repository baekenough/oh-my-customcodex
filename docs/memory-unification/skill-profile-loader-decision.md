# Decision: Skill Profile Loader

## Decision

Use static project profiles as the initial skill-profile loading mechanism and reserve memory-derived dynamic profiles for advisory enrichment.

## Rationale

Static profiles are deterministic, reviewable, and easy to diff in release automation. Memory-derived profiles can improve routing, but they are harder to reproduce and can carry stale or sensitive context. The loader should therefore:

1. Load an explicit project profile when present.
2. Merge safe defaults from installed skills.
3. Allow memory-derived hints only as non-authoritative suggestions.

## Contract

- Project profile files must be committed or generated through an explicit command.
- Memory-derived hints must include provenance and must not override disabled skills.
- The loader must be testable without a live memory backend.

## Follow-up

Implement the loader in `src/core` after the profile file schema is documented and init/doctor can validate it.

