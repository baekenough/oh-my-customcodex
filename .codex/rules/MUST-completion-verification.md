# [MUST] Completion Verification Rules

> **Priority**: MUST | **ID**: R020

## Core Rule

Before declaring any task `[Done]`, verify completion against task-type-specific criteria. False completion declarations erode trust and cause downstream failures.

## Task-Type Completion Matrix

| Task Type | REQUIRED Verification Before [Done] |
|-----------|-------------------------------------|
| Release | All issues closed, version bumped, PR merged, GitHub Release created; **External automation verified**: `.github/workflows/` listed AND `gh run list --limit 10` checked for auto-publish workflows |
| Implementation | Code compiles/passes lint, tests pass (if exist), no TODO markers left |
| UI/Frontend | Screenshot or browser smoke evidence collected; text/layout does not overlap at target viewports |
| Documentation | Links valid, counts accurate, cross-references updated |
| Git Operations | Operation succeeded (check exit code), working tree clean |
| Code Review | All findings addressed or explicitly deferred with justification |
| Agent/Skill Creation | Frontmatter valid, referenced skills exist, routing updated |

## Self-Check (Before Declaring Done)

Before [Done]: (1) Verify ACTUAL outcome not just attempt — "ran command" ≠ "succeeded". (2) Check task-type criteria above. (3) No unchecked items. (4) Would bet $100 it's complete.

## Workflow Prompt and Verifier Ground Truth

When a workflow delegates to `agent()` or equivalent subagent calls, complete the full prompt string before the call. Do not append guardrails, fact sheets, or critical constraints to the returned value after the agent has already run.

Verifier lanes must receive the ground-truth sources needed to check cross-cutting claims, especially external URLs, cluster DNS/service names, credentials metadata, release facts, and infrastructure identifiers. A verifier cannot validate a fact that was never provided and is not present in the inspected source.

## Read-Before-Characterize Diagnostics

Do not characterize logs, traces, or diagnostics as an "error loop", "root cause", "flaky test", or similar conclusion before reading the relevant evidence. First capture the observed symptom, then inspect the authoritative log/output/source, then label the failure mode.

For large or noisy logs, read a representative targeted slice before making permanent workflow, rule, template, or release-process changes. If the initial characterization changes after reading, report the correction explicitly.

## Diagnostic Hypothesis Verification

When a failure diagnosis would cause a permanent workflow, rule, template, or release-process change, the diagnosis must be treated as a hypothesis until it is directly verified.

Required steps:

1. Capture the concrete symptom and the proposed root cause separately.
2. Gather direct evidence for the root cause from the authoritative source: command output, CI logs, registry response, source file, or API result.
3. Test or falsify at least one plausible alternative when the change affects shared release or verification infrastructure.
4. Record the verified cause in the commit, issue comment, or release note before merging the permanent change.

Examples:

| Hypothesis | Required evidence before changing shared workflow |
|------------|---------------------------------------------------|
| "npm publish failed because provenance is incompatible" | Registry error details showing provenance rejection, not just an initial `E403` |
| "CI cannot find a file because it is generated locally" | Clean checkout result proving the file is untracked or absent |
| "A test is flaky enough to skip" | Repeated-run evidence plus a tracked fix issue; skip alone is not completion |

### Variant: Parallel Read + Permanent-Change Dispatch

Diagnostic reads and permanent-change dispatches are sequentially dependent. Do not batch diagnostic `Read`/log inspection with issue creation, fix delegation, workflow edits, rule edits, template edits, or release-process changes in the same parallel batch when the write depends on the diagnostic result.

Parallel batches return results together, so a same-batch permanent dispatch proves the hypothesis was treated as confirmed before the evidence was read. R009 parallel execution applies only to independent work; diagnosis → permanent change is not independent.

