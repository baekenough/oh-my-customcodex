# Amplification Detection Phase

Use this phase when the failure may cascade: retries, queues, background jobs, fan-out calls, polling loops, webhook delivery, cron overlap, or connection pools.

## Required Checks

1. Identify the trigger that starts the loop or fan-out.
2. Count how many downstream operations one failing input can create.
3. Check retry/backoff behavior and whether retries duplicate side effects.
4. Check queue depth, worker concurrency, pool limits, and timeout alignment.
5. Verify cancellation, dedupe, idempotency, and dead-letter behavior.

## Output

```text
Amplification:
- Trigger:
- Fan-out factor:
- Retry behavior:
- Shared limit affected:
- Dedupe/idempotency:
- Verdict: {amplification present | no amplification evidence}
```

If amplification is present, stop widening retries or capacity until the loop has an owner and a guard.
