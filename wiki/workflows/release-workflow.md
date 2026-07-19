---
title: Release Workflow
type: workflow
updated: 2026-07-19
sources:
  - workflows/auto-dev.yaml
  - .codex/skills/pipeline/workflows/auto-dev.yaml
  - .codex/rules/MUST-completion-verification.md
  - .codex/rules/MUST-sync-verification.md
related:
  - [[development-workflow]]
  - [[quality-workflow]]
  - [[wiki/rules/r017]]
  - [[wiki/rules/r020]]
  - [[wiki/agents/mgr-gitnerd]]
  - [[wiki/agents/mgr-sauron]]
---

# Release Workflow

Releases follow a structured Codex/OMX pipeline from issue triage through registry publication and direct post-release verification. Independent work is delegated when that improves throughput; the leader owns integration, mutation evidence, and final verification.

## Overview

A release progresses through preflight → triage/scope → planning → implementation → local release preparation → build verification/final-tree freeze → deep verification pending handoff → local release-branch commit and exact-SHA artifact → push/PR/merge → publication/R020 → merge-SHA artifact → followup. The `professor-triage`, `release-plan`, `deep-plan`, `deep-verify`, and `post-release-followup` skills support these phases, while `auto-dev.yaml` is the executable workflow contract.

Preflight synchronizes refs and tags, rejects a dirty-behind worktree, and requires `omcustomcodex doctor --require-shell-advisor`. Missing managed hook assets may use `omcustomcodex update --hooks`; modified registry or script bytes require review and backup before the explicit `--force-overwrite-all` restoration path. An inactive result requires both supported user-level feature enablement and project trust plus `/hooks` review, because an untrusted linked worktree may appear inactive. Approval remains manual—automation never writes trust state.

## Phase 1: Professor Triage

`$professor-triage` (`/professor-triage` in Claude compatibility sessions) analyzes open GitHub issues against the current codebase state. It cross-references issue labels, analyzer comments, and current code to classify issues as:
- **verify-done**: ready for release
- **needs-work**: requires additional implementation
- **blocked**: external dependency pending

## Phase 2: Release Planning

`$release-plan` groups verified/eligible issues into coherent release units with a consistent version target and test shape.

Output: a structured release plan with issue groupings, version number, and implementation sequence.

## Phase 3: Implementation Planning (deep-plan)

`$deep-plan` runs a research → plan → verify cycle for each release unit:
1. Research phase: parallel analysis of affected code areas
2. Plan phase: implementation steps with dependency ordering
3. Verify phase: plan validation against codebase state

## Phase 4: Implementation

Development work proceeds via the [[development-workflow]]. For release-sized changes, Agent Teams is typically required (multiple agents, review cycles).

## Phase 5: Verification (deep-verify)

`$deep-verify` runs multi-angle quality verification:
- Code correctness (compilation, tests)
- Documentation accuracy (counts, links, cross-references)
- Release criteria completeness (all issues addressed)

Before verification, `release-prepare` resolves the target and finalizes every intended version, changelog, documentation, template, and generated source change without a commit. `verify-build` reads back only explicitly allowlisted generated outputs, runs the blocking Wiki drift gate before freeze, then materializes the complete final dirty worktree/index through a private temporary index as a verified Git `reviewedTree` without changing the real index. Pipeline-deferred deep-verify passes the exact binary diff from `develop` to that tree unchanged to all six reviewers; it cannot substitute the old `HEAD` or omit uncommitted content. Any later source-scope change requires a new acyclic preparation/verification run.

Every standard or reduced verification path must finish with one schema-versioned artifact under `.codex/outputs/sessions/YYYY-MM-DD/`. In the release DAG, Rounds 1–7 return an incomplete pending bundle pinned to `reviewedTree`; it is not `READY` and is not a final artifact. The immediately dependent `verification-artifact` step places the exact release branch, stages exactly that reviewed tree, creates the local Lore commit, proves both staged and committed trees equal it, injects the exact commit SHA, and completes helper `write`, `validate`, and exact repository/version/SHA `select`. A changed tree or failed finalizer leaves deep-verify incomplete and blocked. Standalone deep-verify executions still write immediately before completion. Missing, malformed, stale, wrong-SHA, or undecodable canonical evidence fails closed; conversation prose is not a producer result.

