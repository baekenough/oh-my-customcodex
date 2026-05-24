# Agent Teams Shutdown and tmux Fallback Troubleshooting

This guide ports the old Claude Code shutdown flow into Codex/OMX terms. Use it when an Agent Teams session stops making forward progress during shutdown, cleanup, or handoff.

## Typical Failure Signs

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `TeamDelete` refuses to complete | One or more members are still active | Send a final shutdown request, then retry once |
| Idle notifications repeat without exit | A member saw the request but did not stop | Wait briefly, then fall back to stale-session cleanup |
| The team looks done but the pane is still attached | The worker is still owned by tmux | Reclaim the owned tmux pane or session before declaring cleanup complete |
| Progress stops after a member blocks | The member is waiting on a dependency | Reassign or wait silently instead of polling forever |

## Recovery Order

1. Send one explicit shutdown message to the team member or team lead.
2. Wait for a short, fixed interval.
3. Try `TeamDelete` again.
4. If `TeamDelete` still fails and the session is clearly stale, clean up the owned tmux pane or session.
5. Re-check `.omx/state/` and confirm the active mode is gone.

## Fallback Rules

- Prefer graceful shutdown first: `SendMessage` with a shutdown request, then `TeamDelete`.
- Use tmux fallback only for stale local cleanup, not as the default path.
- Do not kill a pane or session that still contains live user work.
- After fallback cleanup, clear any stale `omx` runtime state that still claims the team is active.

## Codex/OMX Surface Map

| Need | Default surface | Compatibility note |
| --- | --- | --- |
| Ask the team to stop | `SendMessage` | Legacy Claude Code shutdown flows may use analogous `/bg` or background-session signals |
| Remove a finished team | `TeamDelete` | Treat refusal as a state problem, not as permission to spin forever |
| Kill a stale worker pane | OMX-managed `tmux` session or pane | Claude-specific socket names are compatibility-only references |
| Clear lingering session state | `.omx/state/` and related runtime files | Do not rely on the pane alone as the source of truth |

## Example Recovery Sequence

```text
1. SendMessage(team-member, "shutdown request")
2. Wait for the member to stop producing work
3. TeamDelete(team)
4. If TeamDelete still reports active members and the session is stale, kill the owned tmux pane
5. Re-run the state check and confirm no active OMX mode remains
```

## Escalate When

- The pane or session is not owned by the current task.
- Cleanup would interrupt active user work.
- The same stale team keeps reappearing after cleanup.
- A shared infra tmux socket or background process is involved.
