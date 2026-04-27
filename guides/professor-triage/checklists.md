# Professor Triage Checklists

## Intake

- Issue number, title, labels, URL, and upstream source captured.
- Current open/closed state verified with `gh issue view`.
- Existing duplicate or related issue searched.

## Codebase Evidence

- At least one positive or negative `rg` result supports the decision.
- Relevant tests, templates, and docs were checked when the issue mentions them.
- If the issue is a port ticket, Codex/OMX naming and service-layer differences were considered.

## Decision

- `Close - already resolved`: exact behavior exists and has verification evidence.
- `Close - not applicable`: upstream behavior does not apply to the Codex port.
- `Open - action required`: current code lacks the claimed behavior.
- `Open - monitoring`: external dependency or release condition is not ready.

## Release Planning Handoff

- `verify-done` is used only after triage evidence is current.
- Each actionable issue has priority, size, likely files, and suggested test surface.
- Large epics are split into release units before implementation.

