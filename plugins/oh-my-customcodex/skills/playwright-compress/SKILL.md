---
name: playwright-compress
description: Compress verbose Playwright MCP output while preserving element refs and actionable browser evidence
scope: core
user-invocable: true
argument-hint: "[status]"
---

# Playwright Compress

This skill documents the Codex-native pattern for shrinking verbose Playwright MCP output without destroying the references needed for follow-up interaction.

## Purpose

- keep `ref=` tokens visible
- reduce repetitive browser snapshots and logs
- preserve URLs, errors, and key visible text
- complement runtime token controls instead of replacing them

## Runtime Surface

The implementation lives in:

- `.codex/hooks/scripts/playwright-compress.sh`
- `.codex/hooks/hooks.json`

It runs on `PostToolUse` for Playwright MCP tools and returns `updatedMCPToolOutput` when the payload is large enough to benefit from compression.

## Compression Policy

- Leave short outputs untouched.
- Preserve `ref=` tokens and URLs.
- Prefer high-signal lines over bulk DOM noise.
- Keep failure evidence verbatim where possible.
- Never send browser session secrets to external services.

## Use Cases

- browser snapshot output is too large to keep in context
- a page contains many repeated nodes but only a few actionable refs
- follow-up tool calls need a compact view of visible evidence

## Related References

- `guides/claude-code/14-token-efficiency.md`
- `guides/browser-automation/README.md`
