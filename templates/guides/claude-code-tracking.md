# Background Agent Progress Tracking

This is the Codex/OMX replacement for the old Claude Code background-agent tracking pattern. Use it when a subagent, team member, or delegated task keeps running while the main conversation moves on.

## What To Track

| Field | Purpose | Suggested source |
| --- | --- | --- |
| `agent_id` | Identify the worker unambiguously | Team member label or agent name |
| `task` | Record what the worker is doing | The delegated prompt or issue title |
| `state` | Show the current lifecycle stage | `queued`, `running`, `blocked`, `done`, `cleaned` |
| `last_update` | Detect stale work | Timestamp from the latest status write |
| `owner` | Tie progress to the current session | Branch, run, or team lead |
| `next_action` | Make the next step obvious | `wait`, `retry`, `cleanup`, or `handoff` |

## Preferred Surfaces

- `.omx/state/` for durable session state.
- `.omx/notepad.md` for lightweight progress notes.
- `.omx/logs/` for execution traces and failure evidence.
- `tracker-checkpoint` when you need a dedicated checkpoint agent to own progress bookkeeping.

## Minimal Progress Loop

1. Register the background task before it starts.
2. Write a start record with the task and owner.
3. Update the state when the worker changes phase.
4. Mark the worker blocked instead of polling forever.
5. Mark the worker done, then clean stale state if anything remains attached.

## Recommended Status Format

```text
agent: tracker-checkpoint
task: mirror rule and guide updates
state: running
last_update: 2026-05-24T12:00:00+09:00
owner: release/v0.5.2-auto-dev
next_action: wait_for_mirror_sync
```

## Staleness Rule

If a background worker stops updating, treat it as stale after a short, defined window. Do not keep polling indefinitely. Either re-plan the task, hand it off, or clean it up.

## Codex/OMX Notes

- The main conversation should read the newest state file, not a stale log excerpt, before deciding what to do next.
- If the worker is a team member, the progress record should make the team lead and branch obvious.
- A background task that has already completed should not keep emitting progress noise.
- Legacy Claude Code background-session references can remain as compatibility notes, but the default progress surface here is `.omx/state/`.
