---
name: deep-plan
description: Research-validated planning - research -> plan -> verify cycle for high-confidence implementation plans
scope: core
context: fork
version: 1.1.0
user-invocable: true
argument-hint: "<topic-or-issue>"
teams-compatible: true
---

# Deep Plan Skill

Research-validated planning that eliminates the gap between research assumptions and actual code. It runs Discovery Research, Reality-Check Planning, and Plan Verification before handing off implementation.

**Full phase detail**: `guides/deep-plan/phases.md`

## Usage

```bash
/deep-plan <topic-or-issue>
/deep-plan "implement caching layer for API responses"
/deep-plan #325 new authentication system
```

## Workflow Contract

| Phase | Name | Key Activity |
|-------|------|--------------|
| 1 | Discovery Research | Comprehensive research with ADOPT / ADAPT / AVOID taxonomy |
| 2 | Reality-Check Planning | Explore current code and keep only real gaps |
| 3 | Plan Verification | Feasibility, duplication, and test-risk verification |

## Execution Rules

| Rule | Detail |
|------|--------|
| Phase 1 | Invoke or inline the research workflow, depending on runtime context |
| Phase 2 | Use up to 3 parallel Explore agents for current-code verification |
| Phase 3 | Use up to 3 focused verification agents |
| Orchestrator owns synthesis | The main conversation manages phase transitions and verdicts |
| REVISE limit | Max 2 cycles before user escalation |

## Differentiation

| Skill | Scope | Code Verification |
|-------|-------|-------------------|
| `/research` | Analysis only | None by default |
| Plan mode | Planning only | Yes |
| `/structured-dev-cycle` | Implementation pipeline | Yes, stage by stage |
| `/deep-plan` | Analysis + planning + verification | Yes, 3-pass cross-verification |

## Sensitive-path compatibility note

Codex-native verification artifacts go under `.codex/outputs/sessions/YYYY-MM-DD/deep-plan-HHmmss.md` and may be written with the repo's normal file-write APIs.

If any research, planning, or verification delegate must touch `.claude/**`, `.claude/outputs/**`, or `templates/.claude/**`, include this block in that delegate prompt:

```text
Sensitive-path compatibility note:
1. Keep Codex-native .codex/** artifacts on the normal file-write path.
2. On Claude Code v2.1.121+ with bypassPermissions, direct writes to .claude/skills/, .claude/agents/, and .claude/commands/ are allowed.
3. On Claude Code v2.1.126+ with bypassPermissions, broader protected paths such as .claude/**, .git/**, and .vscode/** are also covered.
4. Use /tmp/deep-plan-<timestamp>.md only as a legacy fallback when the runtime is older or still prompts, then verify the resulting diff.
```

The protocol must be copied into delegate prompts. A parent-only mention is insufficient because forked contexts can lose the directive.

## Agent Teams

When Agent Teams are available and the plan has multiple independent verification lanes, the Phase 3 agents may run as a coordinated team. Otherwise, use bounded parallel subagents and aggregate results in the main conversation.

## Post-Completion Advisory

After PASS, return an implementation-ready plan with file scopes, dependencies, test commands, release gates, rollback notes, and any unresolved risks.

## Permission Mode

When spawning agents, explicitly pass `mode: "bypassPermissions"` if the runtime supports it. Defaults may override agent frontmatter and reintroduce permission prompts during unattended execution.
