# Agent Eval Guide

## Evaluation Order

Agent evaluation uses two phases:

1. **Correctness gate**: verify the task outcome against explicit acceptance criteria.
2. **Efficiency review**: compare only correctness-passing runs against an ideal trajectory.

Do not optimize step count or latency before correctness is proven.

## Four Metrics

| Metric | Definition | Typical Use |
|--------|------------|-------------|
| `correctness` | Passed criteria divided by total criteria | Release or completion gate |
| `step_ratio` | Observed steps divided by ideal steps | Detect avoidable loops |
| `tool_call_ratio` | Observed tool calls divided by ideal tool calls | Detect noisy retrieval or tool misuse |
| `latency_ratio` | Observed duration divided by ideal duration | Detect runtime regressions |

## Ideal Trajectory

```yaml
task: "create a small routing skill"
capability: "tool_use"
ideal:
  steps: 5
  tool_calls: 8
  latency_ms: 180000
acceptance_criteria:
  - "Skill frontmatter is valid"
  - "Routing docs reference the skill"
  - "Tests or static checks pass"
```

## Interpreting Ratios

- `1.00`: observed matched the ideal.
- `< 1.00`: faster or shorter than ideal; verify no evidence was skipped.
- `1.00-1.25`: usually acceptable.
- `> 1.25`: advisory improvement candidate.
- correctness below `1.00`: fail regardless of efficiency.

## Integration

- Use `agent-eval-framework` for task-level scoring.
- Use `harness-eval` when running repeatable benchmark suites.
- Use `omcustomcodex:improve-report` to turn repeated ratio regressions into improvement suggestions.