Code Mode command gates consume the nested tool result's numeric `exit_code` and poll active sessions to a terminal result. They do not infer success from stdout or append reserved shell-variable probes.

### R017 Sauron Verification

If the release includes structural changes (new agents, skills, guides), `mgr-sauron:watch` must pass before any push. The full verification protocol:

```
Phase 1: 5 manager rounds (mgr-supplier:audit + mgr-updater:docs + mgr-claude-code-bible:verify)
Phase 2: 3 deep review rounds (workflow alignment, reference integrity, philosophy compliance)
Phase 3: Fix all discovered issues
Phase 4: Commit via mgr-gitnerd
Phase 5: Push via mgr-gitnerd (only after sauron passes)
```

## Phase 6: Release Execution

The release unit has already resolved its target and synchronized `package.json`, `templates/manifest.json`, generated plugin metadata, changelog, documentation, and source lockfile during local preparation. After R017/deep-verify reviews, `verification-artifact` creates the only local source commit on `release/v<version>` and proves its tree exactly matches the reviewed tree. The later `release` step does not change source or create another commit: it reads back the artifact identity, pushes that immutable commit, opens a PR with explicit closing references, and merges only after the exact `headRefOid` matches the verified SHA and the full check rollup is green. The same-repository-only `Deploy Test with Verdaccio` job checks out and verifies the immutable PR head SHA rather than GitHub's synthetic merge ref. Older rerun history is allowed, while an absent or non-successful latest run blocks the merge; the final `gh pr merge` also uses `--match-head-commit` so any concurrent head change fails closed.

Repository automation—not the local agent—creates the annotated version tag at the merge SHA. The tag-triggered Release workflow publishes both `oh-my-customcodex` and `@baekenough/oh-my-customcodex`, creates the GitHub Release, and uploads verification evidence. Tags are never manually created, moved, or replaced. The pipeline alone owns remote release-ref deletion after bounded authoritative MERGED readback; Auto Tag never deletes the branch. Polling uses explicit Bash, exclusive temporary projections, and bounded retries.

## Phase 7: Post-Release Followup

After publication and CI readback, `post-release-verification-artifact` re-verifies the immutable merge and writes a new merge-SHA artifact rather than relabeling or reusing the pre-merge artifact. `$post-release-followup` selects that exact evidence, joins unresolved finding references to their original severity, and registers genuine defect/process/coverage gaps. Missing or malformed Source B evidence blocks aggregation instead of masquerading as a clean release. Homework then audits the iteration before FSD re-enumerates eligible work.

## Completion Verification (R020)

Per [[wiki/rules/r020]], a release is only `[Done]` when:

| Criterion | Verification |
|-----------|-------------|
| Exact release identity | Annotated tag peels to the PR merge SHA |
| Both registries published | Exact version, package identity, and parity verified from npm and GitHub Packages |
| GitHub Release/evidence | Non-draft release plus downloaded checksum evidence verified |
| Installability | Clean isolated consumers pass lifecycle and packaged-contract smoke checks |
| Lifecycle convergence | Issues and milestone closed; remote release branch deleted |
| Verification handoff | Merge-SHA deep-verify artifact validates and exact selection succeeds |

## Relationships

- **Depends on**: [[quality-workflow]] (R017 verification), [[wiki/agents/mgr-gitnerd]] (git ops), [[wiki/rules/r020]]
- **Used by**: Every version release
- **See also**: [[development-workflow]], [[wiki/agents/mgr-sauron]]

## Sources

- `workflows/auto-dev.yaml` — canonical source workflow
- `.codex/skills/pipeline/workflows/auto-dev.yaml` — packaged plugin workflow
- `.codex/rules/MUST-completion-verification.md` — R020 release criteria
- `.codex/rules/MUST-sync-verification.md` — R017 verification phases
