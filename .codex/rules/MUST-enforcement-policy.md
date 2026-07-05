# [MUST] Enforcement Policy

> **Priority**: MUST | **ID**: R021

## Core Policy

oh-my-customcodex uses an **advisory-first enforcement model**. Most rules are enforced through prompt engineering (AGENTS.md, rules/, PostCompact hook) rather than hard-blocking hooks. This is intentional — it preserves agent flexibility while maintaining behavioral standards.

## Enforcement Tiers

| Tier | Mechanism | Rules | Behavior |
|------|-----------|-------|----------|
| Hard Block | PreToolUse hook, exit 2 | stage-blocker, dev-server tmux, rule-deletion-guard | Prevents tool execution |
| Conversation Block | PostToolUse hook, exit 2 + `continueOnBlock` | stuck-detector, context-budget-advisor, cost-cap-advisor | Feeds high-signal recovery guidance back to the model and continues the turn |
| Soft Block | Stop hook prompt | R011 session-end saves | Auto-performs then approves |
| Advisory | PostToolUse hooks | R007, R008, R009, R010, R018 | Warns via stderr, never blocks |
| Prompt-based | AGENTS.md + rules/ + PostCompact | All MUST rules | Behavioral guidance in context |

## Why Advisory-First

1. **Agent flexibility**: Hard blocks can trap agents in unrecoverable states
2. **Graceful degradation**: Missing dependencies (jq, etc.) don't break the session
3. **Composability**: External skills and internal rules can coexist without deadlocks
4. **PostCompact reinforcement**: R007/R008/R009/R010/R018 are re-injected after context compaction

## Hard Enforcement Candidates — R010 git-delegation-guard (conditional), R007/R008 (conditional). Promoted: rule-deletion-guard.sh (2026-04-08). See details via Read tool.

<!-- DETAIL: Hard Enforcement Candidates (Future)
If advisory enforcement proves insufficient for specific rules, these are candidates for promotion to hard-block:

| Rule | Candidate Hook | Condition for Promotion |
|------|---------------|------------------------|
| R010 | git-delegation-guard.sh | If orchestrator-direct-write violations exceed 3/session |
| R007/R008 | (new hook) | If identification omission rate exceeds 20% |

Promotion requires: (1) measured violation rate data, (2) user approval, (3) rollback plan.

### Promoted to Hard Block

| Hook | Date | Justification |
|------|------|---------------|
| `rule-deletion-guard.sh` | 2026-04-08 | User-requested: rule files must require individual confirmation before deletion. Prevents accidental bulk deletion of project rules. |
-->

## Claude Compatibility Hook Visibility

Claude Code v2.1.199+ displays stderr from SessionStart/Setup/SubagentStart hooks when they exit 2. This strengthens observability for hard-block and advisory hooks in packaged Claude templates, complementing structured `hookSpecificOutput.additionalContext` without changing the Codex/OMX enforcement model.

## Integration

| Rule | Interaction |
|------|-------------|
| R010 | git-delegation-guard.sh is advisory; could promote to blocking |
| R016 | Violations trigger rule updates, not enforcement changes |
| PostCompact | Re-injects critical rules to combat context compaction amnesia |
