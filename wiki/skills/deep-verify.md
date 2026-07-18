---
title: Deep Verify
type: skill
updated: 2026-07-19
sources:
  - .codex/skills/deep-verify/SKILL.md
related:
  - [[release-plan]]
  - [[deep-plan]]
  - [[professor-triage]]
---

# Deep Verify

Multi-angle release quality verification before merge or deployment.

## Overview

Performs comprehensive multi-perspective verification of a release: code quality, test coverage, documentation accuracy, security posture, and release readiness. Parallel reviewers classify findings as HIGH/MEDIUM/LOW, reconcile each finding to one terminal outcome, and gate release readiness.

Every completed run, including clean and blocked runs, writes a schema-versioned artifact to `.codex/outputs/sessions/YYYY-MM-DD/deep-verify-HHmmss.md`. Its JSON frontmatter binds the report to the exact repository, release version, verified 40-character SHA, execution mode, verdict, finding lifecycle, and verification evidence. The helper is resolved beside the currently loaded `deep-verify/SKILL.md`, so source, installed `.agents/skills`, and plugin layouts use the same contract without assuming a fixed skill root.

The release pipeline has one deliberately narrower handoff: `verify-build` materializes the full prepared dirty worktree/index as a verified Git `reviewedTree`, then Rounds 1–7 review the exact `git diff --no-ext-diff --binary develop <reviewedTree>` input and may return a workflow-managed **pending** bundle for the immediately dependent `verification-artifact` step. All six reviewers receive the same tree-bound diff, so uncommitted implementation, version, documentation, and generated changes cannot disappear behind the old `HEAD`. That bundle is not a completed execution, cannot claim `READY`, and is not a schema-versioned final artifact. The finalizer must prove the frozen reviewed tree is unchanged, place the exact release branch, commit only that same tree, inject its exact SHA, and complete `write` → `validate` → exact `select`. Any intervening source change, tree mismatch, or finalizer failure leaves the same deep-verify execution incomplete and blocked. Standalone runs still review their committed branch range and write their artifact immediately before completion.

Writing is collision-safe and fail-closed: symlink, hardlink, FIFO/non-regular, malformed, pre-existing, byte-substituted, or readback-invalid artifacts cannot produce a `READY` result. Critical reads are bounded and correlate path/fd fingerprints before and after use. The session/date directory identity remains pinned across discovery and publication, so a concurrent outside-symlink swap cannot redirect selection or writing. Selection uses frontmatter time plus a lexical tie-breaker, never mtime, and requires exact repository/version/SHA correlation. An undecodable canonical candidate or the newest relevant malformed candidate blocks fallback to older evidence.

The supported execution modes are `standard`, `docs-only-self-review`, `lite-deterministic`, and `converged-substitution`. Reduced and substituted runs retain their actual scope in `verificationEvidence`; conversation-only prose is not a producer result. [[post-release-followup]] consumes only the exact selected artifact and joins unresolved outcome references back to their initial severity.

## Key Details

- **Scope**: core
- **User-invocable**: yes
- **Command**: `$deep-verify` (Codex/OMX); `/deep-verify` (Claude compatibility)
- **Effort**: not specified
- **Artifact**: `.codex/outputs/sessions/YYYY-MM-DD/deep-verify-HHmmss.md`
- **Selector keys**: repository + semantic release version + exact verified SHA
- **Pipeline handoff**: pending Rounds 1–7 evidence is pinned to `reviewedTree` and becomes complete only in the immediately dependent same-tree commit-and-artifact finalizer

## Relationships

- **Used by agents**: orchestrator
- **Related skills**: [[release-plan]], [[professor-triage]], [[post-release-followup]], [[multi-model-verification]]
- **See also**: [[R020]]

## Sources

- `.codex/skills/deep-verify/SKILL.md` — skill definition
