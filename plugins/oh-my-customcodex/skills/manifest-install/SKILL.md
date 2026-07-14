---
name: manifest-install
description: Selective manifest-driven installation profiles for oh-my-customcodex assets
scope: harness
version: 1.0.0
user-invocable: true
argument-hint: "--profile minimal|standard|full|codex|claude [--target <dir>] [--dry-run]"
---

# Manifest Install

Install only the agent-stack assets a project profile needs, while keeping the package manifest, template tree, and Codex runtime layout consistent.

## Use When

- A user wants a smaller install than the full template bundle.
- Release work changes `templates/manifest.json` or component counts.
- A project needs Codex-native assets without optional Claude compatibility mirrors.

## Profiles

| Profile | Includes | Excludes |
|---------|----------|----------|
| `minimal` | AGENTS, core rules, routing skills, status/help, git safety | specialist language packs, optional guides |
| `standard` | minimal + common dev/review/test skills and agents | niche provider guides |
| `full` | every packaged template asset | nothing |
| `codex` | `.codex/**`, AGENTS, guides, workflows | `.claude/**` compatibility mirrors |
| `claude` | Claude compatibility mirrors and CLAUDE entry files | Codex-only runtime state |

## Workflow

1. Read `templates/manifest.json`.
2. Resolve profile include/exclude rules.
3. Produce an install plan with paths, counts, and skipped components.
4. Dry-run by default for destructive replacements.
5. Apply by copying only planned paths and preserving user-owned files.
6. Recount components and report drift.

## Safety

- Never delete user files that are outside the generated asset set.
- Preserve `.codex/agent-memory*/`, local settings, and outputs.
- Treat count mismatch as a halt condition unless `--dry-run` was requested.
- Use `omcustomcodex` in operator guidance.

## Output

```text
manifest-install profile=standard target=.
planned: rules=22 agents=49 skills=123 guides=48
skipped: compatibility mirrors, optional provider guides
status: dry-run
```
