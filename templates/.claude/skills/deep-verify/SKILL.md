---
name: deep-verify
description: Multi-angle release quality verification using parallel expert review teams
scope: core
version: 1.2.0
user-invocable: true
effort: high
---

# /deep-verify — Multi-Angle Release Quality Verification

## Purpose

Performs deep cross-iterative verification of code changes before release, using multiple independent review perspectives to catch issues that single-pass review misses.

## Usage

```
/deep-verify [branch|PR]
```

If no argument, verifies current branch against its base (usually `develop`).

## Workflow

### Round 1: Baseline Assessment
- Gather the full diff (`git diff develop...HEAD`)
- Run test suite, lint, and type check
- Collect results as baseline

### Round 2: Parallel Expert Review (6 agents)
Spawn 6 parallel review agents, each with a different focus:

1. **Correctness Reviewer** — Logic errors, edge cases, off-by-one, null handling
2. **Security Reviewer** — Injection, auth bypass, data exposure, OWASP top 10
3. **Performance Reviewer** — O(n^2) loops, unbounded queries, memory leaks, missing indexes
4. **Integration Reviewer** — API contract breaks, migration safety, cross-module side effects
5. **Philosophy Reviewer** — Project concept/metaphor alignment, separation of concerns (R006), orchestrator rules (R010), advisory-first enforcement (R021), compilation metaphor integrity
6. **Regression & Performance Reviewer** — Feature regression risk, API contract preservation, query performance impact, index effectiveness, algorithm complexity at realistic scale

Each agent receives the full diff and returns findings as structured JSON:
```json
{
  "severity": "HIGH|MEDIUM|LOW",
  "file": "path/to/file",
  "line": 42,
  "finding": "description",
  "suggestion": "fix suggestion"
}
```

### Round 3: Cross-Verification
- Merge all findings from Round 2
- Deduplicate (same file+line+similar finding = 1 entry)
- Assign each unique initial finding one stable id (`DV-001`, `DV-002`, ...). Keep
  that id unchanged through false-positive, fixed, or unresolved disposition.
- For each HIGH finding: spawn a verification agent to confirm or dismiss as FALSE POSITIVE
- Evidence-based: each confirmation must include proof (e.g., `toQuery()` output, test result)

### Round 4: FALSE POSITIVE Filter
- Remove confirmed false positives with evidence
- Remaining findings are CONFIRMED issues

### Round 5: Fix Application
- For each CONFIRMED HIGH/MEDIUM finding: spawn fix agent
- Run tests after fixes
- If tests fail: revert fix, report as "needs manual review"

### Round 6: Final Verification
- Re-run full test suite
- Re-run lint and type check
- Generate summary report

### Round 7: Philosophy & Regression Gate
- Verify all changes align with project's compilation metaphor (Skills=source, Agents=artifacts, Rules=spec)
- Check separation of concerns: no agents containing skill logic, no skills with agent definitions
- Verify orchestrator rules: no new file writes from orchestrator context
- Verify sensitive-path compatibility: prompts that touch `.claude/**`, `.claude/outputs/**`, or `templates/.claude/**` include the `Sensitive-path compatibility note`, keep `.codex/**` artifacts on the normal file-write path, and treat `/tmp/{skill}-{timestamp}.md` only as a legacy fallback for older Claude Code versions or sessions that still prompt
- Check advisory-first: no new hard-blocking hooks introduced
- Confirm no feature regressions: existing APIs preserved, test coverage maintained
- Performance sanity: no O(n^2) on large datasets, no missing indexes for new queries
- If any CONCERN or VIOLATION found: report for manual review before release

### Round 8: Durable Artifact Gate

Every completed execution writes one artifact, including executions with zero
findings and executions whose verdict is `NEEDS REVIEW` or `BLOCKED`:

```text
.codex/outputs/sessions/YYYY-MM-DD/deep-verify-HHmmss.md
```

