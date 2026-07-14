---
name: sec-agentshield-wrapper
description: Pre-flight AgentShield-style security suite wrapper for agent harness changes
scope: harness
version: 1.0.0
user-invocable: true
argument-hint: "<path> [--strict] [--report <file>]"
---

# AgentShield Wrapper

Run an AgentShield-style pre-flight review before risky agent, skill, hook, or MCP changes. This skill is a wrapper contract: use a connected AgentShield tool when available, otherwise run the local static checks that approximate the same boundary.

## Checks

| Area | What to Inspect |
|------|-----------------|
| Tool authority | Agent frontmatter tools, disallowed tools, and permission mode |
| Prompt injection | Untrusted text flowing into tool instructions or shell commands |
| Secret exposure | Tokens, private keys, bearer headers, and credential-like literals |
| Path boundaries | Writes to `.git`, runtime state, templates, and compatibility mirrors |
| MCP risk | New servers, remote URLs, timeout behavior, and tool naming collisions |

## Workflow

1. Identify changed files with `git diff --name-only` unless a path is supplied.
2. Prefer an installed AgentShield scanner if one is configured.
3. Fall back to existing repo checks:
   - `secret-filter`
   - schema validator guidance
   - `adversarial-review`
   - `cve-triage` for dependency advisories
4. Report findings as `blocker`, `warn`, or `info`.
5. In `--strict` mode, halt on any blocker or unreviewed MCP/tool expansion.

## Output

```text
sec-agentshield-wrapper target=.codex/skills/new-skill
blocker: 0
warn: 1
info: 2
decision: proceed-with-review
```

## Notes

- This wrapper complements `sec-codeql-expert`; it does not replace CodeQL or dependency audit.
- Missing AgentShield tooling is not a failure if local fallback checks run and are reported.
