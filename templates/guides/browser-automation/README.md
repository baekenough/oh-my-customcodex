# Browser Automation

This guide captures the browser-automation patterns that are useful in `oh-my-customcodex` without importing an external browser-control stack wholesale. It is intentionally pragmatic: keep the browser session real enough to validate user flows, but do not turn automation into a second product inside the harness.

## Core Principles

### 1. Prefer existing browser surfaces

Start from the browser tooling the repository already has:

- Playwright tests under `packages/serve/tests/`
- the repository Playwright config at `packages/serve/playwright.config.ts`
- the `playwright` skill and any existing MCP/browser surfaces

Do not add a separate browser orchestration system unless the current surfaces are clearly insufficient.

### 2. Treat authenticated sessions as sensitive

Cookies, session storage, and browser profiles are credentials.

- Never commit cookies, storage state, or exported browser profiles.
- Keep imported cookies in ignored local files or ephemeral temp directories.
- Strip secrets from screenshots, logs, and copied traces before sharing them.

### 3. Anti-bot measures are for resilience, not abuse

Use browser automation to validate real product flows and reproduce bugs. Do not optimize for adversarial scraping or abusive evasion.

Allowed patterns:

- realistic viewport and locale settings
- waiting for stable DOM state instead of brittle sleeps
- authenticated session reuse for testing flows behind login
- evidence capture for failures

Avoid:

- aggressive stealth plugins with unclear behavior
- retry storms against rate-limited or protected sites
- automation that bypasses product safeguards

## Cookie And Session Handling

### Importing cookies

When a flow requires an existing session:

1. Export only the minimum cookies needed.
2. Store them outside tracked files.
3. Load them into a fresh browser context rather than a shared global context.

### Isolate contexts

Use one browser context per scenario or per worker:

- prevents cross-test leakage
- makes failures reproducible
- keeps captured evidence attributable to one flow

### Prefer storage state snapshots for repeatable tests

If a workflow is run often, promote manual cookie import into a reproducible storage-state fixture rather than redoing browser login ad hoc.

## Evidence Capture

Browser automation is only useful if it leaves evidence behind.

Capture at least one of:

- screenshot on failure
- console logs
- network failures
- trace or HAR when the flow is flaky
- the exact page URL and visible state when an assertion fails

When summarizing evidence for the model, preserve reference tokens and URLs so follow-up steps can still target the right page elements.

## Design And Strategy Workflows

### Product strategy sessions

Browser automation is helpful when a product-strategy review needs to ground abstract questions in the actual product surface:

- what the first-time user sees
- where onboarding friction appears
- how many decisions a user must make before value

### Design shotgun sessions

Use browser capture to compare alternatives consistently:

- same viewport
- same user state
- same content seed
- same evidence format

That keeps visual comparisons honest and makes "taste memory" reusable.

## Operational Checklist

- Use an isolated browser context.
- Keep credentials out of tracked files.
- Capture evidence for every meaningful failure.
- Reuse existing Playwright surfaces before adding new tooling.
- Prefer stable selectors and deterministic waits over timing hacks.

## Related Surfaces

- `.agents/skills/product-strategy/SKILL.md`
- `.agents/skills/design-shotgun/SKILL.md`
- `.agents/skills/playwright-compress/SKILL.md`
- `guides/web-scraping/README.md`
- `packages/serve/playwright.config.ts`
