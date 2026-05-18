---
name: memory-save
description: Save current session context to native memory plus omx-memory or AgentMemory-compatible backends
scope: core
argument-hint: "[--tags <tags>] [--include-code]"
disable-model-invocation: true
user-invocable: true
---

# Memory Save Skill

Save current session context to native memory and the configured searchable MCP backend for persistence across context compaction. Prefer AgentMemory-compatible or `omx-memory` tools (`memory_add`, `observation_add`); fall back to legacy `claude-mem` only when that is the configured backend.

## Options

```
--tags, -t       Additional tags for the memory
--include-code   Include code changes in the save
--summary, -s    Custom summary (otherwise auto-generated)
--verbose, -v    Show detailed save information
```

## Workflow

```
1. Collect session context
   ├── Tasks completed
   ├── Decisions made
   ├── Open items
   └── Code changes (if --include-code)

2. Format with metadata
   ├── project: my-project
   ├── session: {date}-{uuid}
   ├── tags: [session, ...user_tags]
   └── created_at: {timestamp}

3. Store in configured backend
   ├── Prefer memory_add for summaries
   ├── Prefer observation_add for atomic learnings
   └── Legacy fallback: chroma_add_documents

4. Report result
```

## Storage Format

```yaml
project: my-project
session: {date}-{uuid}
tags: [session, task, decision]
content:
  summary: Brief description of session context
  tasks_completed: List of completed tasks
  decisions: Key decisions made
  open_items: Unfinished work
```

## Output Format

### Success
```
[sys-memory-keeper:save]

Saving session context...

Context collected:
  Tasks: 3 completed
  Decisions: 2 recorded
  Open items: 1 pending

Metadata:
  Project: my-project
  Session: 2025-01-24-a1b2c3d4
  Tags: [session, task, decision]

[Done] Session context saved successfully.
Memory ID: mem_abc123
```

### With Tags
```
[sys-memory-keeper:save --tags "authentication,oauth"]

Saving session context...

Metadata:
  Project: my-project
  Session: 2025-01-24-a1b2c3d4
  Tags: [session, task, decision, authentication, oauth]

[Done] Session context saved successfully.
Memory ID: mem_abc123
```

### Verbose
```
[sys-memory-keeper:save --verbose]

Collecting session context...

Tasks Completed:
  1. Implemented OAuth flow
  2. Added JWT token validation
  3. Created authentication middleware

Decisions Made:
  1. Use RS256 for JWT signing
     Rationale: Better security for distributed systems
  2. Token expiry: 1 hour
     Rationale: Balance security and user experience

Open Items:
  1. Refresh token implementation
     Status: In progress

Saving to configured memory backend...

Document content:
  ## Session Summary
  Date: 2025-01-24
  ...

[Done] Session context saved.
Memory ID: mem_abc123
```

## Related

- memory-recall - Search and recall memories
- memory-management - Backend selection and migration safeguards
