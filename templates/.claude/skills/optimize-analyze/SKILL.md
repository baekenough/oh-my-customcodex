---
name: optimize-analyze
description: Analyze bundle size and performance metrics
scope: core
argument-hint: "[target] [--verbose]"
user-invocable: true
---

# Bundle Analysis Skill

Analyze bundle size and performance metrics for web applications.

## Arguments

```
target           Build output path or project root (optional, auto-detects)
```

## Options

```
--verbose, -v    Show detailed analysis
```

## Sensitive-Path Delegation

Sensitive-path artifact protocol (mandatory): if this skill delegates work that touches `.claude/**`, `.claude/outputs/**`, `templates/.claude/**`, or read-only measurements of those paths, include this protocol directly in the delegated prompt. The delegate must produce artifact bodies in `/tmp/{skill}-{timestamp}.md` first and must avoid direct Read, Bash, Write, or Edit targets under `.claude/**` in unattended flows.

## Workflow

```
1. Identify build tool (webpack, vite, rollup, esbuild)
2. Locate build output
3. Analyze bundle composition
4. Calculate size metrics
5. Identify large dependencies
6. Detect unused code/exports
7. Generate analysis report
```

## Output

- Total bundle size
- Size breakdown by chunk/module
- Top dependencies by size
- Tree-shaking status
- Dead code detection
- Optimization recommendations

## Examples

```bash
# Analyze current project
optimize-analyze

# Analyze specific output directory
optimize-analyze ./dist

# Verbose analysis
optimize-analyze --verbose
```
