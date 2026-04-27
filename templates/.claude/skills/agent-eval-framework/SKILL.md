---
name: agent-eval-framework
description: Quantitative agent evaluation using correctness, step ratio, tool-call ratio, and latency ratio
scope: harness
user-invocable: true
argument-hint: "<trace-or-task> [--ideal <path>] [--format markdown|json]"
effort: high
version: 1.0.0
---

# Agent Eval Framework

## Purpose

Evaluate agent runs with a two-phase quantitative gate:

1. **Correctness first**: the task must meet its stated acceptance criteria.
2. **Efficiency second**: only correctness-passing runs are compared by step, tool-call, and latency ratios.

This keeps eval pressure useful. A faster run that fails the task is not a better run.

## Metric Framework

| Metric | Formula | Pass Signal |
|--------|---------|-------------|
| `correctness` | `passed_criteria / total_criteria` | `1.0` for release-quality evidence |
| `step_ratio` | `observed_steps / ideal_steps` | `<= 1.25` preferred |
| `tool_call_ratio` | `observed_tool_calls / ideal_tool_calls` | `<= 1.25` preferred |
| `latency_ratio` | `observed_ms / ideal_ms` | `<= 1.50` preferred |

Use ratios as advisory evidence unless a task explicitly opts into a stricter gate.

## Ideal Trajectory Schema

```yaml
task: "short task name"
capability: "file_operations | retrieval | tool_use | memory | conversation | summarization"
ideal:
  steps: 4
  tool_calls: 5
  latency_ms: 120000
acceptance_criteria:
  - "Criterion one"
  - "Criterion two"
notes: "Why this ideal path is reasonable"
```

## Capability Taxonomy

| Capability | Typical Evidence |
|------------|------------------|
| `file_operations` | precise diffs, no unrelated churn, verification after writes |
| `retrieval` | targeted `rg`/file reads, source references, low duplicate search |
| `tool_use` | appropriate tool choice, no unnecessary escalation |
| `memory` | relevant memory used and cited, stale facts re-verified when needed |
| `conversation` | clear routing, no repeated clarification for known constraints |
| `summarization` | faithful compression, preserved blockers and evidence |

## Workflow

1. Define or load an ideal trajectory for the task.
2. Collect observed run data from trace, transcript, hook output, or manual evidence.
3. Score correctness against acceptance criteria.
4. If correctness fails, stop and report failed criteria.
5. If correctness passes, compute efficiency ratios.
6. Attach the metric table to the completion evidence or improvement report.

## Output Format

```markdown
## Agent Eval Result

| Metric | Observed | Ideal | Ratio | Verdict |
|--------|----------|-------|-------|---------|
| correctness | 4/4 | 4/4 | 1.00 | pass |
| steps | 5 | 4 | 1.25 | pass |
| tool calls | 7 | 5 | 1.40 | advisory |
| latency | 150s | 120s | 1.25 | pass |

Decision: correctness-pass, efficiency-advisory
```

## Integration Points

- `harness-eval`: use this framework to add trajectory efficiency evidence to benchmark runs.
- `evaluator-optimizer`: run correctness before efficiency comparisons.
- `mgr-creator`: opt in for high-risk new agents where quantitative validation is worth the extra cost.
- `omcustomcodex:improve-report`: include repeated ratio regressions as improvement suggestions.

## Attribution

Adapted from LangChain Deep Agents eval methodology: correctness-first scoring, ideal trajectory annotation, and efficiency ratios for step, tool-call, and latency comparison.
