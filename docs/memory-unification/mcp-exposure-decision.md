# Decision: Memory MCP Exposure

## Decision

Expose unified memory through a dedicated memory MCP surface after the eval-core persistence API is stable. The first interface should be read-only: `memory_search`, `memory_read`, and `memory_sources`.

## Rationale

- A dedicated MCP boundary keeps memory retrieval separate from ontology routing.
- Read-only exposure avoids letting agents mutate durable memory through an unreviewed tool path.
- `eval-core` can own normalization, deduplication, and persistence without also owning runtime transport concerns.

## Rejected Options

- Extend `ontology-rag` with memory tools: rejected because ontology routing and behavioral memory have different freshness, sensitivity, and deletion requirements.
- Write directly to native `MEMORY.md` from MCP: rejected because native memory should remain a compact index, not the canonical aggregate store.

## Follow-up

Create `packages/memory-mcp-server` only after `memory_records` ingestion and sensitivity filtering have tests.

