# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.33] - 2026-07-19

### Fixed

- Seed the native Codex footer only when a project has no `[tui].status_line`, so project-scoped OMX runtimes retain status visibility without overwriting custom or explicitly empty preferences (#1694).

## [1.0.32] - 2026-07-19

### Changed

- Record Claude Code v2.1.211, v2.1.212, and v2.1.214 as provider-owned compatibility behavior while preserving Codex/OMX routing, permissions, hook, and verification boundaries (#1688).
- Require CI completion reports to distinguish full execution from the `full_ci=false` documentation-only fast path using job duration and step-log evidence (#1689).
- Make the R009 verify-Bash plus action-delegate asymmetry explicit so every announced independent call is dispatched in the same message (#1690).
- Activate the release-PR Verdaccio deploy test for `release/*` heads targeting `develop`, using a real ephemeral adduser token and lifecycle-safe `npm publish --ignore-scripts`, and require its latest successful non-skipped result at the immutable PR head before merge without rejecting valid rerun history (#1691).
- Move Wiki drift verification before the reviewed-tree freeze, give the pipeline sole ownership of remote release-ref deletion, and require explicit-Bash bounded readback with exclusive temporary projections (#1692).

### Fixed

- Remove Auto Tag's duplicate release-branch deletion so merge readback, remote-ref cleanup, and absence verification converge under one owner (#1692).

## [1.0.31] - 2026-07-19

### Changed

- Make managed-advisor recovery source-aware: a hooks-only source update now repairs runtime registry metadata without copying or deleting tracked hook assets, including from linked release worktrees (#1686).
- Separate release-PR merge readback from remote-ref cleanup, prohibit local branch cleanup in multi-worktree execution, and require a new acyclic verification run after any post-freeze source-mutating command (#1686).

### Fixed

- Preserve source lockfile bytes and `generatedAt` when the semantic snapshot is unchanged, hash linked release-candidate hook bytes instead of the authoritative runtime checkout, and retain canonical-path safety checks (#1686).
- Exclude data-only quoted heredoc bodies and ordinary quoted search data from shell advisories while continuing to inspect shell-fed heredocs plus executable nested shell, `eval`, and `trap` payloads (#1686).

## [1.0.30] - 2026-07-19

### Changed

- Record OpenAI Codex `rust-v0.144.6` final-state compatibility: refreshed GPT-5.6 Sol/Terra/Luna bundled instructions and corrected 272,000-token context windows remain provider-owned runtime metadata rather than package routing constants (#1683).

## [1.0.29] - 2026-07-19

### Changed

- Scope structured-development stage markers by parent PID across source, compatibility templates, and packaged plugin assets; correct the session auto-fix hook type and normalize direct hook entrypoint modes (#1649).
- Record provider-boundary decisions to retain deterministic rules and the active DAG, task, loop, and alias surfaces until Codex/OMX provides trustworthy activation evidence or semantically equivalent native replacements (#1658, #1659).

### Fixed

- Pin every cache and artifact action in release-sensitive workflows to verified commit SHAs, and make wiki sync stop after its secret preflight when `OMCODEX_MASTER` is unavailable (#1649).

### Removed

- Remove confirmed unreferenced issue-analysis, teammate-notification, template-sync, wiki-sync, CI-status, and completed TODO artifacts inherited from the parent harness (#1649).

## [1.0.28] - 2026-07-19

### Changed

- Persist deep-verify runs as collision-safe, schema-versioned artifacts selected fail-closed by exact repository, release version, and verified SHA; post-release follow-up now consumes only correlated unresolved findings (#1679).
- Require the exact package-managed shell advisor to be installed, byte-matching, enabled, and trusted before autonomous release gates, while preserving official Code Mode Bash `PreToolUse` routing and numeric terminal exit evidence (#1680).

### Fixed

- Replace unsupported triage label inspection with paginated exact REST lookup and race-safe readback while retaining same-issue concurrency, durable acknowledgment markers, and fail-closed mutations (#1681).

## [1.0.27] - 2026-07-19

### Changed

- Record Claude Code v2.1.210 behavior as provider-owned compatibility guidance while preserving Codex + OMX runtime boundaries (#1673).
- Add a fail-closed static-Markdown-only CI fast path that keeps required jobs present and always runs package, documentation, version, template, Wiki, and security gates (#1674).
- Remediate the vulnerable dependency graph to zero high/critical audit findings and replace the skipped npm fallback with a fail-closed native Bun audit (#1676).

### Fixed

- Serialize same-issue triage dispatch and use paginated label/comment readback plus a durable marker so retries converge without duplicate acknowledgments (#1677).

## [1.0.26] - 2026-07-18

### Changed

- Align R017 Sauron escalation, R010 delegated-permission ownership, provider-specific `bypassPermissions`, and context-optimization guidance with Codex-native delegation while retaining explicit Claude compatibility boundaries (#1657).
- Migrate managed agent memory from shared `project` to worktree-local `local` scope, document that memory frontmatter is harness metadata rather than native Codex TOML, and keep ontology and template guidance synchronized (#1656).
- Keep the plain canonical `harness-eval` and `claude-native` skill IDs while documenting `$...` Codex and `/...` Claude invocation syntax; repair dead references and monitoring commands across canonical and template guidance (#1648, #1645).

### Fixed

- Fix forward from immutable `v1.0.25` by making live release credential discovery POSIX ERE-compatible and fail closed on signaled or malformed Git checks, including scoped and unscoped HTTP extraheaders.
- Make triage milestone mutation omit nullable `due_on` payloads and reject unsupported due-date clearing before any write, preventing late non-convergent mutations.

## [1.0.25] - 2026-07-18

### Changed

- Deliver the accumulated, unpublished `v1.0.24` release-target, mutation-evidence, package-verifier, documentation, command-boundary, and post-release follow-up changes to registry consumers upgrading from `1.0.23` to `1.0.25` (#1643, #1646, #1647, #1662, #1666, #1668, #1669).

### Fixed

- Keep the Release `Test` job credential-free by preventing `actions/setup-node` from exporting registry placeholders there, while retaining authentication only in the publish and live-verification boundaries (#1671).
- Fix forward from the immutable, unpublished `v1.0.24` tag to `v1.0.25`, with hermetic offline-verifier fixtures that do not inherit runner credentials (#1671).

## [1.0.24] - 2026-07-16

### Added

- Add a deterministic release-target resolver and evidence-joined mutation barrier that derives the next version from Git, npm, and GitHub Packages; validates reviewed local drafts; rejects stale preconditions; and requires authoritative readback for every external write (#1643, #1666).
- Add one canonical offline/live release verifier with durable safe evidence, lifecycle-enabled isolated consumers, exact dual-registry parity, tracked-entry and symlink preservation, secret-safe failure handling, and CI/release-workflow integration (#1666, #1669).

### Changed

- Preserve upstream issue bodies up to the exact 65,536-character GitHub limit, keep execution/verification/mutation/readback phases explicit, protect display-pipe producer exit status, and make direct repository/API evidence primary when verification delegates stop mid-step (#1662).
- Select remaining `verify-ready` work directly in post-release follow-up so completed `verify-done` issues cannot hide the actual backlog (#1668).
- Reconcile package documentation to the measured 50 agents, 122 skills, 23 rules, and 52 guides, and document R009's four-worker soft default versus five-agent runtime hard cap (#1646).

### Fixed

- Make documentation validation fail closed across synchronized English, Korean, template, and guide claims; replace stale `bun.lockb` guidance; and require the packed-package offline contract in CI. The parent project's deploy-test activation was immediately reverted, so this child intentionally keeps `deploy-test.yml` inactive and uses its existing packed-package gate plus canonical verifier instead (#1647).
- Harden generated command boundaries against nested Markdown/shell payload corruption and zsh reserved-variable or unquoted-URL hazards, while verifying canonical copies by Git entry type rather than treating symlinks as regular files (#1669).

## [1.0.23] - 2026-07-16

### Changed

- Keep packaged Claude compatibility guidance current through Claude Code v2.1.202-v2.1.209 with eight synchronized rule/template mappings, semantic Wiki summaries, and regression freshness checks, while treating these releases as provider-owned behavior with no Codex/OMX runtime change (#1650-#1655, #1660).

## [1.0.22] - 2026-07-16

### Changed

- Raise the required OMX runtime baseline to `v0.20.2`, consuming upstream foreign-hook-coordinate preservation and role, lifecycle, Ralplan, provenance, and setup-policy fixes while retaining the bounded local normalization as defense in depth (#1664).
- Record OpenAI Codex `rust-v0.144.4`-`rust-v0.144.5` final-state compatibility, including the release-note/tag-ancestry Guardian policy evidence and expanded dangerous-command handling as external Codex behavior (#1641, #1663).
- Update `@inquirer/prompts` from `8.3.2` to `8.5.2` while preserving the frozen-install lockfile contract.

## [1.0.21] - 2026-07-14

### Added

- Package reusable oh-my-customcodex skills, hooks, ontology metadata, and ontology-rag MCP declaration as a repo-local Codex plugin artifact with marketplace metadata (#1595).

## [1.0.20] - 2026-07-14

### Fixed

- Limit snapshot rollback journaling to setup-owned OMX paths so historical .omx logs/state are not scanned or copied while preserving exact rollback for setup scope changes (#1626).

## [1.0.19] - 2026-07-14

### Fixed

- Verify GitHub Packages releases with the authenticated Packages API, fail on auth/config errors, and require exact scoped package version confirmation (#1633).

## [1.0.18] - 2026-07-14

### Fixed

- Compare OMX prerelease identifiers with SemVer precedence, including dot-separated identifiers, numeric ordering, ASCII lexical ordering, hyphenated identifiers, and build metadata ignoring (#1634).

## [1.0.17] - 2026-07-14

### Fixed
- Make `eval-core collect --dry-run` parse fresh log paths without creating SQLite files and preserve existing database sidecars while reporting truthful would-collect counts (#1605).
- Avoid redundant `uv`/Python probes during `init` when ontology MCP configuration already exists, preserving second-run idempotency for configured projects (#1586).

## [1.0.16] - 2026-07-14

### Changed
- Raise the required OMX runtime baseline to `v0.20.1` for the cumulative `v0.19.1`-`v0.20.1` workflow, model, plugin, planning, and delegation fixes; install and non-dry update enforce the floor, doctor diagnoses it, and unverifiable versions fail closed while residual hook-trust issue #1610 remains open (#1572, #1575, #1576).
- Record OpenAI Codex `rust-v0.143.0`-`rust-v0.144.3` final-state compatibility, including the Guardian rollback and the `0.144.3` release-note/tag-ancestry discrepancy around direct commit `8a4d35a` (#1571, #1573, #1622, #1623).

## [1.0.15] - 2026-07-14

### Changed
- Use Codex-native `$skill-name` and `/skills` invocation guidance, and distinguish harness behavioral Markdown from native Starlark `.rules` execution policy (#1594).
- Stop installing Claude JSON/stdin status-line assets into active Codex projects, migrating only harness-owned legacy artifacts while preserving user configuration (#1596).
- Discover `.codex/ontology` before the explicit `.claude/ontology` compatibility fallback and validate configured ontology directories (#1597).

### Fixed
- Align the Bun root workspace identity with `oh-my-customcodex` and enforce that identity in the packed-package contract (#1617).

## [1.0.14] - 2026-07-13

### Changed
- Move evaluation database and JSON writes to the canonical `~/.oh-my-customcodex` namespace while retaining read-only legacy history and live-session deduplication (#1599).
- Persist versioned Web lifecycle state atomically so independent CLI processes use the actual running port and legacy numeric PID files remain readable (#1600).

### Fixed
- Read persistent evaluation sessions from the published Node Web server through `node:sqlite` with a bounded Bun compatibility adapter, exposing database and adapter failures in the UI instead of silently dropping history (#1599).
- Launch `web open` through shell-free platform browser argv, use the persisted endpoint, and report launcher failures with a non-zero exit contract (#1601).

## [1.0.13] - 2026-07-13

### Changed
- Track native Codex hook registry and active scripts from the authoritative main checkout while keeping linked-worktree lockfiles local to the requested checkout (#1625).

### Fixed
- Keep doctor, sync, snapshots, and updates on one root-aware lockfile model; preserve modified legacy hooks and reject traversal, symlink, hardlink, and identity-swap escapes (#1625).

## [1.0.12] - 2026-07-13

### Changed
- Replace active Claude model aliases with Codex/OMX `model_lane` and `model_reasoning_effort` metadata, resolving concrete models from the current runtime configuration while retaining aliases only at explicit compatibility boundaries (#1593).
- Route Web agent, skill, and guide generation through Codex first, with Claude as an explicit compatibility fallback and keyword generation as the final degraded mode (#1598).

### Fixed
- Align generated native agent TOML, Web model inventory, eval recommendations, ontology metadata, and active guidance with one Codex/OMX model-resolution contract (#1593).
- Replace shell-string Web provider calls with bounded argv-based processes, isolated generation directories, truthful provider diagnostics, and Codex-only route coverage (#1598).

## [1.0.11] - 2026-07-13

### Changed
- Resolve managed Codex hook assets from the authoritative main checkout only when a standard linked-worktree identity is verified, while keeping separate and nonstandard Git layouts fail-closed (#1613).
- Install, report, and package only the five scripts reachable from the native Codex hook registry instead of carrying inactive Claude-only lifecycle scripts (#1615).

### Fixed
- Treat project hook trust as an explicit Codex user action: require user-level hook enablement and live approval state rather than accepting project-written hashes as effective trust (#1611).
- Make snapshot installation transactional across Codex, OMX, guidance, configuration, and lock surfaces; require post-copy readiness and a final lockfile before success, with exact rollback on failure (#1612).
- Scan executable hook bodies through wrappers, shell command strings, substitutions, sourced content, builtin mutations, and repository-boundary poisoning before installation (#1614).
- Recompute doctor health from live disk state after fixes mutate shared OMX surfaces instead of reporting stale pre-fix results (#1616).

## [1.0.10] - 2026-07-13

### Added
- Deterministically compile packaged Markdown agent sources into managed native Codex TOML roles while preserving custom and OMX-owned roles (#1590).
- Install and validate the native Codex root hook registry with normalized hook payloads and compatibility artifacts (#1591).
- Provision and assess complete project-scoped OMX readiness rather than accepting binary presence alone (#1592).

### Changed
- Move Web agent creation, listing, detail, and count surfaces to native TOML roles; Markdown remains a Claude-legacy source input (#1590).
- Align doctor, list, and security diagnostics with native roles, hooks, and complete OMX setup, and re-normalize shared hook groups after harness-owned setup flows as a local mitigation (Refs #1610).

### Fixed
- Confine Web agent reads and writes against symlink escapes while preserving custom and OMX role ownership (#1590).
- Normalize real `apply_patch` payload shapes and preserve shared Codex/OMX hook ownership (#1591).
- Require plugin source, manifest, assets, and the exact packaged OMX launcher command before readiness can pass (#1592, #1619).
- Run all critical native regressions in synchronized fail-closed CI and release batches (#1618).

## [1.0.9] - 2026-07-13

### Added
- Ship the production Web UI runtime in both npm and GitHub Packages artifacts, with clean-install lifecycle and representative route verification (#1583).
- Generate public library declarations and verify byte-for-byte runtime parity between the unscoped npm and scoped GitHub Packages tarballs (#1584).

### Changed
- Align the published Node engine range, package-root discovery, and exported `VERSION` with the clean-installed package contract (#1584).

### Fixed
- Install repository hooks through Git-native hook paths so normal checkouts and OMX Team linked worktrees behave truthfully (#1608).

## [1.0.8] - 2026-07-13

### Fixed
- Remove the fixed five-second CLI preflight delay and use cancellable asynchronous version probes for the native Codex and OMX toolchain (#1578).
- Preserve protected and nested customized files across updates, keep dry runs read-only, and report init, component, and batch failures through truthful API results and non-zero CLI exit status (#1579, #1580, #1581).
- Emit compact task-outcome JSONL, collect Codex outcomes as the primary eval source with explicit Claude compatibility fallback, surface malformed/duplicate diagnostics, and make repeated database ingestion idempotent (#1582).
- Enforce target-directory boundaries for public updater read/write helpers and reject unsafe update plans before applying changes (#1585).
- Preflight snapshot, MCP, doctor-repair, project-config, and project-lock plans before mutation; reject canonical overlap, escaping virtualenv links, unsafe source links, and hard-linked write destinations; and route project writes through explicit trusted roots (#1603, #1604, #1606).

## [1.0.7] - 2026-07-06

### Changed
- Port upstream oh-my-customcode v1.1.7 compatibility notes for #1567 across source/template rules, Claude compatibility guides, and wiki docs: Claude Code v2.1.200-v2.1.201 Manual permission labeling, AskUserQuestion no-auto-continue behavior, subagent pre-output rate-limit clean failures, background lifecycle hardening, MCP config resilience, and Sonnet 5 harness-reminder delivery changes.

## [1.0.6] - 2026-07-05

### Added
- Add Claude Fable 5 prompting guidance for #1562, including Fable effort strategy, over-prescription warnings, long-lived lane guidance, and R006/R009/R010/R020/R023 cross-references.

### Changed
- Port upstream oh-my-customcode v1.1.3 and v1.1.6 compatibility hardening for #1561 and #1564 across source/template rules and wiki docs: Claude Code v2.1.198-v2.1.199 delegation reliability, hook visibility, background-agent notification notes, verification-delegation non-termination, detection-guard design, and new-file count-impact checks.
- Raise the required OMX runtime baseline to oh-my-codex v0.19.0 for #1565 so package install/update/doctor paths require the upstream planning-gate, handoff, subagent provenance, Ralplan, Madmax, Ultragoal HUD, and Rust reliability fixes.
- Record upstream oh-my-customcode v1.1.5 (#1563) as a parent-only pre-commit coverage ANSI fix; this package's pre-commit hook has no coverage parser to port.

## [1.0.5] - 2026-07-04

### Changed
- Port upstream oh-my-customcode v1.1.1-v1.1.2 audit cleanup by refreshing stale Sonnet/model and legacy Task/SubTask wording, retiring obsolete mandatory `/tmp` artifact-bypass guidance, and updating skill-count metadata.
- Raise the required OMX runtime baseline to oh-my-codex v0.18.17 for #1556 so package install/update/doctor paths require the upstream workflow-safety, Team/Windows, and auth reliability fixes.

## [1.0.4] - 2026-06-21

### Changed
- Add Claude Code v2.1.178 compatibility notes for #1524 from upstream oh-my-customcode v1.0.9, covering per-parameter permission denies, compaction fallback, nested `.claude` resolution, auto-mode subagent classification, and background-agent auth fixes.
- Record `Yeachan-Heo/oh-my-codex` v0.18.13 compatibility review for #1525 as documentation-only: no source/runtime change and no `MINIMUM_OMX_VERSION` bump.
- Add OpenAI Codex `rust-v0.141.0` compatibility notes for #1526, including remote-executor encryption/path behavior, selected-plugin MCP activation, app-server/realtime/TUI additions, hook/plugin/Windows/SQLite/TLS fixes, and performance cleanup.

## [1.0.3] - 2026-06-17

### Changed
- Record upstream `Yeachan-Heo/oh-my-codex` v0.18.12 compatibility review for #1520 as no source-port required in this package.
- Record OpenAI Codex `rust-v0.140.0` compatibility impacts for #1522 across source/template/wiki guidance, including `/usage`, native `/goal`, `/delete`, `/import`, unified `@` mentions, credential storage, and MCP/plugin reliability notes.

## [1.0.2] - 2026-06-14

### Added
- Add optional AWS MCP server integration guidance and an `infra-aws-expert` surface for #1516, including high-privilege `call_aws` boundaries and manual install instructions.

### Changed
- Port Claude Code v2.1.173-v2.1.177 compatibility notes for #1517 across model alias, statusline, tool-identification, and orchestration guidance.
- Harden R020 completion verification for #1518 so binary/rendered artifacts require direct binary inspection or rendering, not text grep alone.

## [1.0.1] - 2026-06-13

### Changed
- Port upstream v1.0.2–v1.0.5 compatibility changes for #1511-#1514: remove daily-scout automation, promote wiki content drift to a blocking check on genuine drift, remove defunct geeknews-scout infra, and harden R010 privileged delegation boundaries.

## [1.0.0] - 2026-06-11

### Changed
- Promote oh-my-customcodex to the 1.0.0 stable release line after the v0.5.22 Codex/OMX harness sync.
- Preserve the v0.5.22 feature set and release workflow while publishing the first stable semver major.

## [0.5.22] - 2026-06-11

### Added
- Add the Codex-port `omcustomcodex:fsd` full-backlog release-loop skill and wiki coverage for #1499.
- Add `daily-scout` GitHub Actions monitoring with OpenAI pre-scoring and deprecate the pending k8s `geeknews-scout` path for #1493.
- Add wiki source-hash manifest generation plus advisory content-drift detection for #1494.

### Changed
- Record Claude Code v2.1.169 and OpenAI Codex rust-v0.139.0 compatibility impacts for #1496 and #1498.
- Harden safety, intent, and completion-verification guidance for #1495 and #1500 around credential metadata-only diagnostics, user-supplied config precedence, and provider/base_url schema reads.


## [0.5.21] - 2026-06-11

### Added
- Add R023 verification-ladder guidance and wiki coverage for #1502, including deterministic-first safety-signal rule authoring checks.

### Changed
- Port the current upstream rule, skill, workflow, and Claude compatibility guardrails for #1501-#1506, including metadata-only infra diagnostics, interrupt/cancellation precedence, Agent Teams transparency scope, memory pollution checks, PATCH-preferred auto-dev release policy, and Claude v2.1.170 Fable/transcript notes.
- Harden update-command tests so full-suite self-update re-exec mocks cannot pollute non-reexec exit-code assertions.

### Fixed
- Allow explicit CLI self-update checks to accept live cross-major npm versions for #1507 while continuing to reject implausible fresh cached versions.

## [0.5.20] - 2026-06-09

### Added
- Add a Bash PreToolUse reserved-variable advisor for #1491 so shell snippets that assign zsh/bash special names like `status`, `path`, or `argv` produce an immediate warning with safer replacements.

## [0.5.19] - 2026-06-09

### Changed
- Harden auto-dev and release workflow reliability for #1489: compound verify-build shell guidance now requires `set -euo pipefail`, workflow sanity checks call out zsh/bash reserved variable names, and npm provenance/Rekor transient publish errors retry automatically before failing.

## [0.5.18] - 2026-06-09

### Changed
- Port upstream v0.175.0/v0.176.0 rule hardening for #1486 and #1487: R008 now covers Tier-3 interaction-tool prefixes plus required-parameter payload completeness, R009 requires output-token budgeting for structured LLM batches, and R020 cross-references tool-call payload completeness.

## [0.5.17] - 2026-06-09

### Added
- Document OpenAI Codex rust-v0.138.0 compatibility impact for #1481, including Desktop handoff, local image path hints, reasoning effort ordering, app-server token usage, plugin JSON, and AGENTS.md loading behavior.

### Changed
- Harden the auto-dev and release workflow changelog gate for #1484 so release PRs promote `CHANGELOG.md` before tags are published.

## [0.5.16] - 2026-06-09

### Added
- Document Claude Code v2.1.166-v2.1.168 compatibility notes for #1479, including deny-rule globs, fallback model boundaries, thinking toggles, and no-op bugfix confirmations.
- Add `omcustomcodex doctor` diagnostics for OMX frontier/spark model lane drift and legacy `OMX_SPARK_MODEL` compatibility for #1482.

### Changed
- Keep generated AGENTS guidance explicit that `omx explore` is deprecated and `omx sparkshell` is opt-in read-only evidence tooling for #1482.
- Port upstream rule hardening from #1474 across source/template rules, including destructive-git blast-radius enumeration, measure-before-adopt guidance, and safety-feedback memory notes.

## [0.5.15] - 2026-06-08

### Changed
- Port auto-dev compression guidance from upstream release monitors for #1475 and #1476: converged artifact substitution is now explicit, lite-mode skill replacement requires justification, and no-structural-surface deep-verify can use deterministic self-checks.

## [0.5.14] - 2026-06-06

### Added
- Add the Codex-port `homework` skill with opt-in session-end activation and `omcustomcodex:feedback` confirmation-gate routing for #1467.
- Add R011 attention-weight memory tiering guidance from the Dual-Brain scout internalization for #1450.
- Record Claude Code v2.1.159-v2.1.165 compatibility notes for packaged `.claude` templates for #1449, #1451, #1461, #1465, #1469, and #1470.

### Changed
- Harden scout/research quantitative fact handling, pre-flight execution, and context-budget file-absent reporting for #1452 and #1466.
- Strengthen R009/R010/R018 and auto-dev release guidance for announce-execution consistency, multi-copy content checks, Agent Teams gate transparency, and milestone verification for #1456, #1460, and #1464.

### Fixed
- Correct the RTK auto-intercept hook description from R015 to R013 in source and template hooks for #1471.

## [0.5.13] - 2026-06-06

### Added
- Add statusline external provider merging through `STATUSLINE_EXTRA_PROVIDERS` and guard statusline/workflow template drift in `verify-template-sync.sh` for #1448 and #1455.
- Add the missing `templates/workflows/eraser.yaml` mirror so workflow YAML drift is caught consistently.

### Changed
- Harden auto-dev compression guidance with `lite` mode transparency and verify-build re-entry after mid-run scope changes for #1468.
- Strengthen R016, R020, and R010 guidance for skill-promotion thresholds, degraded-output re-verification, workflow script sanity checks, and delegated path existence checks for #1440, #1441, and #1442.

## [0.5.10] - 2026-06-01

### Added
- Record the #1434 upstream `Yeachan-Heo/oh-my-codex` v0.18.7 no-op compatibility review and its no-source-port disposition.
- Add #1435 skill-extractor recurring-workflow packaging checklist coverage across source, templates, and wiki documentation.
- Document Claude Code v2.1.157 and v2.1.158 compatibility notes for #1436 and #1437.

### Changed
- Harden safety, orchestration, and rule guidance for #1438 across the packaged agent coordination surface.

## [0.5.9] - 2026-05-30

### Changed
- Retire the packaged Codex/Gemini wrapper and Agora skills for #1429; current guidance now uses expert agents, RTK/researcher paths, `roundtable-debate`, and the official `openai/codex-plugin-cc` interop path only when explicitly installed/requested.
- Validate programmatic documentation in PR CI via `docs-validate`/`validate-docs` for #1428 so phantom command regressions are caught before merge.
- Harden R018 Agent Teams guidance for #1430 and #1431 with non-interactive evidence collection, status checks, zsh reserved-variable safety, disjoint-file parallel-agent fallback, and prompt-size optimization.

## [0.5.8] - 2026-05-30

### Changed
- Remove deprecated memory-plugin backend references from memory agents, skills, R011 guidance, templates, wiki pages, and eval-core adapters for #1426; native memory and approved searchable MCP backends remain the supported paths.
- Rename the eval-core memory adapter helper to the backend-neutral `fromSearchableMemory` API.


## [0.5.7] - 2026-05-29

### Added
- Add the Scholastic ontology reviewer agent from Yeachan-Heo/oh-my-codex v0.18.3 for #1410, mirrored into source/templates, ontology metadata, reference docs, wiki docs, and template validation coverage.
- Record v0.5.7 auto-dev triage dispositions for #1402-#1415, explicitly deferring upstream runtime features that lack a repo-owned implementation surface.

### Changed
- Bump release metadata from 0.5.6 to 0.5.7 and refresh packaged agent counts for the 50-agent surface.

## [0.5.6] - 2026-05-29

### Added
- Document Claude Code v2.1.152-v2.1.156 compatibility across source guides, install templates, and wiki parity for #1417, #1418, #1419, #1420, and #1421.
- Document the Agent tool malformed parsing platform workaround for long or special-character-heavy delegation prompts for #1416.
- Add the R020 Parallel Read + Permanent-Change Dispatch guard to prevent hypothesis-dependent permanent changes from being batched with diagnostic reads for #1423.

### Changed
- Replace the stale external Airflow DAG issue triage workflow with an in-repo triage acknowledgment workflow for #1422.

## [0.5.5] - 2026-05-29

### Added
- Add AgentMemory migration guides for the #1400 measure and COEXIST rollout, and register the guide surface in the guide index.

### Fixed
- Monitor `openai/codex` and `Yeachan-Heo/oh-my-codex` upstream releases in the release issue sync workflow.
- Create release-update tracking issues when dependency releases contain no explicit issue references, while ignoring generated PR inventory references and prereleases by default.


## [0.5.3] - 2026-05-24

### Added
- Record Claude Code v2.1.147-v2.1.150 compatibility decisions in source, templates, and wiki docs, including Workflow gating, `/simplify` to `/code-review` naming, Bash exit-127 triage, `/usage` diagnostics, worktree sandbox fixes, and the v2.1.150 no-op review.

### Changed
- Strengthen R020 with explicit Diagnostic Hypothesis Verification and Test-Skip Is Not Completion guidance, mirrored into Claude templates and wiki rules.
- Strengthen R017 structural migration verification for clean-checkout path audits and `wiki/index.yaml` entry accuracy.
- Refresh `wiki/index.yaml` so every wiki markdown page has a matching index entry and stale `omcustomcodex-*` skill paths point at the actual `omcodex-*` pages.

### Fixed
- Confirm no stale Codex-native `simplify` route is present while documenting the valid `dev-review` and `dev-refactor` split.
- Confirm the referenced leftover `.claude/worktrees/agent-abf7468961dceb1fe` directory is absent from the current worktree and Git worktree list.

## [0.5.2] - 2026-05-24

### Added
- Add a packaged `templates/tests/tsconfig.json` and install it during `omcustomcodex init`, with regression coverage for preserve, force-overwrite, and missing-template paths.
- Add Codex/OMX Agent Teams shutdown troubleshooting and background progress tracking guides, mirrored into install templates.

### Changed
- Strengthen R010/R015 source and template rules for delegated meta-file edits and same-session commit/push continuation.
- Sync guide indexes, template guide counts, and package manifest metadata for the expanded 50-guide surface.

### Added
- Add pipeline label standards and template README documentation for the Codex distribution mapping.
- Record Claude Code v2.1.142 compatibility impact and the upstream nested plan `.gitignore` limitation in source/template guides and wiki pages.
- Record Claude Code v2.1.143, v2.1.144, and v2.1.145 compatibility impact for background task payloads, `claude agents --json`, and structured statusline GitHub fields.
- Add advisory `session-reflection.sh` Stop/SubagentStop capture for transcripts, `background_tasks`, and `session_crons`.
- Add systematic-debugging extended phase guides for timeline correlation, retry/cache/timeout false-fix audits, amplification detection, and fault injection.
- Add an autonomous challenge lessons guide for ground-truth artifact checks, repeated failure discipline, parallel work chunking, and QA evidence quoting.

### Changed
- Harden `auto-dev` with pre-triage git sync, stale issue-version warnings, milestone state checks, docs-only compression selection, and mandatory `bun test` baseline verification.
- Teach `auto-tag.yml` to close a release milestone automatically when all linked issues are closed.
- Prefer native statusline `gh.*` and `agents` JSON when available while preserving cached `gh pr view` fallback behavior.
- Harden R000, R007, R008, R010, R015, R016, and R020 guidance with 합쇼체, short-response identification discipline, agent capability pre-checks, structured-question retry discipline, external repo pre-checks, and interrupt-aware completion verification.
- Require `qa-engineer` to quote selectors, mappings, flags, and config keys from inspected code before citing them.

## [0.4.17] - 2026-05-14

### Added
- Record Claude Code v2.1.141 compatibility decisions for `terminalSequence`, HTTPS plugin installs, workspace-scoped federation, cwd-scoped `claude agents`, recent-session feedback, rewind summarization, permission-dialog diagnostics, `/bg` permission preservation, and related additive UX fixes.

### Changed
- Update R010, R006, and R012 source/template rule guidance with v2.1.141 compatibility notes while keeping `.codex/**` as the Codex-native runtime surface.

## [0.4.16] - 2026-05-13

### Changed
- Rename the goal workflow entrypoint to `/omcustomcodex:goal` across source skills, install templates, command docs, ontology, and wiki guidance so native `/goal` remains available for runtime completion tracking.
- Document Claude Code v2.1.139 onboarding commands for compatibility-template users, including `claude agents`, `/scroll-speed`, `claude plugin details`, and `/mcp` reconnect behavior.
- Record Claude Code v2.1.139 and v2.1.140 compatibility decisions in source and template guides, including hook `args` review, relaxed `subagent_type` matching, native `/goal`, and plugin warning impact.
- Route high-signal PostToolUse advisories through `continueOnBlock` so context-budget, stuck-detector, and cost-cap recovery guidance reaches the model without ending the turn.

## [0.4.15] - 2026-05-08

### Added
- Add release workflow coverage for multi-issue `Closes #A #B` auto-close parsing and package the professor-triage detailed phase guide in templates.
- Surface RTK availability in the statusline from the Codex session environment bridge.
- Document the harness-synthesizer two-stage Base64 plus subprocess isolation pattern.

### Changed
- Require `omcustomcodex-release-notes` to promote populated `CHANGELOG.md` `Unreleased` entries into versioned release sections before publishing.
- Document the upstream-port sweep dispositions for the remaining May 8 port backlog.
- Tighten release-note guidance so `CHANGELOG.md` `[Unreleased]` entries are promoted into versioned sections during release preparation.
- Port SessionStart auto-update prompts and environment guidance to the `omcustomcodex` command boundary.

### Fixed
- Allow `auto-tag.yml` to close multiple linked issues from one keyword, such as `Closes #1 #2 #3`.
- Skip stale registry project paths during project discovery and clean the registry before `omcustomcodex update --all`.
- Add a timeout to statusline PR lookup and update hook data-flow docs to use `.codex` temp-file names.
- Backfill `statusLine.refreshInterval` during full `omcustomcodex update` runs for existing installations.

## [0.4.14] - 2026-05-08

### Added
- Add `/goal` as a Codex + OMX skill surface for disciplined goal-to-execution workflows.
- Package the `goal` skill in both source and install template skill trees, with docs and catalog counts updated to 118 skills.

## [0.4.8] - 2026-04-27

### Added
- Add harness engineering, middleware lifecycle, and agent harness anatomy guides for the LangChain v0.115 port.
- Add `loop-detection-middleware` as an advisory harness skill for repeated errors, edit loops, and repeated tool-target calls.

### Changed
- Extend `harness-eval`, `adaptive-harness`, `reasoning-sandwich`, and `pre-generation-arch-check` with eval governance, trace analysis, reasoning-budget, and pre-completion checklist guidance.
- Refresh template/wiki indexes and README counts for the expanded harness guidance surface.

## [0.4.7] - 2026-04-27

### Added
- Add eval-core trajectory baselines and optional invocation metrics for agent evaluation persistence.
- Add trajectory query helpers for baseline lookup, invocation inspection, and per-baseline aggregate analysis.

### Fixed
- Keep existing feedback and dashboard invocation queries compatible with the expanded schema through regression coverage.

## [0.4.6] - 2026-04-27

### Changed
- Move high-volume R006/R009/R011/R018 rule detail behind HTML comment `DETAIL` blocks while keeping concise visible summaries and Read-tool access to full detail.
- Add sys-memory-keeper guidance for treating native `MEMORY.md` as an index with archive pointers rather than an ever-growing transcript.

### Fixed
- Add regression coverage for rule visible-byte budgets, source/template rule mirror sync, and native memory compaction guidance.

## [0.4.5] - 2026-04-27

### Fixed
- Add mandatory sensitive-path artifact protocol guidance to delegated auto-dev, triage, planning, research, and verification prompts so `.claude/**` compatibility reads/writes do not reintroduce unattended permission prompts.
- Extend sensitive-path regression coverage across source skills, Claude compatibility templates, R006, and wiki guidance.

## [0.3.10] - 2026-04-24

### Fixed
- Extend R006 sensitive-path guidance and hook guarding to cover Write/Edit targeting `.claude/**` and `templates/.claude/**`, with source/template/wiki regression coverage for #902.

## [0.3.9] - 2026-04-24

### Fixed
- Update the macOS Codex installer path to use the current Homebrew cask.
- Remove stale Bash output-directory pre-creation guidance from Codex skills/rules, templates, and docs, with regression coverage to keep it from returning.
- Stabilize serve and doctor tests so release verification can complete reliably.

## [0.3.8] - 2026-04-22

### Fixed
- Teach the built-in Web UI to detect the active Codex/OMX runtime layout so it reads and writes `.codex/*`, `.agents/skills`, and the `~/.oh-my-customcodex` project registry instead of assuming legacy Claude-root paths.
- Move ontology MCP bootstrap from legacy `.mcp.json` generation to project-scoped `.codex/config.toml`, and update tests and package docs to match the active configuration surface.
- Clarify the runtime contract in the main docs and templates by separating installed project paths from this source repository's internal authoring and compatibility surfaces.

## [0.3.7] - 2026-04-22

### Fixed
- Update repo-root validation coverage so CI checks the actual Codex package surfaces (`AGENTS.md`, `.codex/agents`, `.codex/skills`, `.codex/rules`) instead of the intentionally removed legacy Claude root tree.
- Remove accidental merge markers from `README.md` and `README_ko.md` and refresh the documented root skill-module count to 112.
- Replace the stale pre-commit full-coverage and `CLAUDE.md` root checks with the same stable test-batch strategy used in CI, so codex-only repo commits follow the current layout contract.

## [0.3.6] - 2026-04-22

### Changed
- Remove the legacy tracked `.claude/` source tree and root `CLAUDE.md` from the codex child package branch so ongoing development can focus on the Codex/OMX surface.
- Refresh pinned `actions/setup-node` SHAs across the GitHub workflow files that still used the previous v6 digest.

## [0.3.5] - 2026-04-22

### Fixed
- Add a `.claude` sensitive-path Bash guard hook so write-like Bash commands fail before Claude Code's sensitive-file permission prompt path is triggered.
- Cover the new guard in hook validation and hook script tests to keep the workaround release-safe.

## [0.3.4] - 2026-04-22

### Fixed
- Restore the internal `omcodex-auto-update.sh` hook script path in the template hook registry so CI hook validation passes while the public command surface remains `omcustomcodex`.

## [0.3.3] - 2026-04-22

### Changed
- Finish aligning the repo-local development surface with the `omcustomcodex` command by adding an explicit Agent/Skill/Status response contract to the root `AGENTS.md`.
- Update the local project wiki and generated documentation surfaces so stale `omcodex init` references now point at `omcustomcodex init`.
- Rename remaining user-facing slash-command references from `/omcodex:*` and `/omcodex-*` to `/omcustomcodex:*` and `/omcustomcodex-*` across templates, wiki content, and skill frontmatter.

### Fixed
- Update validate-docs coverage so namespaced slash-command aliases resolve against the new `omcustomcodex` namespace.

## [0.3.2] - 2026-04-22

### Changed
- Make `omcustomcodex` the only public CLI binary for this package and remove the conflicting `omcustom`, `omcustomx`, and `omcodex` shell aliases.
- Rewrite shell-facing documentation, deploy smoke tests, issue templates, UI chrome, and self-update fixtures so repository management consistently refers to `omcustomcodex`.

### Fixed
- Harden CLI command reference rewriting so user-facing command text remains stable even when translation lookups return empty values during self-update flows.

## [0.3.1] - 2026-04-22

### Changed
- Align the repo `auto-dev` workflow example, template copy, and architecture docs so the documented `/pipeline` release flow includes the current pre-triage, publish, and followup stages.
- Update the pipeline customization guide and template registry to use the current `workflows/` + `/pipeline` surface instead of legacy `pipelines/` and `pipeline:*` command syntax.
- Refresh the pipeline design spec so it matches the current skill contract, including bounded `parallel` blocks and the reduced command surface.

### Fixed
- Add regression coverage to catch future drift between `workflows/auto-dev.yaml`, `templates/workflows/auto-dev.yaml`, and the primary `/pipeline` documentation surfaces.

## [0.1.9] - 2026-04-19

### Added
- Add `/pre-generation-arch-check` to catch architecture and responsibility violations before implementation begins.
- Add wiki and packaged template coverage for the new skill.

### Changed
- Add pruning transparency guidance to R013 ecomode so compact output can report what was removed.

## [0.1.8] - 2026-04-19

### Fixed
- Use merge-aware changed-file detection in release gates so `Wiki Sync` and similar path-filtered workflows are considered correctly for merged release commits.
- Add the missing wiki page for `token-efficiency-audit` so wiki validation stays green when the skill ships.

## [0.1.7] - 2026-04-19

### Added
- Add `/token-efficiency-audit` to audit and apply token-efficiency settings for Claude/Codex usage.
- Add a new Claude Code guide covering plugin, runtime, and settings-level token-efficiency layers.

### Changed
- Link the new token-efficiency guidance from existing CLI flag and cc-token-saver documentation.

## [0.1.6] - 2026-04-19

### Fixed
- Block auto-tag creation until required `develop` workflows complete successfully, and fail fast when any required workflow concludes non-success.
- Add a release gate so manual or early tag pushes cannot publish while required commit CI is still running or has failed.

## [0.1.5] - 2026-04-19

### Fixed
- Normalize pipeline command/state references for the Codex port so the `auto-dev` template, pipeline wiki entry, and pipeline design spec all point at `/pipeline` and `.codex-pipeline` state files.
- Harden `skill-extractor-analyzer.sh` and its hook test to avoid flaky release-batch failures under Bun's multi-file runner.

## [0.35.0] - 2026-03-14

### Added
- **Cost monitoring system**: statusline→hook cost data bridge + cost-cap-advisor hook with 4-level warnings (#339, #340)
- **Pre-flight guards**: Automated 4-level guard system (PASS/INFO/WARN/GATE) for dev-review, dev-refactor, and research skills (#335, #336, #337)
- **Stuck-detector unit tests**: 157 tests covering all 3 detection signals + hard-block behavior (#338)
- **Dynamic pattern tracking**: task-outcome-recorder now infers workflow pattern (sequential/parallel/evaluator-optimizer/worker-reviewer/orchestrator) (#334)

### Fixed
- **stuck-detector bug**: Fixed `jq -n` → `jq -cn` for compact JSON output — advisory and hard-block detection were silently non-functional (#338)
- **index.yaml**: Added missing 12-workflow-patterns guide entry (#333)

## [0.34.0] - 2026-03-14

### Added
- `omcustom:` namespace prefix for 14 harness/package skills (Closes #264)
- "When NOT to Use" guard sections for dev-review, dev-refactor, research skills
- Stopping criteria display for worker-reviewer-pipeline and research skills
- Cost estimate display for research skill
- Pattern Selection guide (workflow-patterns.md)
- Step 0 Pattern Selection in task-decomposition skill
- `pattern_used` field in task-outcome-recorder hook
- New evaluator-optimizer skill (general-purpose EO primitive)
- Conditional hard-block (exit 1) in stuck-detector for 5+ consecutive repetitions

### Changed
- Reclassified 4 skills from core to harness scope (analysis, lists, status, help)
- Skills count: 70 → 71
- context:fork count documentation updated to 9/10

### Fixed
- Sauron verification findings (guide count, context:fork count, template sync)

### Closed
- #264: omcustom: namespace prefix convention
- #328: CI validate-docs false positive
- #329: Documentation informational findings

## [0.33.1] - 2026-03-13

### Added
- **`/deep-plan` skill**: Research-validated planning with 3-phase cycle (Discovery Research → Reality-Check Planning → Plan Verification). Eliminates gap between research assumptions and actual codebase state (#325)

### Fixed
- **validate-docs hook counting**: Fixed false positive where `scripts/` directory was counted as a hook file. Now counts only `.json` files as hooks (#325)

## [0.32.0] - 2026-03-13

### Added
- **Update awareness** (`doctor --updates`): detects when installed oh-my-customcode version is behind the latest npm release and reports available updates (#313)
- **Session advisory**: notifies users at session start when a newer version is available (#314)
- **Protected files**: lockfile module now tracks protected files to prevent accidental overwrites (#315)

### Changed
- **Lockfile module refactor**: centralized `COMPONENT_PATHS`, added `readLockfile` validation, extracted common helpers (#317)

### Fixed
- **i18n key registration**: lockfile debug/warn message keys now properly registered (#317)

### Tests
- 4 additional lockfile integration tests (29 total) (#317)

## [0.31.1] - 2026-03-12

### Fixed
- **Guide count sync**: Corrected guide count from 24 to 25 across README_ko.md and template CLAUDE.md files (PR #308)

## [0.31.0] - 2026-03-12

### Added
- **Ontology-RAG routing enrichment (R019)**: All 4 routing skills (secretary, dev-lead, de-lead, qa-lead) now call `get_agent_for_task` to inject `suggested_skills` into spawned agent prompts. MCP failure is silently skipped — routing is never blocked.
- **ARCHITECTURE.md**: Comprehensive 13-section architecture documentation with Mermaid diagrams (EN + KO)
- **Docs validator as release gate**: CI now validates documentation consistency before release
- **Phantom slash command detection**: Validator detects commands listed in README without corresponding skill directories
- **Flutter development support**: New `fe-flutter-agent`, `flutter-best-practices` skill, and 4 Flutter guides

### Fixed
- **graph_score=0 bug** in ontology-RAG router: `route_with_hybrid()` now passes keyword-best match as `anchor_node` to `hybrid_searcher.search()`, enabling graph proximity scoring (confidence 0.15→0.30+ range)
- **Ontology-RAG MCP server configuration** restored (#294)
- **Korean query routing**: Added particle stripping for mixed Korean-English queries
- **SHA-pin all GitHub Actions** for supply chain security across 12 workflows
- **Guides migration**: All agent/skill references migrated to `templates/guides/` (single source of truth)
- **Flutter `color.withOpacity()` deprecation**: Replaced with `color.withValues()` in performance guide
- **CLAUDE.md count accuracy**: Skills, rules, and guides counts corrected

### Changed
- **Guides architecture**: Root `guides/` removed from git tracking; `templates/guides/` is canonical source
- **java21 guides** moved to `templates/guides/` (#270)
- **README EN/KO alignment**: Structure and ordering synchronized
- **Sprint 1-4 code quality**: java21 refs, rule dedup, guides sync, validator improvements

## [0.23.2] - 2026-03-08

### Fixed
- **Manifest version desync** : `templates/manifest.json` version was stuck at `0.3.0` while package.json was at `0.23.1`, causing `omcustom update` to incorrectly report "no updates available" for users with existing installations

### Added
- **CI version sync guard**: New CI job `version-sync` verifies `package.json` and `templates/manifest.json` versions match on every PR

## [0.23.1] - 2026-03-08

### Fixed
- **dry-run modifies files** (Issue #220): `omcustom update --dry-run` no longer modifies CLAUDE.md or config — entry doc update and config save are now guarded by dry-run check
- **Content loss on update** (Issue #221): `omcustom update` now preserves existing project-specific CLAUDE.md content when no omcustom markers exist, instead of overwriting it entirely

## [0.23.0] - 2026-03-08

### Added
- **Claude Code v2.1.x Compatibility**: Dual `Task|Agent` hook matchers for forward/backward compatibility
- **SubagentStart/SubagentStop** hook events for agent lifecycle tracking
- **Claude Code version detection** in session-env-check.sh with compatibility warnings
- **7 new agent frontmatter fields**: `isolation`, `background`, `maxTurns`, `mcpServers`, `hooks`, `permissionMode`, `disallowedTools` documented in R006
- **`context: fork`** support added to 5 routing/orchestration skills
- **Hooks analysis** in claude-native CI checker for dual matcher verification
- **Claude Code compatibility matrix** in CLAUDE.md

### Changed
- All rule files (R008, R009, R010, R012, R018) updated: "Task tool" → "Agent tool" naming
- All routing skills updated: `Task(...)` → `Agent(...)` in examples
- CLAUDE.md updated with Agent tool naming and compatibility section
- claude-native checker upgraded: new frontmatter fields, hooks analysis, expanded doc pages, model update
- Hook scripts updated with dual Agent/Task tool comments

### Fixed
- hooks.json matchers silently broken in Claude Code v2.1.63+ due to Task→Agent rename (Issue #218)

## [0.22.1] - 2026-03-08

### Fixed
- Fixed MCP tool name references in sys-memory-keeper agent — session-end saves now correctly invoke approved searchable-memory save and episodic-memory search tools
- Updated R011 (SHOULD-memory-integration) rule with correct tool names

## [0.22.0] - 2026-03-08

### Added
- **Worker-Reviewer Pipeline** skill: iterative Worker→Reviewer quality pipeline with configurable quality gates, Agent Teams integration, and review verdict format
- **PR Auto-Improve** skill: opt-in post-PR analysis and improvement suggestions with structured improvement checklist and agent-specific fix delegation
- **Pipeline Guards** skill: safety constraints for pipeline execution including max iterations, timeouts, quality gates, kill switch, and state preservation

### Changed
- Skill count updated: 60 → 63
- README, CLAUDE.md, and manifest.json synchronized

### Completed
- Issue #213 Phase 3 (Pair Pipeline + PR Auto-Improvement) — all phases now complete
- npm publish confirmed for v0.19.4, v0.20.0, v0.21.0

## [0.21.0] - 2026-03-07

### Added
- DAG Orchestration skill — YAML-based workflow engine with Kahn's topological sort and failure strategies
- Task Decomposition skill — auto-decompose large tasks into DAG-compatible parallel subtasks
- Common workflow templates: feature implementation, code review, multi-language, refactoring
- Decomposition heuristics: by file independence, domain separation, and layer

## [0.20.0] - 2026-03-07

### Added
- Model Escalation skill — advisory system tracking task outcomes and recommending model upgrades (haiku→sonnet→opus)
- Task outcome recorder hook (PostToolUse) for logging success/failure of Task tool calls
- Model escalation advisor hook (PreToolUse) with failure threshold and de-escalation support
- Stuck Detection skill — loop detector identifying repetitive errors, edit loops, and tool spam
- Stuck detector hook (PostToolUse) monitoring Edit/Write/Bash/Task for stuck patterns
- Optional `escalation` field in R006 agent design frontmatter

## [0.19.4] - 2026-03-07

### Fixed
- Strengthen R018 Agent Teams spawn completeness check with mandatory self-check box
- Add partial spawn violation examples to R018 and R009 rules
- Add Git workflow reminder to session-env-check.sh hook (branch detection + protected branch warning)
- Force-add gitignored R018/R009 rule files to git tracking

## [0.19.3] - 2026-03-06

### Added
- `/analysis` slash command for automatic project analysis and customization
- Project tech stack detection with agent/skill mapping for 24+ technologies
- Gap analysis comparing detected stack with installed components
- Auto-configuration workflow with dry-run and verbose options

### Fixed
- Correct secret names for CI/CD workflows (OH_MY_CUSTOMCODE, OH_MY_TEAMMATES_GH_PAT)

## [0.19.0] - 2026-03-06

### Added
- Agent Teams advisor hook: automatic R018 eligibility warning on 2+ Task calls (#207)
- Session environment check hook: codex CLI and Agent Teams availability at session start (#207)
- Codex-exec code generation workflow for hybrid Claude+Codex implementation (#207)
- Code generation trigger in intent-detection patterns (#207)

### Changed
- R009 (Parallel Execution): add Agent Teams Gate requiring R018 eligibility check before Task tool (#207)
- R018 (Agent Teams): simplify self-check from 5 conditions to 2 heuristics (3+ agents OR review cycle) (#207)
- R018 (Agent Teams): change tone from cost-avoidant to actively preferred (#207)
- Move "Agent Teams Awareness" from document bottom to "Routing Decision" priority section in all 4 routing skills (#207)
- Add codex-exec hybrid option to dev-lead-routing and de-lead-routing (#207)
- Upgrade research-workflow routing_note to routing_rule (MUST) in agent-triggers.yaml (#207)
- Add codex-exec suggestion to structured-dev-cycle Stage 3 (Implement) (#207)
- Update codex-exec SKILL.md: remove disable-model-invocation note, add code generation workflow (#207)

## [0.18.5] - 2026-03-06

### Fixed
- Extract Stop hook inline script to external `stop-console-audit.sh` with session diagnostics (#206)
- Document Claude Code internal stop evaluator false positive as platform limitation (#206)

### Added
- Comprehensive hook script tests: 52 test cases for stop-console-audit, stage-blocker, git-delegation-guard

## [0.18.4] - 2026-03-05

### Fixed
- Sync root-level `.claude/` files (statusline.sh, install-hooks.sh, uninstall-hooks.sh) during `omcustom update` (#201)
- Remove deprecated/renamed files during `omcustom update` using deprecation manifest (#202)

## [0.18.3] - 2026-03-04

### Fixed
- Resolve npm audit vulnerabilities by updating dependency lock file (#199)
  - rollup: Path Traversal (HIGH, GHSA-mw96-cpmx-2vgc)
  - esbuild: CORS Bypass (MODERATE, GHSA-67mh-4wv8-2f99)

## [0.18.2] - 2026-03-04

### Fixed
- Standardize ontology YAML field naming to hyphen-case (`user_invocable` → `user-invocable`) (#197)

## [0.18.1] - 2026-03-02

### Fixed
- Standardize frontmatter field naming to hyphen-case (`user_invocable` → `user-invocable`) (#195)

## [0.18.0] - 2026-03-01

### Added
- Auto-route research requests to Codex with xhigh reasoning effort (#191)
  - Add `--effort` parameter to codex-exec (minimal, low, medium, high, xhigh)
  - Maps to Codex CLI's `-c model_reasoning_effort` configuration
  - Add research-workflow triggers to intent-detection (조사, 검색, 리서치, etc.)
  - Research Intent Routing with Codex availability check and WebFetch fallback

## [0.17.1] - 2026-03-01

### Added
- Enable custom statusline for `omcustom init` users (#192)
  - Sync template statusline.sh with latest version (cost display, PR caching, OSC 8 hyperlinks)
  - Auto-generate `settings.local.json` with statusLine configuration during init
  - Merge statusLine config into existing settings without overwriting user preferences
  - Set executable permission on statusline.sh automatically

## [0.17.0] - 2026-02-27

### Features
- **Statusline**: Replace model name with API cost estimate ($X.XX) with color coding (#187, #190)
- **Statusline**: Add PR number display and clickable branch link (#182)
- **Statusline**: Add Claude Code statusline script (#162, #180)
- **Memory**: Session-end auto-save and MCP dependency reclassification (#184)

### Fixes
- **R010**: Add git delegation enforcement mechanisms (#186, #188)
- **Statusline**: Fix space between PR and # in display

### Chores
- **Agents**: Remove mgr-sync-checker and clean up mgr-claude-code-bible (#181, #189)

## [0.16.4] - 2026-02-27

### Fixed
- Correct ontology installed path display in init command (#178)

### Changed
- Remove baekgom-agents sync-check CI and verify-sync script

### Dependencies
- Bump @anthropic-ai/sdk from 0.74.0 to 0.78.0 (#177)
- Bump actions/cache from 4 to 5 (#176)

## [0.14.1] - 2026-02-18

### Fixed
- Install `ontology-rag` from Git URL instead of PyPI registry during `omcustom init` (#152)

## [0.14.0] - 2026-02-18

### Added
- Native ontology-rag integration into `omcustom init` pipeline ([#150](https://github.com/baekenough/oh-my-customcode/issues/150))
  - Ontology knowledge graph (`.claude/ontology/`) now installed as a standard component
  - MCP server configuration auto-generated when uv is available
  - `omcustom update` can update ontology files alongside other components

### Changed
- README.md and README_ko.md documentation overhaul
  - Replaced canonical agent/skill ID text blocks with categorized tables
  - Added ontology-rag package section with feature descriptions
  - Added `omcustom security` command to CLI reference
  - Updated project structure to include ontology directory
- Template manifest version bumped to 0.3.0 (7 components including ontology)

## [0.13.3] - 2026-02-18

### Added
- `omcustom security` command for template and configuration security scanning ([#78](https://github.com/baekenough/oh-my-customcode/issues/78))
  - Hook script audit: detects dangerous patterns (rm -rf, curl|bash, sudo, chmod 777, eval, base64 decode)
  - Config secret scan: finds hardcoded credentials (AWS, GitHub tokens, API keys, private keys)
  - Template integrity: checks for .env files and overly permissive file permissions

## [0.13.2] - 2026-02-18

### Fixed
- Release workflow graceful fallback when CHANGELOG.md entry is missing (#133)
  - Replace hard `exit 1` with warning when CHANGELOG entry not found
  - Use GitHub auto-generated release notes as fallback
  - Prevents half-release state (npm published but no GitHub Release)
  - Release Notes Generator workflow now always triggers

## [0.13.1] - 2026-02-18

### Changed
- R010 orchestrator coordination enforcement strengthened (#144)
  - Added mandatory self-check box before any file modification
  - Added Common Violations section with concrete ❌/✓ examples
  - Stricter exception clause: "simple tasks" now means READ-ONLY only
  - CLAUDE.md templates updated with stronger orchestrator wording
- Agent Teams (R018) proactive usage directives strengthened (#145)
  - Changed from "ACTIVELY prefer" to "DEFAULT to Agent Teams" for qualifying tasks
  - Lowered threshold from 3+ to 2+ agents with shared state or iteration
  - Added mandatory STOP-and-check in R018 and all 4 routing skills
  - CLAUDE.md templates updated with stronger default-to language

## [0.13.0] - 2026-02-17

### Added
- Dynamic Agent Creation pattern: routing fallback creates specialized agents on-the-fly when no matching expert exists (#137)
  - Core oh-my-customcode philosophy: "No expert? CREATE one, connect knowledge, and USE it."
  - `mgr-creator` dynamic mode with auto-discovery of skills and guides
  - `--dynamic` option for `create-agent` skill
  - No Match Fallback in all 4 routing skills (secretary, dev-lead, de-lead, qa-lead)
  - `intent-detection` now triggers dynamic creation for specialized unmatched tasks
- Agent Teams hybrid patterns: Codex integration, dynamic creation in teams (#138)
- codex-exec availability check and Agent Teams integration documentation (#139)

### Fixed
- Rule ID alignment with ontology numbering: R014-R017 → R015-R018 (#141)
- Agent frontmatter standardization: removed 13 empty `skills: []`, fixed field order (#140)

### Changed
- Agent Teams rule (R018) strengthened with mandatory self-check, expanded decision matrix, hybrid/dynamic patterns
- CLAUDE.md templates updated with Dynamic Agent Creation section and proactive Agent Teams language
- README.md and README_ko.md updated with Dynamic Agent Creation as key feature
- manifest.json timestamp and context count updated

## [0.12.4] - 2026-02-17

### Changed
- Replace Python dependency with uv for MCP server setup (#135)
  - `checkPythonAvailable()` → `checkUvAvailable()` for reliable detection
  - Create isolated `.venv` via `uv venv` during `omcustom init`
  - Install `ontology-rag` into `.venv` via `uv pip install`
  - Use `.venv/bin/python` in `.mcp.json` instead of system `python`

## [0.12.3] - 2026-02-14

### Added
- `codex-exec` skill for OpenAI Codex CLI integration
  - Node.js wrapper script (`codex-wrapper.cjs`) with environment validation, command building, JSON Lines parsing, and timeout handling
  - Supports hybrid Claude+Codex workflows for specialized code generation tasks
- `/codex-exec` slash command registered in both English and Korean CLAUDE.md templates

### Changed
- Skill count updated from 52 to 53 across README.md and README_ko.md

## [0.12.2] - 2026-02-13

### Breaking Changes
- Removed Codex (OpenAI) provider support - now Claude-only framework

### Changed
- Removed `LlmProvider` type system and `--provider` CLI flag
- Simplified `layout.ts` from dual-provider to single `CLAUDE_LAYOUT` constant
- Simplified `provider.ts` from 197-line detection to always-Claude return
- Removed codex templates (123 files), CI workflows, and e2e tests

### Fixed
- Removed stale provider parameter from updater test calls
- Removed codex references from ontology-rag package

### Added
- Comprehensive self-update integration tests (20 tests with mocked TTY/child_process)
- Doctor check tests for empty directory warn paths (15 tests)
- Git-workflow render tests for bugfix/hotfix patterns
- Total test count: 768 (up from 688), line coverage: 97.87%

## [0.12.1] - 2026-02-13

### Added
- `omcustom init` now checks for newer `oh-my-customcode` releases in interactive sessions and prompts for self-update before initialization.
- Self-update check includes a 24-hour local cache and automatically skips CI/non-interactive environments.

### Changed
- Codex docs fetch/source policy aligned to canonical OpenAI Codex docs URLs with explicit fallback/report output.
- Codex template model taxonomy normalized to `reasoning | balanced | fast` across agents/skills/rules.
- PR CI now includes a path-scoped Codex-native verification gate for Codex-related changes.

## [0.12.0] - 2026-02-13

### Changed
- Documentation copy updated to consistently describe dual-provider support (Claude + Codex) across:
  - `README.md`, `README_ko.md`
  - `docs/index.md`
- CLI command reference (`docs/guide/commands.md`) reconciled with actual CLI options and defaults.
- Codex template/docs references aligned to Codex-native terminology and model profile terms (`reasoning|balanced|fast`).
- Package metadata now explicitly reflects dual-provider scope (`Claude + Codex`).

## [0.11.0] - 2026-02-13

### Added
- ontology-rag context engine package (Phase 1-4) with MCP server providing 8 tools
  - Phase 1: Core ontology system with YAML-based rule indexing and graph-based relationships
  - Phase 2: Semantic caching, token logging, and budget management
  - Phase 3: Community detection, hybrid search (keyword + graph + community), and reranking
  - Phase 4: Rule decomposition with extractive compression, adaptive budget management, monitoring dashboard, and A/B testing framework
- Packages section in root README documenting ontology-rag v0.3.0

### Changed
- docs/index.md: Updated agent count (36 → 42) and skill count (17 → 51)

### Fixed
- Version display message incorrectly showing old version (#111)

### Removed
- AI PR analyzer workflow and related scripts (pr-analyzer.yml, reusable-pr-analyzer.yml, analyze-pr.ts)

## [0.10.3] - 2026-02-12

### Added
- Brand assets (banner, badge, icon) and README/wiki banners (#102)

### Fixed
- Release workflow race condition in npm publish step (#101, #103)

## [0.10.1] - 2026-02-12

### Added
- Path traversal validation for `preserveFiles` configuration (Closes #76)
  - Validates paths to prevent directory traversal attacks
  - Blocks paths containing `..`, absolute paths, and paths starting with `/`
  - Returns clear error messages for invalid paths

### Changed
- Refactored springboot-best-practices SKILL.md: extracted Java code examples into standalone files (Closes #67)
  - Created 9 example files in `examples/` directory
  - Reduced SKILL.md size by 66.7% (219 → 73 lines)
  - Improved maintainability and on-demand loading

## [0.10.0] - 2026-02-12

### Added
- CI security audit workflow: weekly scheduled scan + PR trigger (Closes #86)
- Security audit job in CI pipeline (runs after lint and test)
- Pre-commit coverage enforcement with 95% threshold (Closes #84)
- Dependabot enhanced configuration: scoped commits, reviewer assignment, UTC scheduling
- Bilingual PR analyzer workflow: Claude API-powered PR analysis with EN/KO comments
- `--force-overwrite-all` CLI flag to bypass all file preservation mechanisms
- i18n translations (en/ko) for new CLI option

### Changed
- `noExcessiveCognitiveComplexity` biome rule elevated from `warn` to `error` (Closes #85)
- `parseEntryDoc()` refactored: cognitive complexity 22 → ≤15 via helper extraction
- `update()` refactored: cognitive complexity 16 → ≤15 via helper extraction
- Dependabot group renamed: `dev-dependencies` → `development-dependencies`
- Dependabot labels updated: added `automated` tag
- Reduce redundant `loadConfig()` calls: list module 4→1, updater module 6→1 (Closes #74)
- Clarify `preserveCustomizations` option semantics with JSDoc documentation (Closes #75)

### Fixed
- Entry-merger false positive on markers inside fenced code blocks (Closes #73)
- Pre-commit hook false positive: `grep "0 fail"` matching "10 fail" → `grep -qE '^ *0 fail'`
- CI: `bun pm audit` → `npm audit` (bun pm audit doesn't exist)
- CI: branch pattern `release` → `release/**` for proper matching
- Documentation: skill count 52 → 51 in README.md and README_ko.md
- Documentation: context count 1 → 4 in README.md and README_ko.md
- Documentation: agent category order alignment between EN/KO README files

## [0.9.4] - 2026-02-11

### Added
- `preserveFiles` config field: protect specific files/directories from being overwritten during `omcustom update` (Closes #69)
- CLAUDE.md merge mechanism: `<!-- omcustom:start -->` / `<!-- omcustom:end -->` markers separate template content from user customizations (Closes #70)
- Custom component tracking: `customComponents` config with `managed: false` flag for user-created agents, skills, rules, and guides (Closes #71)
- `omcustom doctor` checks custom component path existence
- `omcustom list` shows `[custom]` tag for unmanaged components
- Entry document merge: preserves user-written sections while updating template-managed sections

### Fixed
- ESM compatibility: replaced `require('node:path')` with module-level imports in `shouldSkipPath`, `getRelativePath`, `isAbsolutePath`
- `customComponents` deduplication now uses path-based comparison instead of broken `Set` reference equality

## [0.9.3] - 2026-02-10

### Added
- Pre-flight CLI version check: automatically checks for outdated CLI tools (claude-code, codex) via Homebrew before running commands (Closes #54)
  - Homebrew integration with npm/npx fallback
  - CI environment auto-detection (skips check in CI)
  - `--skip-version-check` global flag
- `omcustom update` command: update agents, skills, rules, guides, hooks, and contexts to latest version (Closes #52)
  - Component-selective updates (`--agents`, `--skills`, `--rules`, `--guides`, `--hooks`, `--contexts`)
  - Dry-run mode (`--dry-run`), backup support (`--backup`), force update (`--force`)
  - User customization preservation
  - Provider-aware updates (`--provider auto|claude|codex`)

## [0.9.2] - 2026-02-10

### Fixed
- Resolve release workflow conflict by using `workflow_run` trigger instead of duplicate `push: tags` trigger (#59)

## [0.9.1] - 2026-02-10

### Fixed
- Add missing `secretary-routing` skill to templates (Closes #57)

## [0.9.0] - 2026-02-10

### Added
- Dual-mode provider detection (Claude/Codex) with override/config/env/project markers
- Codex templates: `.codex/` tree, `AGENTS.md` templates, `manifest.codex.json`
- Provider export API for layout/detection utilities
- Codex native verification workflow (reusable GitHub Actions)
- Hook and context documentation in READMEs

### Changed
- CLI: `init`, `list`, `doctor` support `--provider` and auto-detection
- Installer/updater now resolve component paths by provider root (`.claude` or `.codex`)
- Config adds `provider` field (default `auto`)

### Fixed
- README agent names now use full filenames (e.g., `lang-golang-expert` not `lang-golang`)
- Routing skill names use exact directory names in documentation
- Orchestration skill count corrected (added qa-lead-routing)
- Code coverage improved to 99.28%

## [0.8.0] - 2026-02-10

### Added
- Data Engineering agent ecosystem: 8 DE agents (de-airflow-expert, de-dbt-expert, de-spark-expert, de-kafka-expert, de-snowflake-expert, de-iceberg-expert, de-pipeline-architect, de-quality-engineer)
- Database agents: db-postgres and db-redis
- DE lead routing skill for data engineering task delegation
- 8 best-practices skills: airflow, dbt, spark, kafka, snowflake, iceberg, postgres, redis
- 8 reference guides: airflow, dbt, spark, kafka, snowflake, iceberg, postgres, redis
- Pipeline architecture patterns skill

### Changed
- Agent count: 34 → 42
- Skill count: 41 → 51
- Guide count: 14 → 22
- Secretary routing updated with missing agents (mgr-claude-code-bible, sys-memory-keeper, sys-naggy)
- Dev-lead routing updated with missing agents (arch-documenter, arch-speckit-agent, infra-docker-expert, infra-aws-expert)

### Fixed
- README.md/README_ko.md counts updated to reflect new agents/skills/guides
- Hook count corrected (2 → 1) and context count corrected (1 → 4) in README.md
- 100% routing coverage achieved (42/42 agents routable)

## [0.7.0] - 2026-02-10

### Added
- `monitoring-setup` skill: OTel console monitoring enable/disable via `/monitoring-setup`
- Natural language triggers for monitoring activation (Korean/English)

### Changed
- CLAUDE.md.en: Added `/monitoring-setup` to slash commands table
- CLAUDE.md.ko: Added `/monitoring-setup` to slash commands table

### Dependencies
- Merged Dependabot PRs: upload-artifact v6, download-artifact v6, Anthropic SDK 0.74.0, nodemailer v8, @types/nodemailer v7
- Fixed 3 E2E test failures (locale-agnostic assertions)
- Added claude-native-check.yml workflow
- Fixed README_ko.md typo (qa-qa-engineer → qa-engineer)

## [0.6.2] - 2026-02-08

### Fixed
- Release Notes workflow: add fetch-tags: true to checkout to prevent missing tag references
- Release Notes script: wrap git commands in try/catch with fallback for robustness

## [0.6.1] - 2026-02-08

### Fixed
- Release Notes Generator: auto-detect previous tag on tag push events
- Release Notes Generator script: robust fallback using sorted tag list
- E2E symlink test timeout increased to 15s for CI environments

## [0.6.0] - 2026-02-08

### Added
- R018 (SHOULD-agent-teams.md): Agent Teams rule for active usage when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is enabled
- Agent Teams section in CLAUDE.md.en and CLAUDE.md.ko templates
- Decision matrix for Task Tool vs Agent Teams selection

### Changed
- R010: Replace experimental Agent Teams disclaimer with active integration guidance
- index.yaml: Add missing R016, R017 entries and new R018
- index.yaml: Fix R007, R008, R009 priority mismatches (SHOULD/MAY → MUST)
- Rule counts updated from 17 to 18 across all documentation
- manifest.json: Updated rule file count (18 → 19) and timestamp

## [0.5.0] - 2026-02-07

### Added
- Recreated `verify-sync.sh` for read-only template drift detection (replaces deleted version)

### Fixed
- Fix init empty directories bug: `createDirectoryStructure()` pre-created empty dirs causing `installComponent()` to skip file copying for agents, skills, guides, rules, hooks, contexts
- Fix `CLAUDE_SUBDIR_COMPONENTS` missing agents and skills entries in init.ts
- Fix Issue Analyzer workflow missing @anthropic-ai/sdk (Closes #35)
- Fix Release Notes Generator workflow missing @anthropic-ai/sdk (Closes #34)
- Fix sync-check CI workflow referencing deleted verify-sync.sh

### Removed
- Remove deprecated `pipelines` and `examples` directories and all references
- Remove `--production` flag from workflow bun install steps

## [0.4.0] - 2026-02-06

### Added
- Reusable workflow push-guards (prevent phantom CI failures on push)
- mgr-claude-code-bible agent to documentation and tables

### Changed
- Replace all hardcoded "baekgom-agents" references with generic names in templates
- Genericize template project names (my-project, AI Agent System)
- Update sourceRepo URLs to oh-my-customcode
- Fix slash command names to match actual skills (/audit-agents, /dev-review, /sauron-watch)
- Documentation validator uses fs.readdirSync instead of Bun Glob (CI compatibility)

### Removed
- Custom Pipelines section from READMEs (feature was removed)
- Pipeline references from project structure and commands
- sync.sh, sync.sh.example, verify-sync.sh (unused sync scripts)
- tutor-go agent references (agent doesn't exist)

### Fixed
- Rule counts: 18 → 17 (MUST 11, SHOULD 5, MAY 1)
- Agent name typos in README_ko (db-expert → db-supabase-expert, qa-qa-* → qa-*)
- Manager agent count: 6 → 7 (added mgr-claude-code-bible)
- R010 orchestrator coordination rule: all file modifications must be delegated

## [0.3.2] - 2026-02-05

### Changed
- Sync templates from source (36 files updated)
- Release workflow requires CHANGELOG.md entry (fails if missing)
- Branch protection rules simplified to Lint + Test only

### Fixed
- CI: Skip duplicate npm publish if version already exists

## [0.3.1] - 2026-02-05

### Fixed
- Increase e2e test timeout from 10s to 30s to prevent CI timeouts

## [0.3.0] - 2026-02-05

### Added
- Claude API automation workflows (#17)
  - Issue analyzer workflow (Claude-powered)
  - Documentation validator workflow
  - Release notes generator workflow
- Language toggle links in READMEs (English ↔ Korean)

### Changed
- Sync-check runs daily at 04:00 KST with private repo access
- CI simplified to macOS only with consolidated coverage checks
- Clarified release branch publishing workflow in CONTRIBUTING.md
- Release workflow skips publish if version already exists

### Removed
- CodeRabbit integration (too heavy for this project)

## [0.2.1] - 2026-01-28

### Fixed
- Bug fixes and stability improvements

## [0.2.0] - 2026-01-28

### Added
- Official Claude Code format support (flat agent structure)
- Updated agent count to 34
- Updated skill count to 42
- Updated guide count to 13

### Changed
- Migrated from nested to flat agent directory structure
- Updated templates to match baekgom-agents official format

## [0.1.4] - 2026-01-27

### Added

- Sync automation script (`scripts/sync-core.ts`) for baekgom-agents template synchronization
- Sub-agent model specification support in rules (R008, R009, R010)
- `[agent][model] → Tool` identification format in MUST-tool-identification
- New guide: `guides/claude-code/11-sub-agents.md`

### Changed

- Disable Windows CI test matrix for Bun stability
- Update orchestrator rules with model parameter documentation
- Update secretary and dev-lead agent definitions

### Removed

- Remove tech-reviewer agent, guide, and skill (consolidated into baekgom-agents source)
- Remove Windows-incompatible E2E and mock tests

## [0.1.3] - 2026-01-26

### Changed

- **BREAKING**: Rename CLI command from `omcc` to `omcustom`
- Update templates from baekgom-agents (37 agents, 17 skills, 12 guides)
- Add sub-agent model specification support in templates
- Improve test coverage to 99.87% (100% function coverage)
- Adjust CI coverage threshold to 99.5% for Bun V8 compatibility

### Fixed

- Remove unreachable defensive code in doctor.ts
- Fix error handling tests for installer, list, and doctor modules

## [0.1.2] - 2026-01-25

### Added

- GitHub Packages publishing (`@baekenough/oh-my-customcode`)
- Automated release notes from CHANGELOG

### Changed

- Release workflow now publishes to both npm and GitHub Packages

## [0.1.1] - 2026-01-25

### Changed

- Bump `i18next` from 24.2.3 to 25.8.0
- Bump `commander` from 12.1.0 to 14.0.2
- Bump `@biomejs/biome` from 1.9.4 to 2.3.12
- Bump `actions/checkout` from v4 to v6
- Bump `actions/setup-node` from v4 to v6
- Migrate biome.json to v2 schema

### Fixed

- Fix biome lint configuration for v2 compatibility
- Fix unused variable warnings in source files

## [0.1.0] - 2026-01-25

### Added

- **CLI Tool (`omcustom`)** - Command-line interface for managing Claude Code agent systems
  - `omcustom init` - Initialize agent system in current project
  - `omcustom init --lang ko` - Initialize with Korean language support
  - `omcustom init --backup` - Backup existing installation before init
  - `omcustom update` - Update to latest agents and skills
  - `omcustom list` - List all installed components (agents, skills, guides, rules)
  - `omcustom list --format json` - JSON output format support
  - `omcustom doctor` - Verify installation health
  - `omcustom doctor --fix` - Auto-fix common issues

- **Pre-built Agents (36 total)**
  - Orchestrator agents: planner (master), secretary, dev-lead, qa-lead
  - Manager agents: creator, updater, supplier, gitnerd, sync-checker, sauron
  - System agents: memory-keeper, naggy
  - SW Engineer/Frontend: vercel-agent, vuejs-agent, svelte-agent
  - SW Engineer/Backend: fastapi, springboot, go-backend, express, nestjs
  - SW Engineer/Language: golang, python, rust, kotlin, typescript, java21
  - SW Engineer/Tooling: npm-expert, optimizer, bun-expert
  - SW Architect: documenter, speckit-agent
  - Infra Engineer: docker-expert, aws-expert
  - QA Team: qa-planner, qa-writer, qa-engineer

- **Skills (17 total)**
  - Development best practices for Go, Python, TypeScript, Kotlin, Rust, Java
  - Backend framework skills for FastAPI, Spring Boot, Express, NestJS
  - Infrastructure skills for Docker, AWS
  - System skills for memory management, result aggregation
  - Orchestration skills for pipeline execution, intent detection

- **Guides (12 total)**
  - Reference documentation for various technologies
  - Claude Code usage guides

- **Rules (18 total)**
  - MUST rules: Safety, permissions, agent design, identification (enforced)
  - SHOULD rules: Interaction, error handling, memory integration (recommended)
  - MAY rules: Optimization guidelines (optional)

- **Multi-language Support**
  - English (default)
  - Korean (`--lang ko`)

- **Internationalization (i18n)**
  - Full i18next integration
  - Easily extensible for additional languages

- **Template System**
  - Pre-configured templates for agents, skills, guides, and rules
  - Easy customization and extension

### Changed

- Nothing yet (initial release)

### Fixed

- Nothing yet (initial release)

[Unreleased]: https://github.com/baekenough/oh-my-customcode/compare/v0.17.1...HEAD
[0.17.1]: https://github.com/baekenough/oh-my-customcode/compare/v0.17.0...v0.17.1
[0.17.0]: https://github.com/baekenough/oh-my-customcode/compare/v0.16.4...v0.17.0
[0.16.4]: https://github.com/baekenough/oh-my-customcode/compare/v0.14.1...v0.16.4
[0.14.1]: https://github.com/baekenough/oh-my-customcode/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/baekenough/oh-my-customcode/compare/v0.13.3...v0.14.0
[0.13.3]: https://github.com/baekenough/oh-my-customcode/compare/v0.13.2...v0.13.3
[0.13.2]: https://github.com/baekenough/oh-my-customcode/compare/v0.13.1...v0.13.2
[0.13.1]: https://github.com/baekenough/oh-my-customcode/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/baekenough/oh-my-customcode/compare/v0.12.4...v0.13.0
[0.12.4]: https://github.com/baekenough/oh-my-customcode/compare/v0.12.3...v0.12.4
[0.12.3]: https://github.com/baekenough/oh-my-customcode/compare/v0.12.2...v0.12.3
[0.12.2]: https://github.com/baekenough/oh-my-customcode/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/baekenough/oh-my-customcode/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/baekenough/oh-my-customcode/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/baekenough/oh-my-customcode/compare/v0.10.3...v0.11.0
[0.10.3]: https://github.com/baekenough/oh-my-customcode/compare/v0.10.1...v0.10.3
[0.10.1]: https://github.com/baekenough/oh-my-customcode/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/baekenough/oh-my-customcode/compare/v0.9.4...v0.10.0
[0.9.4]: https://github.com/baekenough/oh-my-customcode/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/baekenough/oh-my-customcode/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/baekenough/oh-my-customcode/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/baekenough/oh-my-customcode/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/baekenough/oh-my-customcode/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/baekenough/oh-my-customcode/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/baekenough/oh-my-customcode/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/baekenough/oh-my-customcode/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/baekenough/oh-my-customcode/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/baekenough/oh-my-customcode/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/baekenough/oh-my-customcode/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/baekenough/oh-my-customcode/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/baekenough/oh-my-customcode/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/baekenough/oh-my-customcode/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/baekenough/oh-my-customcode/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/baekenough/oh-my-customcode/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/baekenough/oh-my-customcode/compare/v0.1.4...v0.2.0
[0.1.4]: https://github.com/baekenough/oh-my-customcode/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/baekenough/oh-my-customcode/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/baekenough/oh-my-customcode/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/baekenough/oh-my-customcode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/baekenough/oh-my-customcode/releases/tag/v0.1.0
