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

Default (no specific agent): `┌─ Agent: claude (default)`

## Simplified Format

For brief responses: `[mgr-creator] Creating agent structure...`
With skill: `[fe-vercel-agent → react-best-practices] Analyzing...`

## Routing & Skill Context

When the orchestrator uses a routing skill, identification should reflect the active context:

```
┌─ Agent: claude (secretary-routing)
├─ Skill: secretary-routing
└─ Status: route agent management request
```

| Context | Identification |
|---------|---------------|
| No routing active | `claude (default)` |
| secretary-routing | `claude (secretary-routing)` |
| dev-lead-routing | `claude (dev-lead-routing)` |
| de-lead-routing | `claude (de-lead-routing)` |
| qa-lead-routing | `claude (qa-lead-routing)` |
| Skill invocation | `claude → {skill-name}` |

## Skill Invocation Format

When the orchestrator invokes a skill via the Skill tool, the skill name MUST be integrated into the identification block — NOT displayed as a separate tool call.

```
┌─ Agent: claude → {skill-name}
└─ Status: {current-action-or-verdict}
```

### Common Violations

```
Incorrect: Skill as separate display
   ┌─ Agent: claude (default)
   └─ Status: research topic analysis

   Skill(research)    ← separate, disconnected

Correct: Skill integrated into identification
   ┌─ Agent: claude → research
   └─ Status: research topic analysis

Correct: With sub-skill
   ┌─ Agent: claude → research
   ├─ Skill: result-aggregation
   └─ Status: aggregate team findings
```

## When to Display

| Situation | Display |
|-----------|---------|
| Agent-specific task | Full header |
| Using skill | Include skill name |
| General conversation | "claude (default)" |
| Long tasks | Show progress with agent context |
| Skill invocation | Integrated `claude → {skill-name}` format |
