---
title: "Git Safety Guide"
type: guide
updated: 2026-05-15
sources:
  - guides/git-safety/README.md
related:
  - [[mgr-gitnerd]]
  - [[git-worktree-workflow]]
  - [[r001]]
---

# Git Safety Guide

Reference documentation for preserving user work around destructive git operations.

## Overview

This guide defines preflight and recovery patterns for commands that can discard tracked changes, delete untracked files, delete branches, or rewrite remote history. It supports R001 safety enforcement, `mgr-gitnerd` release workflows, and the destructive git advisory hook.

## Key Topics

- Destructive command risk table for `git reset --hard`, `git clean -fd`, broad restore/checkout, branch deletion, and force push.
- Preflight checklist for status inspection, diff preservation, branch merge checks, and release namespace collisions.
- Recovery checklist centered on `git reflog`, `git status`, and preserved patches.
- Agent workflow rules preventing verification agents from cleaning the worktree to create an artificial baseline.

## Relationships

- **Used by agents**: [[mgr-gitnerd]], [[mgr-sauron]]
- **Related rules**: [[r001]]
- **See also**: [[git-worktree-workflow]]

## Sources

- `guides/git-safety/README.md`
