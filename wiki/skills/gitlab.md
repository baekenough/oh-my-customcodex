---
title: GitLab
type: skill
updated: 2026-05-15
sources:
  - .codex/skills/gitlab/SKILL.md
related:
  - [[github]]
  - [[mgr-gitnerd]]
---

# GitLab

Work with GitLab projects, issues, merge requests, CI/CD pipelines, jobs, and repository metadata through `glab` or the GitLab REST API.

## Overview

Provides a GitLab workflow surface for repository triage and operational tasks. It prefers the `glab` CLI when available, falls back to GitLab REST calls when needed, and keeps token handling out of logs and generated output. The skill covers issue search and updates, merge request inspection, pipeline and job checks, repository metadata reads, and read-back verification after mutating operations.

## Key Details

- **Scope**: core
- **User-invocable**: yes
- **Command**: `/gitlab`
- **Effort**: not specified

## Relationships

- **Used by agents**: [[mgr-gitnerd]]
- **Related skills**: [[github]], [[mgr-gitnerd]]
- **See also**: [[R001]]

## Sources

- `.codex/skills/gitlab/SKILL.md` — skill definition
