---
title: Project Overview
category: reference
tags:
  - overview
  - codex
  - omx
  - cli
  - port
updated: 2026-04-22
source:
  - README_ko.md
  - package.json
  - src/index.ts
  - src/core/layout.ts
  - src/cli/init.ts
  - src/cli/index.ts
---

# Project Overview

## Summary

`oh-my-customcodex` is a child package of `oh-my-customcode` that ports the existing agent harness onto a `GPT Codex + OMX` stack.

In practice, this repository is not a single end-user app. It is a CLI package that installs, updates, and manages an agent runtime inside other projects.

## What It Installs

Running `omcustomcodex init` in a target repository installs a Codex-oriented runtime layout:

- `AGENTS.md` as the entry point for Codex + OMX sessions
- `.codex/` for agents, rules, hooks, contexts, and ontology
- `.agents/skills/` for reusable skills
- `guides/` for shared reference material

The provider-aware layout maps Codex and Claude runtimes separately and defaults to the Codex layout in this package.

## Core Role Of The Package

The package's main job is to provide the `omcustomcodex` CLI and supporting library APIs for:

- project initialization
- runtime updates
- installation health checks
- sync and snapshot workflows
- local registry management
- security checks
- a small Web UI control surface

## Operating Model

The repository treats the agent system like a compiled environment:

- skills are the reusable source material
- agents are generated or installed execution surfaces
- rules constrain behavior
- guides serve as shared reference documentation
- routing skills connect user intent to the right specialist

This explains why the repository contains a large amount of templates, guides, and agent metadata in addition to the CLI source code.

## Repository Shape

The top-level package is the main distributable:

- package name: `oh-my-customcodex`
- primary binary: `omcustomcodex`

The workspace also contains supporting packages:

- `@omcustom/eval-core` for agent evaluation workflows
- `@omcustom/serve` for the Svelte-based Web UI

## Important Context

This repository should be understood as a portability layer, not a clean-sheet redesign.

Its project guidance says to preserve upstream behavior and structure from `oh-my-customcode` while moving the harness boundary onto GPT Codex + OMX. That is why Claude-oriented artifacts and porting terminology still appear across the codebase and docs.

## See Also

- `README.md`
- `README_ko.md`
- `docs/guide/getting-started.md`