| Forbidden | Required |
|-----------|----------|
| File `Read` plus an issue or fix instruction based on that file in one parallel batch | Run the diagnostic read first, inspect the result, then dispatch permanent changes in a later step |
| Log inspection in parallel with an issue stating "the cause is X" | Confirm the log evidence before creating or updating the issue |
| Hypothesis-driven workflow/rule/template edits before the authoritative evidence returns | Treat the root cause as unverified until the evidence is available |

Example: do not diagnose `triage-dispatch.yml` from memory, create an issue, and delegate a fix in the same parallel call before reading the workflow. If the read later shows a different root cause, the issue, PR, and commit trail become correction debt even when the eventual code direction is acceptable.

## Degraded-Output Re-Verification Gate

When tool output shows provider instability, buffering, truncation, duplicated chunks, `529`, timeout recovery, or `(no result)` while a permanent action is being considered, treat the current read as degraded. Do not characterize corruption, missing files, stale state, release failure, or data loss from that single degraded read.

Before destructive recovery, issue creation, rule/workflow/template edits, release publication, or fix delegation based on degraded output:

1. Re-read the authoritative source with a deterministic command or API call.
2. Use a second narrow check that can falsify the failure hypothesis, such as `grep -c`, `sort -u`, `git status`, `git show`, `gh api`, or a direct file diff.
3. Record whether the first read was degraded and whether the re-check confirmed or corrected the hypothesis.

If the deterministic re-check cannot run, halt or reduce the action to a non-destructive diagnostic note.

## Workflow Script Sanity Check

Before invoking or registering generated workflow code, run a Tier-1 sanity pass:

1. Search for unresolved placeholders, malformed identifiers, and known dead-line patterns.
2. Assemble the exact script body before execution; do not concatenate facts or guardrails after the call starts.
3. Run the language parser or the narrowest no-side-effect syntax check available.
4. If syntax validation is unavailable, read the generated body back and perform a focused self-review before launch.

This check is mandatory for workflow scripts that will run automation, mutate GitHub state, or gate a release.

## Test-Skip Is Not Completion

Skipping tests, lowering coverage thresholds, narrowing the test command, or marking suites as TODO may be a temporary containment step, but it never satisfies completion by itself.

Before a task can be declared done after a test skip or threshold reduction:

1. The underlying failure must have a linked issue, owner, and reproduction command.
2. The skipped scope must be named precisely, not hidden behind a broad suite skip.
3. The release or PR summary must state that verification is reduced.
4. A follow-up must restore the test or remove the threshold reduction before the related work is considered fully complete.

## Optional: Quantitative Evidence

For agent, skill, or workflow changes, completion evidence MAY include `agent-eval-framework` metrics:

| Metric | Meaning | Gate |
|--------|---------|------|
| `correctness` | Acceptance criteria satisfied | Required if included |
| `step_ratio` | Observed steps vs. ideal steps | Advisory |
| `tool_call_ratio` | Observed tool calls vs. ideal tool calls | Advisory |
| `latency_ratio` | Observed duration vs. ideal duration | Advisory |

These metrics strengthen a `[Done]` claim but do not replace task-specific verification. A failed correctness score blocks completion even if efficiency ratios are good.

<!-- DETAIL: Self-Check box
1. Did I verify ACTUAL outcome? "I ran the command" ≠ "the command succeeded" → YES: Continue / NO: Verify first
2. Does task type have specific criteria? YES: Check each / NO: Apply general verification
3. Any unchecked items? YES: Complete or defer with reason / NO: Proceed to [Done]
4. Would I bet $100 this is truly complete? YES: Declare [Done] / NO: Identify uncertain and verify
-->

## Subagent Self-Report Verification — Verify "pre-existing" claims against base branch before acceptance. See details via Read tool.

<!-- DETAIL: Subagent Self-Report Verification

Subagents often report failures as "pre-existing", "baseline", or "unchanged". These claims MUST be verified against the base branch before acceptance.

