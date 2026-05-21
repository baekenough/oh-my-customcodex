# Timeline Correlation Phase

Use this phase when a failure has a meaningful time dimension: deployment time, config change time, traffic shift, data import, queue spike, cron run, dependency incident, or first customer report.

## Required Steps

1. Record the incident window in UTC and local time if available.
2. List code, deploy, config, data, dependency, and traffic events around that window.
3. Mark each event as before, during, or after first failure.
4. Prefer events that happened before the first failure and changed the failing path.
5. Write one falsifiable hypothesis that connects timing evidence to the symptom.

## Output

```text
Timeline:
- First failure:
- Code/deploy events:
- Config/data/dependency events:
- Traffic or cron events:

Hypothesis:
<single root-cause hypothesis tied to the timeline>
```

Do not patch from chronology alone. Use the timeline to choose the next evidence-gathering step.
