---
title: "OpenAI Codex Compatibility Guide"
type: guide
updated: 2026-07-16
sources:
  - guides/openai-codex/01-version-compatibility.md
related:
  - [[claude-code]]
  - [[agent-harness-anatomy]]
  - [[r006]]
  - [[r010]]
---

# OpenAI Codex Compatibility Guide

Reference documentation for OpenAI Codex release-note impact decisions in oh-my-customcodex.

## Overview

This guide tracks Codex/OMX runtime compatibility notes separately from Claude Code compatibility notes. It records which upstream OpenAI Codex release changes require package-owned updates, which are no-ops, and which should remain external runtime behavior.

## Key Topics

- OpenAI Codex release-monitor triage decisions
- Cumulative OMX runtime floors and provider-boundary decisions
- Guardian rollback and tagged-release ancestry evidence
- Reasoning effort, model-routing, plugin, MCP, and app-server compatibility notes
- AGENTS.md loading behavior and nested instruction expectations

## Current Release Note

`oh-my-codex v0.20.2` is tracked for #1664 and is now the packaged `MINIMUM_OMX_VERSION` baseline. It preserves foreign Codex hook coordinates across repeated setup through upstream #3151, closing `Yeachan-Heo/oh-my-codex#3147`, and hardens native `spawn_agent` role binding, child-stop behavior, fresh App Ralplan bootstrap, prompt/session provenance, and `AGENTS.md` merge policy. The child package keeps its bounded setup normalization as defense in depth but does not copy OMX routing, state, or setup engines.

OpenAI Codex `rust-v0.144.4` and `rust-v0.144.5` are tracked for #1641 and #1663. The `0.144.4` release note reports no user-facing change, while divergent tag evidence includes release-branch projection `d82b7e5d4c` of PR #32875 and the selected Guardian model's `ModelMessages.auto_review.policy` final state, with precedence `guardian_policy_config` -> catalog policy -> built-in fallback. `0.144.5` strengthens dangerous-command handling for forced `rm` forms and denial reasons. Both remain external Codex runtime behavior; this package records compatibility without implementing Guardian, a command detector, or a minimum Codex floor.

`oh-my-codex v0.19.1` through `v0.20.1` is tracked for #1572, #1575, and #1576. Before v1.0.22, the packaged `MINIMUM_OMX_VERSION` baseline was `0.20.1`, covering the cumulative terminal-state, Team state-root, mission queue, GPT-5.6 model contract, plugin-mode setup, persisted-subagent/worktree context, Ralplan draft, Stop-hook, delegation-provenance, parsing, and setup-default fixes through the runtime dependency instead of copying OMX internals into this child package.

At the historical `v0.20.1` floor, direct repeated `omx setup` could still reorder coexisting Codex hook groups, and the child package's v1.0.10 normalization was only a bounded mitigation. Upstream #3151 resolves `Yeachan-Heo/oh-my-codex#3147` in `v0.20.2`; the new floor consumes that fix while retaining the mitigation as defense in depth.

OpenAI Codex `rust-v0.143.0` through `rust-v0.144.3` is tracked for #1571, #1573, #1622, and #1623. The guide records remote-plugin, proxy, MCP tool-search/authentication, app-server, approval, sandbox, connector, model/reasoning, and reliability changes as external Codex capabilities. At the `0.144.3` endpoint, Guardian used the prior auto-review policy, request format, prompting, and tools restored by `0.144.2`, not the superseded `0.144.0` prompt update.

The official `0.144.3` note describes a version-only release with no merged pull-request changes, while tag ancestry includes direct commit `8a4d35a` for the advanced reasoning picker before the release-note/version commit. Both evidence sources are preserved; neither the picker nor Guardian is claimed as package-owned runtime behavior.

## Relationships

- **Related guides**: [[claude-code]], [[agent-harness-anatomy]]
- **Related rules**: [[r006]], [[r010]]

## Sources

- `guides/openai-codex/01-version-compatibility.md` - Codex release compatibility decisions
