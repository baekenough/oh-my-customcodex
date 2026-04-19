---
title: Browser Automation Guide
type: guide
updated: 2026-04-19
sources:
  - guides/browser-automation/README.md
related:
  - [[playwright-compress]]
  - [[product-strategy]]
  - [[design-shotgun]]
---

# Browser Automation Guide

Reference documentation for authenticated browser sessions, cookie handling, evidence capture, and safe reuse of existing Playwright surfaces.

## Overview

This guide documents the project's preferred browser-automation patterns without importing a second orchestration system. It focuses on session safety, context isolation, evidence capture, and pragmatic reuse of existing Playwright infrastructure.

## Key Topics

- authenticated session handling and cookie import boundaries
- one-context-per-scenario isolation
- screenshot, console, and trace evidence capture
- anti-bot caution and non-abusive automation posture
- reuse of `packages/serve/playwright.config.ts` and existing Playwright test surfaces

## Relationships

- **Related skills**: [[playwright-compress]], [[product-strategy]], [[design-shotgun]]
- **See also**: [[web-scraping-guide]]

## Sources

- `guides/browser-automation/README.md` — browser automation patterns and operational checklist
