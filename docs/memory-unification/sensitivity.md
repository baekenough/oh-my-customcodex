# Memory Sensitivity Policy

Memory systems amplify mistakes because saved content is reused across sessions. Every normalized memory record must carry a sensitivity level before it is persisted or exposed through MCP.

## Levels

| Level | Meaning | Allowed exposure |
| --- | --- | --- |
| `public` | Safe documentation or public repo facts. | Search, summaries, docs. |
| `project` | Repo-specific operational knowledge without secrets. | Project-scoped agents and summaries. |
| `sensitive` | Private operational detail, internal incidents, or user preference detail. | Retrieval only when the current task needs it. |
| `secret` | Tokens, credentials, private keys, session cookies, or raw personal data. | Do not persist; redact and emit a rejection reason. |

## Adapter Requirements

- Default to `project` when a source has no sensitivity metadata.
- Promote to `sensitive` when content mentions private infrastructure, incident details, user behavior profiles, or non-public customer data.
- Reject or redact `secret` content before persistence.
- Preserve adapter provenance so a bad record can be traced and removed.

## MCP Exposure

MCP search/read tools should return `public` and `project` records by default. `sensitive` records require an explicit task-local reason. `secret` records must never be returned because they should not be stored.