| Subagent Claim | Required Verification |
|----------------|----------------------|
| "X test already failing on base" | `git stash && git checkout {base} && run test X && compare` |
| "This warning is pre-existing" | `git log -S "warning-text" {base}` or run on clean checkout |
| "File was unchanged" | `git diff {base}..HEAD -- {file}` |
| "Dependency issue not from this PR" | `git show {base}:package.json` compare |

Never accept "pre-existing" without direct base-branch evidence. A false "pre-existing" claim can mask a regression introduced by the current change.
-->

## Common False Completion Patterns — 7 anti-patterns including "Command executed" without exit code check, "Waiting for manual publish" when CI auto-publishes. See full table via Read tool.

<!-- DETAIL: Common False Completion Patterns

| Pattern | Reality | Fix |
|---------|---------|-----|
| "Command executed" | Exit code not checked | Check `$?` or tool output |
| "File created" | Content not verified | Read file back, verify content |
| "PR created" | CI not checked | Wait for CI, verify green |
| "Issue closed" | Related issues not updated | Check parent epic, cross-refs |
| "Tests pass" | Only ran subset | Run full test suite |
| "Waiting for manual publish" | External CI/CD auto-publishes on merge | Check `.github/workflows/` BEFORE assuming manual step |
| "Subagent said pre-existing" | Claim not verified against base branch | Run test on base branch, compare directly |
| "User interrupted, old plan still continued" | Newer user instruction has priority | Re-rank current work against the newest user message before continuing |
-->

## Interrupt Priority Re-Ordering

When a user sends a new instruction while work is in progress, completion status must be re-evaluated against the newest message before any `[Done]` claim.

1. If the new message conflicts with the old plan, stop or re-route the old plan.
2. If the new message narrows scope, verify only the narrowed scope and report what was left out.
3. If the new message adds a requirement, add it to the completion contract before closing.
4. If no conflict exists, continue but explicitly preserve the new requirement in the next verification pass.

## Completion Contract Format — [Contract] + [Done] with criterion/evidence pairs. See template via Read tool.

<!-- DETAIL: Completion Contract Format

For complex tasks, declare completion contract upfront:

```
[Contract] Task: {name}
├── Criterion 1: {specific, verifiable condition}
├── Criterion 2: {specific, verifiable condition}
└── Criterion N: {specific, verifiable condition}
```

Then at completion:

```
[Done] Task: {name}
├── ✓ Criterion 1: {evidence}
├── ✓ Criterion 2: {evidence}
└── ✓ Criterion N: {evidence}
```
-->

## Autonomous Mode Entry Checklist — 5-step inventory (workflows, runs, publish targets, manual points, cross-reference). See full checklist via Read tool.

<!-- DETAIL: Autonomous Mode Entry Checklist

When entering autonomous mode (user grants extended execution without per-step confirmation), perform this inventory BEFORE first action:

1. **Workflow inventory**: `ls .github/workflows/` — identify auto-publish, auto-tag, release, docs-sync, CI workflows
2. **Recent runs**: `gh run list --limit 10` — check success/failure patterns of automated workflows
3. **External publish targets**: Check if npm/PyPI/Docker Hub/GitHub Releases are auto-triggered on merge
4. **Manual intervention points**: Identify which steps require human approval vs. fully automated
5. **Cross-reference with task**: Which workflows will the planned work trigger?

Record findings in session context. Failure to inventory automation is a R020 violation (unknown external state = unverifiable completion).

### Cross-reference

Related memory records:
- `feedback_github_workflows_inventory.md` — original incident (v0.87.2~v0.88.0 session)
- `feedback_subagent_pre_existing_claims.md` — subagent false-positive pattern
-->

## Integration

| Rule | Interaction |
|------|-------------|
| R003 | [Done] status format now requires verification evidence |
| R010 | Orchestrator verifies subagent completion claims |
| R017 | Structural changes require sauron verification before [Done] |
