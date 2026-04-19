# Token Efficiency Layers

Token efficiency in oh-my-customcodex has four layers. They solve different problems and should not be mixed together blindly.

## Layer 1: Plugin-Level Protection

Use `cc-token-saver` when you want cache- and resume-oriented protection:

- Token Guardian for prompt-cache expiry awareness
- `/continue` for low-cost session resumption
- usage dashboards and rate-limit reporting

This layer is documented in `guides/cc-token-saver/README.md`.

## Layer 2: Runtime Compression

Use R013 ecomode and existing runtime guards when you want to compress active-session behavior:

- shorter outputs
- tighter budget awareness
- safer handling of long-running, batch, or parallel tasks

This layer changes how the session behaves while work is running.

## Layer 3: Tool-Specific Compression

Use `playwright-compress` when the problem is not the whole session, but one extremely verbose browser tool result.

This layer is intentionally narrow:

- compress verbose Playwright MCP output after the tool succeeds
- preserve `ref=` tokens and URLs for follow-up interaction
- keep browser evidence actionable without keeping the full raw payload in context

This layer complements runtime compression instead of replacing it.

## Layer 4: Settings-Level Optimization

Use `/token-efficiency-audit` when you want configuration-level changes before the session burns tokens.

Typical settings-level levers:

### Claude-side

- `includeGitInstructions`
- `autoConnectIde`
- output ceilings such as `BASH_MAX_OUTPUT_LENGTH`
- file-read / MCP output token caps

### Codex-side

- `features.apps`
- `web_search`
- `tool_output_token_limit`

### CI / Worker-only

- disable convenience features that are useful for humans but wasteful in headless runs
- apply stronger output ceilings than interactive defaults

## Recommended Usage

| Goal | Best layer |
|------|------------|
| Protect cache value across pauses | Layer 1 |
| Compress runtime behavior in large sessions | Layer 2 |
| Compress one noisy browser interaction | Layer 3 |
| Reduce baseline token spend from configuration | Layer 4 |

Use layers together, but keep responsibilities separate:

- plugin layer for cache and resume
- runtime layer for in-session behavior
- tool-specific layer for noisy browser interactions
- settings layer for pre-session defaults

## Tradeoffs

| Lever | Benefit | Risk |
|-------|---------|------|
| lower output limits | prevents runaway logs | too low causes repeated reruns and extra token spend |
| disable auto-connect / extra surfaces | less idle context and less noise | may remove convenience features users expect |
| aggressive CI-only flags | efficient headless execution | can weaken local interactive ergonomics if applied too broadly |

## Rule of Thumb

Start with `audit`, then apply only the smallest reversible setting changes that address your dominant cost source.
