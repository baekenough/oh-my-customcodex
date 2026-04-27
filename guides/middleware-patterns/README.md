# Middleware Patterns

## Purpose

This guide maps LangChain-style agent middleware lifecycle hooks onto the Codex + OMX harness. It is a vocabulary bridge, not a new runtime layer. Prefer existing hooks, skills, and rules before adding new machinery.

## Lifecycle Mapping

| Middleware stage | Codex + OMX surface | Use |
| --- | --- | --- |
| `before_agent` | `SessionStart`, memory recall, project profile loading | Load stable context before work starts |
| `before_model` | `UserPromptSubmit`, `ambiguity-gate`, `intent-detection`, ecomode pruning | Normalize prompt context and route intent |
| `wrap_model_call` | `reasoning-sandwich`, `multi-model-verification` | Allocate reasoning budget and fallback review around model calls |
| `wrap_tool_call` | `PreToolUse`, `PostToolUse`, `action-validator`, `pipeline-guards` | Validate tool boundaries and capture evidence |
| `after_model` | `evaluator-optimizer`, `adversarial-review`, `worker-reviewer-pipeline` | Review generated work before completion |
| `after_agent` | `Stop`, `SubagentStop`, `result-aggregation`, memory save | Persist outcomes and summarize handoff evidence |

## Stage Selection

Use the earliest stage that has enough information and the narrowest stage that can enforce the concern.

| Concern | Recommended stage | Existing surface |
| --- | --- | --- |
| Ambiguous user request | `before_model` | `ambiguity-gate` |
| Sensitive tool target | `wrap_tool_call` | `action-validator`, sensitive-path hooks |
| Repeated identical failures | `wrap_tool_call` or `after_model` | `loop-detection-middleware` |
| Completion quality gate | `after_agent` | R020, `deep-verify` |
| Model allocation | `wrap_model_call` | `reasoning-sandwich` |

## `wrap_model_call` Gap

Codex CLI does not expose a general-purpose model-call wrapper equivalent to LangChain middleware. Treat this as a design boundary. Use `reasoning-sandwich` to plan model allocation before spawning agents, and use `multi-model-verification` only when cross-model review materially improves confidence.

## Authoring Rules

- Keep middleware vocabulary in guides unless a repeated operational failure needs a skill or hook.
- Do not move reusable logic into agent files. Agents should stay declarative.
- Make hook-like guidance advisory first; hard blocking requires a clear safety boundary.
- Add regression coverage when new middleware guidance changes routing, permissions, or completion behavior.

## References

- `action-validator` for tool boundary checks
- `pipeline-guards` for staged workflow constraints
- `reasoning-sandwich` for model allocation
- `loop-detection-middleware` for repeated failure and edit-loop detection
