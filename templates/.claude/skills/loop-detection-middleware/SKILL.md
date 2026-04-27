---
name: loop-detection-middleware
description: Detect repeated errors, same-file edit loops, and repeated tool-target calls before continuing
scope: harness
user-invocable: true
argument-hint: "[--review-log <path>] [--threshold N]"
effort: medium
version: 1.0.0
---

# Loop Detection Middleware

## Purpose

Detect doom-loop patterns in agent work and force a re-plan before more edits or tool calls compound the same failure.

This is an advisory middleware skill. It does not replace tests, R020 completion verification, or `systematic-debugging`; it tells the agent when the current execution pattern is no longer producing new evidence.

## Signals

| Signal | Default threshold | Response |
| --- | --- | --- |
| Same error text or hash repeats | 3 consecutive occurrences | Stop retrying and run root-cause analysis |
| Same file edited repeatedly | 3 edits without passing verification | Inspect diff and write a smaller plan |
| Same tool and target repeats | 3 identical calls | Change retrieval strategy or summarize what is missing |
| Tool family spam | 5 calls in the last 8 actions | Batch the remaining reads or narrow the query |

## Review Procedure

1. Inspect recent tool calls, test output, or session log.
2. Count repeated error, file, and tool-target patterns.
3. If a threshold is met, emit a loop warning with:
   - signal
   - repeated pattern
   - occurrence count
   - missing evidence
   - next recovery action
4. Require a re-plan before the next edit or retry.

## Output Contract

```text
[LOOP-DETECTION] Signal: repeated-error
Pattern: TypeError: cannot read property ...
Occurrences: 3 consecutive
Missing evidence: no new stack frame or failing assertion was collected
Recovery: stop retrying the same test; inspect the call site and add a targeted regression case
```

## Recovery Actions

| Loop type | Recovery |
| --- | --- |
| Repeated error | Switch to `systematic-debugging`; identify first failing boundary |
| Edit loop | Read the current diff, state the intended invariant, then edit once |
| Tool-target loop | Summarize known facts and issue a narrower query |
| Completion loop | Re-run the exact verification command and compare to R020 criteria |

## Integration

- Use before the third retry in `ralph`, `pipeline`, or long `autopilot` runs.
- Pair with `pre-generation-arch-check` when repeated edits suggest a wrong boundary.
- Feed confirmed loop patterns into `adaptive-harness --learn`.
- Preserve repeated passing fixes as harness-engineering regression cases.

## Non-Goals

- No hard blocking unless a hook explicitly opts into enforcement.
- No deletion of tests to escape a loop.
- No replacement for release verification.
