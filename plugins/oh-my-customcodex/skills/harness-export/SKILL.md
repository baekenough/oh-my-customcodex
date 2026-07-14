---
name: harness-export
description: Export-plan generator for translating oh-my-customcodex assets to other agent harness formats
scope: harness
version: 0.1.0
user-invocable: true
argument-hint: "--target cursor|codex|opencode|zed|gemini|copilot [--dry-run]"
---

# Harness Export

Generate a dry-run export plan from oh-my-customcodex assets into another agent harness format. This is intentionally conservative: the skill documents mapping and risks before writing any external harness files.

## Boundary Decision

Cross-harness export is an adapter layer, not a new core metaphor. Skills remain source, agents remain build artifacts, rules remain compiler specs, and export output is a derived compatibility artifact.

Default mode is `--dry-run`. Writing export files requires a separate explicit task because target formats change independently and can create maintenance debt.

## Targets

| Target | Output Shape |
|--------|--------------|
| `cursor` | rules and agent instructions mapped to Cursor project conventions |
| `codex` | `.codex/**` runtime assets |
| `opencode` | command/agent guidance bundle |
| `zed` | assistant instruction bundle |
| `gemini` | prompt and context bundle |
| `copilot` | repository instructions and chat modes |

## Workflow

1. Read `templates/manifest.json` and current asset counts.
2. Select source assets by target capability.
3. Produce a mapping table: source path, target path, transform, lossiness.
4. Flag unsupported concepts such as memory scope, hooks, MCP tools, or permission mode.
5. Emit a dry-run report and stop unless the user explicitly requested writes.

## Output

```text
harness-export target=cursor mode=dry-run
mapped: skills=18 rules=7 agents=6
lossy: hooks, memory scope, MCP server config
decision: export plan only
```
