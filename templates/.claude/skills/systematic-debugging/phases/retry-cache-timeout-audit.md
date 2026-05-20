# Retry, Cache, Timeout Audit

Use this phase before changing retries, caches, timeouts, pools, backoff, debounce, or rate limits.

## Hard Gate

A retry/cache/timeout change is invalid unless it explains why the original failure happened and proves the new behavior removes the root cause rather than hiding the symptom.

## Audit Questions

1. Is the proposed change reducing visible error rate without proving the failing operation now succeeds?
2. Could it increase load, fan-out, duplicate side effects, or queue latency?
3. Does it make the failure slower and harder to observe?
4. Is the old timeout/cache/retry value actually wrong for the measured dependency behavior?
5. Is there a smaller root-cause fix in input validation, ownership, ordering, or lifecycle?

## Acceptable Evidence

- Before/after traces showing the same request now reaches the intended success path.
- Load or retry-count evidence proving amplification does not increase.
- A failing guard that fails before the root-cause fix and passes after it.

## Rejection Pattern

```text
Rejected: increased timeout/cache/retry | only suppresses the symptom; root cause remains unproven
```
