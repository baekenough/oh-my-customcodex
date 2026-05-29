# Memory Unification Schema

The memory unification layer normalizes records from native `MEMORY.md`, approved searchable memory backends, episodic-memory, and future project memory stores into one append-friendly shape.

## `MemoryRecord`

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Stable source-local id when available, otherwise a generated content hash. |
| `source` | yes | `native`, `searchable-memory`, `omx-memory`, `episodic-memory`, or a future adapter id. |
| `scope` | yes | `user`, `project`, or `local`. |
| `kind` | yes | `behavior`, `decision`, `fact`, `summary`, `task`, or `artifact`. |
| `content` | yes | Human-readable normalized memory text. |
| `contentHash` | yes | SHA-256 over normalized source, scope, kind, and content. |
| `sensitivity` | yes | `public`, `project`, `sensitive`, or `secret`. |
| `project` | no | Project or repository name when known. |
| `sessionId` | no | Session/rollout id that produced the record. |
| `tags` | no | JSON array of routing/search tags. |
| `metadata` | no | JSON object with adapter-specific fields. |
| `createdAt` | yes | Original creation time or ingestion time. |
| `updatedAt` | no | Last observed update time from the source. |

## Storage Contract

The first persistent table is `memory_records`. It stores normalized text plus enough provenance to deduplicate across adapters and audit where a record came from. Adapters must never discard original source identifiers when they are available.

## Deduplication

Records are deduplicated by `contentHash`. When two sources provide the same normalized content, the persistence service keeps the first record and may merge metadata in a future migration. Deduplication must not collapse records that differ only by sensitivity.

