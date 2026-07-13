# Codex/OMX Model Routing

## Overview

Route by role capability and reasoning effort. Do not pin a product-wide model ID:
OMX owns the current model inventory and Codex agents consume that runtime contract.

## Capability Lanes

| Lane | Resolution order | Use case |
|------|------------------|----------|
| `frontier` | active Codex root `config.toml` model → `OMX_DEFAULT_FRONTIER_MODEL` → inherit | Architecture, implementation, complex debugging, release verification |
| `spark` | `OMX_DEFAULT_SPARK_MODEL` → legacy `OMX_SPARK_MODEL` → OMX low-complexity config → inherit | Search, triage, lightweight validation |
| `inherit` | Current Codex session | Roles that should follow their caller |

`inherit` is also the safe result when a lane has no runtime value. Generated agent
TOML omits `model` in that case instead of embedding a guessed model ID.

## Reasoning Effort

Choose `model_reasoning_effort` independently of the lane. Codex accepts `none`,
`minimal`, `low`, `medium`, `high`, `xhigh`, `ultra`, and `max`, subject to the
selected model's support.

| Work | Lane | Typical effort |
|------|------|----------------|
| File or symbol discovery | `spark` | `low` |
| Requirements and task planning | `frontier` | `medium` or `high` |
| Routine implementation | `frontier` | `medium` |
| Cross-module debugging | `frontier` | `high` |
| Architecture or adversarial review | `frontier` | `xhigh` |
| Mechanical validation | `spark` or `inherit` | `low` |
| Release verification | `frontier` | `high` |

Increase effort only when evidence shows the current role is under-reasoning. If
the task also needs a different capability, route to a more appropriate role rather
than guessing a newer concrete model name.

## Agent Source Metadata

Repository-native definitions use capability metadata:

```yaml
# .codex/agents/example-agent.md
name: example-agent
model_lane: frontier
model_reasoning_effort: medium
```

The compiler resolves the lane when generating `.codex/agents/*.toml`:

```toml
name = "example-agent"
model = "<value resolved from the active Codex/OMX configuration>"
model_reasoning_effort = "medium"
```

When no lane value is configured, the `model` line is absent. Packaged
`templates/.claude/agents/*.md` remain an explicit upstream-compatibility source;
their provider aliases are translated only at this compiler boundary.

## Agent Compilation Precedence

1. The active Codex root model resolves the `frontier` lane.
2. `OMX_DEFAULT_FRONTIER_MODEL` fills `frontier` when the root model is absent.
3. `OMX_DEFAULT_SPARK_MODEL`, legacy `OMX_SPARK_MODEL`, then OMX low-complexity config resolve `spark`.
4. Generated TOML inherits when the selected lane has no concrete runtime value.

Do not copy the model names shown in a generated `AGENTS.md` capability table into
templates. That table is runtime evidence, not a stable source constant.

## Escalation Pattern

Escalate capability and effort separately:

```text
1. Confirm the failure is reasoning-related.
2. Increase model_reasoning_effort one supported level.
3. Route to a higher-capability role if the task boundary changed.
4. Change a concrete model only through OMX runtime configuration.
5. Re-run the same verification and keep the smallest successful setting.
```

## Related

- R006 — agent metadata and provider boundaries
- R008 — role/lane identification
- `guides/skill-bundle-design/` — skill architecture patterns