Resolve the helper from the actual path of the currently loaded `SKILL.md`.
Never infer the skill root from `$PWD`, assume a `.codex` or `.agents` layout,
or hardcode a plugin cache path:

1. Take the runtime-provided absolute path of this currently loaded `SKILL.md`
   as `loaded_skill_file`.
2. Set `skill_dir` to `dirname(loaded_skill_file)`.
3. Set `artifact_helper` to the normalized sibling path
   `join(skill_dir, "scripts/artifact-contract.mjs")`.
4. Require that exact path to be a regular, non-symlink file. Missing or unsafe
   helper discovery fails closed; do not search another skill root or fall back
   to a source checkout.

This one sibling rule works unchanged for source, clean-installed
`.agents/skills`, and plugin `skills` layouts.

Create an exclusive temporary JSON input containing exactly `artifact` and
`body`, then invoke the writer without interpolating finding text into a shell
command:

```bash
node "$artifact_helper" write \
  --project-root "$PWD" \
  --input "$input_file"
```

The writer creates the canonical session directory safely, uses a same-directory
exclusive temporary regular file, atomically publishes without replacement,
and performs a bounded, nonblocking regular-file readback. It correlates the
open descriptor with pre/post path fingerprints and requires the staged and
published bytes to equal the serialized artifact exactly. Directory operations
are serialized, cwd-relative operations on verified directory inodes; the
ancestry is rechecked before publication commits and after unwind, and the
caller's cwd is restored on both success and failure. A symlink, non-regular
entry, inode/ancestry change, or incomplete readback fails closed and rolls back
only when the path still identifies the exact staged inode. Validate the
returned path again before handoff:

```bash
node "$artifact_helper" validate \
  --file "$artifact_path"
```

The frontmatter between `---` delimiters is one actual JSON object (valid
JSON-compatible YAML), never free-form YAML. Schema version 1 requires:

```json
{
  "schemaVersion": 1,
  "skill": "deep-verify",
  "date": "2026-07-19T01:23:45+09:00",
  "query": "release/v1.0.28",
  "repository": "baekenough/oh-my-customcodex",
  "releaseVersion": "1.0.28",
  "verifiedSha": "0123456789abcdef0123456789abcdef01234567",
  "executionMode": "standard",
  "verdict": "READY",
  "findings": {
    "initial": [],
    "falsePositives": [],
    "fixed": [],
    "unresolved": []
  },
  "verificationEvidence": [
    {
      "gate": "focused tests",
      "outcome": "pass",
      "reference": "bun test: 12 pass, 0 fail"
    }
  ]
}
```

`findings.initial` contains the full finding objects (`id`, `severity`, `file`,
`line`, `summary`, and `evidence`). Each terminal bucket
contains only outcome references shaped as `{ "findingId", "reason",
"evidence" }`. Every initial id appears once in `initial` and exactly once in
one of `falsePositives`, `fixed`, or `unresolved`; an id appearing in initial and
its one terminal bucket is the intended lifecycle, not a duplicate.

`executionMode` is exactly one of `standard`, `docs-only-self-review`,
`lite-deterministic`, or `converged-substitution`. Reduced modes must record the
gates actually run, and a converged substitution must select an existing exact
repository/release/SHA artifact rather than relabel old evidence.

`verificationEvidence` contains at least one gate entry. Its outcome is exactly
`pass`, `fail`, or `not-run`, so an unexecuted gate cannot be presented as a
passing gate.

The Markdown body is a human report and includes the helper-owned
`deep-verify-counts` marker. It cannot replace the structured frontmatter.
Never record credential values, complete environment dumps, or unredacted
secret-bearing command output.

Artifact persistence is a release gate. If `artifact-contract.mjs write`, its
readback, or `artifact-contract.mjs validate` fails, the execution fails closed:
`READY` is forbidden, the displayed verdict becomes `NEEDS REVIEW` or
`BLOCKED`, and the release workflow stops. A conversation-only report is not a
completed deep-verify result.

### Pipeline-deferred finalization

