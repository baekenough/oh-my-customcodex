---
name: idea
description: Analyze a natural language idea against the project codebase and return structured issue specs
scope: core
version: 1.0.0
user-invocable: true
argument-hint: "<idea text>"
---

# /idea — Natural Language Idea Analysis

Analyze a natural language idea against the current project's codebase, assess feasibility and scope, and return structured JSON that can be turned into one or more GitHub issues.

## Usage

```
/idea Add OAuth login with Google and GitHub providers
/idea Add a monitoring dashboard to the Discord bot
```

## Output Contract

Return structured JSON only:

```json
{
  "title": "Short feature title",
  "scope": "S|M|L",
  "estimatedIssues": 1,
  "summary": "One-paragraph summary",
  "details": {
    "problem": "What user or system problem this addresses",
    "approach": "Recommended technical approach",
    "touchedAreas": ["src/module-a", "docs/guide-x"],
    "risks": ["migration risk", "auth edge cases"],
    "dependencies": ["issue-123", "external-api"]
  },
  "issueSpecs": [
    {
      "title": "Implement core feature slice",
      "priority": "P1|P2|P3",
      "body": "Markdown issue body"
    }
  ]
}
```

## Workflow

### Phase 1: Parse Input

1. Extract the core intent from the natural language idea
2. Normalize it into a concrete product or engineering change
3. If the request is too vague, state assumptions explicitly in the JSON summary

### Phase 2: Codebase Analysis

1. `Read(AGENTS.md)` to understand the project contract
2. `Read(README.md)` and relevant docs for product/system context
3. Use `Glob` and `Grep` to find likely touched files, modules, and patterns
4. Identify overlap with existing features to avoid duplicate issue creation

### Phase 3: Feasibility Assessment

Assess:
- implementation scope (`S`, `M`, `L`)
- likely modules to change
- architectural or migration risk
- whether the idea should be one issue or decomposed into multiple issues

### Phase 4: Issue Spec Generation

Generate:
- one concise top-level title
- a short summary
- one or more issue specs with priority and actionable markdown bodies

## Heuristics

- Prefer decomposition when the idea spans UI + API + infra
- Prefer a single issue when the change is local and independently shippable
- Reuse project terminology found in AGENTS.md/README/docs
- Keep issue bodies implementation-oriented, not marketing-oriented

## Notes

- This skill is analysis-first: it produces issue-ready output, but it does not create GitHub issues by itself
- Downstream tooling such as builder-factory or a human operator can take the JSON and create the actual issues
