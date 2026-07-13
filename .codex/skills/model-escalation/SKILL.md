---
name: model-escalation
description: Advisory model escalation based on task outcome tracking
scope: core
user-invocable: false
---

# Model Escalation Skill

Tracks task outcomes and advises reasoning-effort changes when failures are detected. **Advisory-only** — the orchestrator makes the final decision (R010), and OMX remains the owner of concrete model resolution.

## Escalation Path

```
none → minimal → low → medium → high → xhigh → ultra → max
```

## Trigger Conditions

| Condition | Action |
|-----------|--------|
| 2+ failures with same effort for same agent type | Advise escalation |
| 3+ consecutive failures across any agent type | Advise global escalation |
| Sustained success after escalation | Advise de-escalation |

## Thresholds

| Parameter | Default | Description |
|-----------|---------|-------------|
| `failure_threshold` | 2 | Failures before escalation advisory |
| `consecutive_threshold` | 3 | Consecutive failures for global advisory |
| `cooldown_tasks` | 5 | Successes before de-escalation advisory |

## Cost Guard

- Advisory identifies the next supported reasoning effort
- De-escalation suggested after sustained success at higher tier
- Outcomes are tracked per session via a PPID-scoped temp file

## Architecture

```
PostToolUse (Task) → task-outcome-recorder.sh
  Records: agent_type, model_reasoning_effort, success/failure, error_summary
  Storage: /tmp/.codex-task-outcomes-$PPID (JSON lines, max 50)

PreToolUse (Task) → model-escalation-advisor.sh
  Reads outcomes → counts failures → advises escalation via stderr
  Advisory only — never blocks, never modifies tool input
```

## Advisory Format

```
--- [Model Escalation Advisory] ---
  Agent type: {agent_type}
  Current effort: {current_effort}
  Recent failures: {count}/{threshold}
  Recommended effort: {next_effort}
  Concrete model: resolved by the active OMX runtime
---
```

The advisor must not rewrite a concrete model ID. If the active model does not support the recommended value, the orchestrator chooses the nearest supported effort from the generated runtime model table.