For a normal standalone run, the review target remains the current committed
branch range described in Round 1 (`git diff develop...HEAD`). Pipeline-deferred
review is different: `verify-build` must first freeze the exact worktree/index
content into `reviewedTree`, a 40-character lowercase hexadecimal Git object id,
and that object must be a tree. Verify both properties before review:

```bash
git cat-file -e "$reviewedTree^{tree}"
test "$(git cat-file -t "$reviewedTree")" = tree
git diff --no-ext-diff --binary develop "$reviewedTree"
```

The exact full `git diff --no-ext-diff --binary develop "$reviewedTree"` output
and the tree/object verification result must be passed unchanged to all six reviewers.
Every pending handoff bundle pins the same `reviewedTree`; a deferred
reviewer must never substitute the live dirty worktree, omit uncommitted
content, or fall back to `HEAD`/`git diff develop...HEAD`. Deferred Rounds 1–7
must not mutate the frozen tree. If a confirmed finding requires a fix, halt and
start a new acyclic pipeline run that freezes a new `reviewedTree`; any drift
invalidates the pending bundle and is `BLOCKED`. A missing id, a non-40hex id,
or an invalid or non-tree object is also `BLOCKED`.

The `auto-dev` pipeline may run Rounds 1–7 while the release preparation tree is
still dirty and before the exact release commit SHA exists. That output is a
pending handoff for the same deep-verify execution, not a completed execution:
do not claim `READY`, emit a canonical completed artifact, or invent a fifth
`executionMode` for this state.

Only the later `verification-artifact` finalizer may complete that pending
execution. It first verifies branch placement, creates the required Lore commit,
and resolves the exact committed SHA. The finalizer must prove
`git rev-parse "$final_sha^{tree}"` equals the pinned `reviewedTree`; it may
commit only that same tree. It then writes the same execution's artifact and
successfully performs `write` -> returned JSON path parsing -> `validate` ->
exact repository/release/SHA `select`. Only after every step succeeds is the
execution completed and eligible for `READY`. A tree mismatch, failed finalizer,
or handoff before finalization remains `NEEDS REVIEW` or `BLOCKED` and cannot be
represented as successful durable evidence.

In short: artifact failure forces `NEEDS REVIEW` or `BLOCKED`, never `READY`.

Before compaction or a session handoff, persist and read back the artifact and
record its selected path plus repository, release version, and verified SHA in
handoff state. `.codex/outputs/` remains ignored runtime evidence; do not commit
the artifact.

## Output Format

```
╔══════════════════════════════════════════════════════╗
║  Deep Verification Report                            ║
╠══════════════════════════════════════════════════════╣
║  Branch: {branch}                                    ║
║  Commits: {count}                                    ║
║  Files changed: {count}                              ║
╠══════════════════════════════════════════════════════╣
║  Findings:                                           ║
║    HIGH:   {n} ({confirmed} confirmed, {fp} FP)      ║
║    MEDIUM: {n} ({confirmed} confirmed, {fp} FP)      ║
║    LOW:    {n}                                       ║
╠══════════════════════════════════════════════════════╣
║  Fixes Applied: {n}                                  ║
║  Tests: {pass}/{total} passing                       ║
║  Verdict: READY / NEEDS REVIEW / BLOCKED             ║
║  Philosophy: ALIGNED / {n} CONCERNS                  ║
║  Regression: CLEAN / {n} RISKS                       ║
╚══════════════════════════════════════════════════════╝
```

## Notes

- Round 2 agents use `model_lane: frontier, model_reasoning_effort: medium` for cost efficiency
- Round 3 verification agents use `model_lane: frontier, model_reasoning_effort: high` for reasoning depth
- FALSE POSITIVE filtering is critical — previous releases showed 80%+ FP rate on automated review
- This skill replaces ad-hoc cross-verification with a repeatable process
- Round 7 philosophy check references AGENTS.md architecture section and R006/R010/R021 rules
- Regression check compares function signatures, export lists, and test counts against develop baseline
