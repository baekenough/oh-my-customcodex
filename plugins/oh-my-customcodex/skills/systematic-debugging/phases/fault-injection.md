# Fault Injection Phase

Use this phase when a fix claims resilience against dependency failure, network failure, timeout, cancellation, corrupt input, clock skew, partial writes, or process restart.

## Preconditions

- The injected fault is bounded to local, test, or staging scope.
- The expected behavior is written before running the injection.
- Rollback is known and immediate.

## Procedure

1. State the fault and predicted behavior.
2. Inject the smallest fault that exercises the claim.
3. Record logs, exit code, response, retries, and cleanup behavior.
4. Remove the fault and verify recovery.
5. Convert the injection into a repeatable test when practical.

## Output

```text
Fault Injection:
- Fault:
- Prediction:
- Injection method:
- Observed behavior:
- Recovery:
- Verdict: {claim proven | claim rejected | more instrumentation needed}
```

Do not run destructive or production fault injection without explicit authority.
