# 2026-05-08 Upstream Port Sweep

> Source: open `baekenough/oh-my-customcode` port issues as of 2026-05-08.

This sweep records the pipeline disposition for the open upstream-port backlog so issue closure is tied to explicit evidence rather than an empty queue alone.

## Implemented In This Sweep

| Issue | Disposition | Evidence |
| --- | --- | --- |
| #1288 | Forward-looking CHANGELOG policy ported | `omcustomcodex-release-notes` now requires `Unreleased` promotion, `CONTRIBUTING.md` and the PR template require `Unreleased` updates. |
| #1273 | Multi-close parsing fixed | `auto-tag.yml` now parses `Closes #A #B #C` style references and tests assert the parser shape. |
| #1303 | Goal workflow namespace collision ported | `goal` workflow entrypoints now use `/omcustomcodex:goal` while native `/goal` remains reserved for runtime completion tracking. |
| #1304 | Claude Code v2.1.139 onboarding documented | Compatibility, Claude guide, and template onboarding docs now cover `claude agents`, `/scroll-speed`, `claude plugin details`, and `/mcp` reconnect behavior. |

## Already Present On Develop

| Issue | Disposition | Evidence |
| --- | --- | --- |
| #1260, #1255 | Permission prompt/bypass propagation covered | `agent-mode-guard.sh`, pipeline guidance, and hook tests require `mode: "bypassPermissions"` for Agent/Task spawns. |
| #1259 | Statusline refresh covered | installer tests assert `.codex/settings.local.json` includes `statusLine.refreshInterval: 10`. |
| #1258 | Deleted-folder recreation guarded | updater source-project guard and deprecated-file cleanup coverage prevent update from treating this source checkout as an install target. |
| #1254, #1253, #1252 | auto-dev verification discipline covered | pipeline workflow and template validation require release-monitor scans, CI-mimic/local verification language, and queue checks beyond `verify-done`. |
| #1247, #1241, #1238, #1243 | Hook, SessionStart, RTK, and plugin/Codex surfaces already ported | hook scripts, RTK installer/intercept paths, upstream-release issue sync, and docs/tests exist on develop. |

## Deferred Or Reference-Only Ports Closed From This Sweep

These upstream issues are not direct Codex package implementation work in this release. They are recorded as reference/backlog knowledge and should be reopened only with a concrete Codex-native scope:

#1282, #1281, #1280, #1279, #1277, #1269, #1268, #1267, #1266, #1265, #1264, #1263, #1262, #1261, #1257.

## Verification Plan

- `bun test tests/unit/core/auto-tag-workflow.test.ts`
- `bun test tests/unit/core/template-validation.test.ts tests/unit/core/installer.test.ts tests/unit/core/updater.test.ts tests/unit/core/hooks-scripts.test.ts`
- `bun run typecheck`
- `bun run build`
