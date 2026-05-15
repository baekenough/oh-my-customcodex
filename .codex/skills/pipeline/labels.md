# Pipeline Label Standards

Canonical reference for GitHub issue label semantics in the auto-dev pipeline.
Used by `scope-selection` to include or exclude issues and by `implement` for lifecycle management.

## Label Definitions

| Label | Meaning | scope-selection handling |
|-------|---------|--------------------------|
| `verify-ready` | Triage complete, ready for verification or automation | INCLUDE (preferred) |
| `verify-done` | Triage complete but deferred, already handled, or excluded from this cycle | EXCLUDE |
| `in-progress` | Work is claimed by another session | EXCLUDE |
| `needs-review` | Human review is required before automation | EXCLUDE |
| `decision-needed` | Security, policy, or product decision required | EXCLUDE |
| `automated` | Auto-generated issue from release-monitor tooling | INCLUDE if other criteria match |
| `codex-release` | Codex release monitor trigger | INCLUDE (preferred) |
| `oh-my-codex-release` | oh-my-codex release monitor trigger | INCLUDE (preferred) |
| `claude-code-release` | Claude compatibility release trigger | INCLUDE (preferred) |
| `documentation` | Documentation-only scope | INCLUDE (preferred for docs-only release) |
| `enhancement-yaml-only` | YAML/config-only scope change | INCLUDE (eligible for docs-only compression) |

## Selection Rule

```text
EXCLUDE if:
  - blocked_by_decision == true
  - labels intersect {decision-needed, needs-review, verify-done, manual-action, in-progress}

INCLUDE (preferred tier):
  - labels intersect {verify-ready, codex-release, oh-my-codex-release, claude-code-release, documentation}

INCLUDE (standard tier):
  - P1/P2/P3 issues not in excluded set

Tie-break priority: P1 > P2 > P3 > unclassified
```

## Compression Eligibility

An issue is eligible for `docs-only` compression mode if its labels include at least one of:
`documentation`, `automated`, `codex-release`, `oh-my-codex-release`, `claude-code-release`, `enhancement-yaml-only`.

If all scoped issues are compression-eligible and scope size is 3 or fewer, the pipeline may use
`compression_mode=docs-only` and replace heavyweight triage, planning, and verification spawns with
direct manifest summaries plus a local self-review checklist.

## Lifecycle Labels

| Transition | Action |
|------------|--------|
| Work started | Add `in-progress`, assign the current operator |
| Work succeeded | Remove `in-progress`, add `verify-ready` |
| Work failed | Remove `in-progress`, add `needs-review` |
| Released | Remove `verify-ready`, close with `Fixed in v{version}` |
| Deferred | Add `verify-done`, label `Deferred from v{version}` |
