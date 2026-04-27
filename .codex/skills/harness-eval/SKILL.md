---
name: harness-eval
description: Structured SE task evaluation using 15 benchmark definitions from claude-code-harness research
scope: harness
user-invocable: true
argument-hint: "[--preset all|quick] [--task task-name]"
effort: high
version: 1.0.0
---

# Harness Eval — Structured SE Task Benchmark

## Purpose

Evaluate agent quality using 15 structured software engineering task definitions with quantitative scoring. Based on research from [revfactory/claude-code-harness](https://github.com/revfactory/claude-code-harness) which demonstrated 60% improvement (49.5 → 79.3 points) through structured pre-configuration.

## Sensitive-Path Delegation

Sensitive-path artifact protocol (mandatory): if this skill delegates work that touches `.claude/**`, `.claude/outputs/**`, `templates/.claude/**`, or read-only measurements of those paths, include this protocol directly in the delegated prompt. The delegate must produce artifact bodies in `/tmp/{skill}-{timestamp}.md` first and must avoid direct Read, Bash, Write, or Edit targets under `.claude/**` in unattended flows.

## Usage

```
/omcustomcodex:harness-eval                    # Run all 15 benchmarks
/omcustomcodex:harness-eval --preset quick     # Run top 5 high-impact benchmarks
/omcustomcodex:harness-eval --task api-design  # Run specific task benchmark
```

## Quality Dimensions

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Test Coverage | 30% | Unit test count, edge case coverage, assertion quality |
| Architecture Design | 25% | Separation of concerns, dependency management, scalability |
| Error Handling | 25% | Input validation, error propagation, recovery strategies |
| Extensibility | 20% | Plugin points, configuration flexibility, API surface |

## 15 SE Task Benchmark Suite

| # | Task | Category | Key Evaluation Criteria |
|---|------|----------|------------------------|
| 1 | API Design | Architecture | RESTful conventions, versioning, error responses |
| 2 | Data Modeling | Architecture | Schema normalization, relationships, indexing |
| 3 | Authentication Flow | Security | Token management, session handling, OWASP compliance |
| 4 | Test Suite Creation | Quality | Coverage breadth, assertion quality, edge cases |
| 5 | Error Handler | Reliability | Error classification, recovery, user feedback |
| 6 | Logging System | Observability | Structured logging, levels, correlation IDs |
| 7 | Configuration Manager | Operations | Env-based config, validation, secrets handling |
| 8 | CLI Tool | UX | Argument parsing, help text, exit codes |
| 9 | Database Migration | Data | Reversibility, data preservation, zero-downtime |
| 10 | Cache Layer | Performance | Invalidation strategy, TTL, cache-aside pattern |
| 11 | Queue Consumer | Reliability | Idempotency, retry logic, dead letter handling |
| 12 | Middleware Chain | Architecture | Composability, ordering, short-circuiting |
| 13 | File Processor | I/O | Streaming, error recovery, format validation |
| 14 | Webhook Handler | Integration | Signature verification, retry tolerance, idempotency |
| 15 | Rate Limiter | Security | Algorithm choice, distributed state, fairness |

## Scoring Rubric

Each task is scored 0-100 across the 4 quality dimensions:

```
Score = (test_coverage × 0.30) + (architecture × 0.25) + (error_handling × 0.25) + (extensibility × 0.20)
```

### Score Thresholds

| Score Range | Grade | Interpretation |
|-------------|-------|----------------|
| 80-100 | A | Production-ready, well-structured |
| 60-79 | B | Functional with minor gaps |
| 40-59 | C | Works but needs improvement |
| 0-39 | D | Significant structural issues |

## Presets

### `all` (default)
Run all 15 tasks. Full evaluation ~45 minutes.

### `quick`
Run top 5 high-impact tasks (1, 3, 4, 5, 12). Quick evaluation ~15 minutes.

## Integration with evaluator-optimizer

This skill provides preset rubrics for the evaluator-optimizer pipeline:

```
/omcustomcodex:harness-eval → loads rubric → evaluator-optimizer executes → scoring → report
```

The evaluator-optimizer skill's `pre_negotiation` phase accepts harness-eval rubric dimensions as sprint contract criteria.

## Optional 4-Metric Trajectory Evidence

For agent or skill benchmarks, enrich the 0-100 quality score with the `agent-eval-framework` metrics:

| Metric | Source | Use |
|--------|--------|-----|
| `correctness` | benchmark assertions and acceptance criteria | Required before efficiency is considered |
| `step_ratio` | observed steps vs. ideal trajectory | Advisory signal for unnecessary loops |
| `tool_call_ratio` | observed tool calls vs. ideal trajectory | Advisory signal for noisy tool use |
| `latency_ratio` | observed duration vs. ideal trajectory | Advisory signal for runtime regression |

Evaluation order is fixed: correctness first, efficiency second. A benchmark run with failed correctness cannot be rescued by strong efficiency ratios.

## Output

Results saved to `.codex/outputs/sessions/{YYYY-MM-DD}/harness-eval-{HHmmss}.md` with per-task scores and aggregate grade.

## Attribution

Evaluation framework based on research by [revfactory/claude-code-harness](https://github.com/revfactory/claude-code-harness). Adapted for oh-my-customcodex's evaluator-optimizer pipeline with permission.
