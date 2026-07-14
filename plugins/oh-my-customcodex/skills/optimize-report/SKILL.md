---
name: optimize-report
description: Generate comprehensive optimization report
scope: core
argument-hint: "[--baseline <file>] [--format <format>]"
user-invocable: true
---

# Optimization Report Skill

Generate comprehensive optimization report with analysis, metrics, and recommendations.

## Options

```
--baseline       Compare against previous report
--format         Output format (text, json, markdown)
                 Default: text
```

## Sensitive-Path Delegation

Sensitive-path compatibility note: if this skill delegates work that touches `.claude/**`, `.claude/outputs/**`, `templates/.claude/**`, or read-only measurements of those paths, keep `.codex/**` edits on the normal Codex path. On Claude Code v2.1.121+ with `bypassPermissions`, direct writes to `.claude/skills/`, `.claude/agents/`, and `.claude/commands/` are allowed; on v2.1.126+ that extends to broader protected paths. Only use `/tmp/{skill}-{timestamp}.md` as a legacy fallback when the target runtime is older or still prompts.

## Workflow

```
1. Run full analysis
2. Collect all metrics
3. Compare against baseline (if provided)
4. Calculate performance scores
5. Generate recommendations
6. Format report
```

## Report Sections

### Bundle Analysis
- Total size (raw and gzipped)
- Chunk breakdown
- Dependency tree

### Performance Metrics
- Estimated load times
- Core Web Vitals impact
- Build performance

### Code Quality
- Tree-shaking effectiveness
- Dead code percentage
- Duplicate code detection

### Recommendations
- High impact optimizations
- Quick wins
- Long-term improvements

### Comparison (if baseline)
- Size delta
- Performance delta
- Trend analysis

## Output

- Formatted report in requested format
- Performance grade (A-F)
- Priority action items

## Examples

```bash
# Generate current report
optimize-report

# Compare against previous report
optimize-report --baseline ./previous-report.json

# Generate markdown report
optimize-report --format markdown
```
