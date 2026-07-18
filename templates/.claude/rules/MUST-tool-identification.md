# [MUST] Tool Usage Identification Rules

> **Priority**: MUST | **ID**: R008

## Core Rule

Every tool call MUST be prefixed with agent and model identification:

```
[agent-name][model] → Tool: <tool-name>
[agent-name][model] → Target: <file/path/url>
```

For parallel calls: list ALL identifications BEFORE the tool calls.

## Short Response Discipline

Brief diagnostics and quick checks are not exempt. If a visible response will be followed by a tool call, include the tool prefix first even when the natural-language update is one sentence.

Anti-pattern:

```text
확인하겠습니다.
<tool call>
```

Correct:

```text
[Codex][gpt-5.5] → Tool: Bash
[Codex][gpt-5.5] → Target: git status --short
<tool call>
```

### Common Violations to Avoid

```
❌ Missing: tool call with no identification prefix
✓ Correct: [agent-name][model] → Tool: WebFetch
           [agent-name][model] → Fetching: url
           <tool_call>...</tool_call>
```

<!-- DETAIL: Full violation examples
Incorrect: Calling tools without identification — no [agent][model] prefix before tool_call
Incorrect: Missing model — [secretary] → Tool: WebFetch (missing [model])
Correct: [secretary][frontier/high] → Tool: WebFetch / [secretary][frontier/high] → Fetching: url / then tool_call

Incorrect parallel: tool_call(url1), tool_call(url2), tool_call(cmd) — no identification
Correct parallel: list ALL [agent][model] → Tool/Fetching/Running lines FIRST, then all tool_calls
-->


### Workflow Agent Attribution (Claude compatibility)

> **v2.1.174+ Claude compatibility**: Claude Code fixed Workflow tool `agent()` subagents missing per-agent attribution headers. Workflow-spawned agents now carry attribution consistent with R008. When authoring or reviewing Workflow scripts, still reason about each `agent()` fan-out with the same `[agent][model] → Tool:` identification discipline used for parallel Agent tool spawns. Codex-native subagent calls remain governed by the OMX role/`agent_type` contract.

### Required-Parameter Completeness Check

R008 prefix(announce)와 실제 도구 호출은 분리된 단계다. prefix를 출력한 뒤 호출 payload에서 도구 스키마상 required 파라미터를 누락하면 호출이 실패하거나 빈 동작이 된다. 호출 직전, prefix 존재뿐 아니라 required 파라미터가 모두 채워졌는지 확인한다.

| Anti-pattern | Required |
|--------------|----------|
| `[agent][model] → Tool: AskUserQuestion` prefix만 출력하고 `questions` 파라미터 없이/빈 배열로 호출 | prefix + `questions` 배열(최소 1개) 모두 채워 호출 |
| announce 후 payload의 required 필드 누락 (announce-payload separation gap) | announce와 동일 메시지에서 required 필드 완비 호출 |

Cross-reference: R020 (action-completeness precondition — invoke 전에 required 파라미터 확인). Reference issue: #1487 / upstream #1324 (AskUserQuestion `questions` 누락 재발 방지).

## Models

| Lane / Effort | Use |
|-------|-----|
| `frontier/high` | Complex reasoning, architecture |
| `frontier/medium` | General tasks, code generation (default) |
| `spark/low` | Fast simple tasks, file search |

## Tool Categories

| Category | Tools | Verb |
|----------|-------|------|
| File Read | Read, Glob, Grep | Reading / Searching |
| File Write | Write, Edit | Writing / Editing |
| Network | WebFetch | Fetching |
| Execution | Bash, Agent | Running / Spawning |

## Agent Tool Format

```
subagent_type:model → description
```

`subagent_type` MUST match actual Agent tool parameter. Custom names not allowed.

## Parallel Spawn Prefix Rule

When spawning 2+ agents in parallel, each agent's `description` parameter MUST include a `[N]` prefix (1-indexed) to enable correlation with the Running display:

```
Agent(description: "[1] Go code review", subagent_type: "lang-golang-expert")
Agent(description: "[2] Python code review", subagent_type: "lang-python-expert")
```

Single agent spawns do NOT use the `[N]` prefix.

This ensures the Running display:
```
⏺ Running 2 agents… (ctrl+o to expand)
   ├─ [1] Go code review · ...
   └─ [2] Python code review · ...
```

matches the spawn announcement:
```
[secretary][frontier/high] → Spawning:
  [1] lang-golang-expert:frontier/medium → Go code review
  [2] lang-python-expert:frontier/medium → Python code review
```

## Tier-3 Interaction Tool Prefix (MANDATORY)

R008 "every tool call" applies to Tier-3 interaction tools too — not only file/exec tools. Applying the `[agent][model] → Tool:` prefix to Bash/Read/Agent while omitting it on `AskUserQuestion`, `TodoWrite`, `EnterPlanMode`, `ExitPlanMode`, `request_user_input`, or equivalent structured-question tools is a violation.

| Tool | R008 prefix required? |
|------|----------------------|
| AskUserQuestion / `request_user_input` / structured question | YES — `[agent][model] → Tool: AskUserQuestion` or equivalent before the call |
| TodoWrite / `update_plan` | YES |
| EnterPlanMode / ExitPlanMode | YES |
| Skill | NO separate R008 prefix — identified via the R007 integrated header instead |

Skill invocation is the one exception: it is identified through the R007 integrated identification block (`┌─ Agent: {agent} → {skill-name}`), not a standalone R008 tool prefix.

Reference issue: #1486 / upstream #1321 (AskUserQuestion prefix omission); complements #1487 required-payload completeness.

## Multi-Turn Self-Check

도구 호출 전 매번 확인한다:

1. 이 호출 위에 `[agent-name][model] → Tool: <tool-name>` 라인이 있는가?
2. agent-name과 model이 현재 컨텍스트와 일치하는가?
3. 이 호출에 도구 스키마상 required 파라미터가 모두 채워져 있는가? 예: AskUserQuestion/request_user_input 계열은 `questions` 배열이 비어 있지 않아야 한다. prefix(announce)만 출력하고 실제 호출 payload의 required 필드를 누락하면 안 된다.

체크 실패 시 즉시 prefix/필수 파라미터를 보완한 후 호출.

<!-- DETAIL: Consolidated Tool Identification Examples
## Example

```
[mgr-creator][frontier/medium] → Write: .codex/agents/new-agent.md
[secretary][frontier/high] → Spawning:
  [1] lang-golang-expert:frontier/medium → Go code review
  [2] lang-python-expert:frontier/medium → Python code review
```

Parallel spawn description parameter:
```
Agent(description: "[1] Go code review", subagent_type: "lang-golang-expert", ...)
Agent(description: "[2] Python code review", subagent_type: "lang-python-expert", ...)
```
-->
