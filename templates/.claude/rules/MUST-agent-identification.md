# [MUST] Agent Identification Rules

> **Priority**: MUST | **ID**: R007

## Core Rule

Every response MUST start with agent identification:

```
┌─ Agent: {agent-name} ({agent-type})
├─ Skill: {skill-name} (if applicable)
└─ Status: {current-action-or-verdict}
```

Use `├─` for every intermediate metadata line. Only the final metadata line uses `└─`.

Default (no specific agent): `┌─ Agent: Codex (default)`

## Simplified Format

The full block is still required for brief user-facing responses. A one-line response may contain only the block plus one concise sentence, but it must not drop the block.

Legacy bracket shorthand is allowed only inside internal logs or non-user-facing scratch output:

```
[mgr-creator] Creating agent structure...
[fe-vercel-agent → react-best-practices] Analyzing...
```

## Short Response Discipline

Short answers, diagnostics, status pings, and corrections are not exempt. If the response is visible to the user, start with the identity block even when the body is one sentence.

Anti-pattern:

```text
확인했습니다.
```

Correct:

```text
┌─ Agent: Codex (default)
├─ Skill: none
└─ Status: 확인

확인했습니다.
```

## Routing & Skill Context

When the orchestrator uses a routing skill, identification should reflect the active context:

```
┌─ Agent: Codex (secretary-routing)
├─ Skill: secretary-routing
└─ Status: route agent management request
```

| Context | Identification |
|---------|---------------|
| No routing active | `Codex (default)` |
| secretary-routing | `Codex (secretary-routing)` |
| dev-lead-routing | `Codex (dev-lead-routing)` |
| de-lead-routing | `Codex (de-lead-routing)` |
| qa-lead-routing | `Codex (qa-lead-routing)` |
| Skill invocation | `Codex → {skill-name}` |

## Skill Invocation Format

When the orchestrator invokes a skill via the Skill tool, the skill name MUST be integrated into the identification block — NOT displayed as a separate tool call.

```
┌─ Agent: Codex → {skill-name}
└─ Status: {current-action-or-verdict}
```

<!-- DETAIL: Skill Invocation Violation Examples
### Common Violations

```
Incorrect: Skill as separate display
   ┌─ Agent: Codex (default)
   └─ Status: research topic analysis

   Skill(research)    ← separate, disconnected

Correct: Skill integrated into identification
   ┌─ Agent: Codex → research
   └─ Status: research topic analysis

Correct: With sub-skill
   ┌─ Agent: Codex → research
   ├─ Skill: result-aggregation
   └─ Status: aggregate team findings
```
-->

## When to Display

| Situation | Display |
|-----------|---------|
| Agent-specific task | Full header |
| Using skill | Include skill name |
| General conversation | "Codex (default)" |
| Long tasks | Show progress with agent context |
| Skill invocation | Integrated `Codex → {skill-name}` format |
