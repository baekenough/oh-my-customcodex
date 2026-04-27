---
name: visual-ralph
description: Visual Ralph orchestration for frontend UI using approved references, Ralph implementation, Visual Verdict scoring, and reproducible design-system evidence
---

# Visual Ralph Skill

Use this skill when the user wants a frontend UI implemented or restyled through
a measured visual loop rather than subjective design feedback.

## Purpose

Create a frontend delivery loop:

`user description or live URL -> approved visual reference -> $ralph implementation -> $visual-verdict + optional pixel diff -> reusable design system`.

For live URL cloning or recreation requests, Visual Ralph owns the flow. Preserve
the URL, viewport, content state, and interaction notes in the handoff instead of
routing new work to a standalone web-clone path.

## Use When

- The user describes a web/app UI and wants implementation.
- The user provides a live URL and wants a measured visual implementation.
- A generated raster mockup or static reference image would clarify the target.
- The task needs screenshot-based pass/fail iteration.
- The final result should leave reusable tokens/components, not only a one-off visual match.

## Do Not Use When

- The user only wants design critique or frontend advice.
- The task is non-visual backend/API work.
- The user supplied a final static reference and only needs a comparison/fix loop; hand directly to `$ralph` with `$visual-verdict`.
- The requested output is a deterministic SVG/vector/code-native asset.

## Workflow

### 1. Ground The Target Repo

Inspect local evidence before choosing stack-specific tactics:
- package manager and scripts,
- frontend framework and routing,
- styling system and design-token conventions,
- screenshot/test tooling,
- existing components that should be reused.

Do not assume React, Vue, Tailwind, Playwright, or another stack without repo evidence.

### 2. Establish The Visual Reference

For live URL work, record:
- source URL and scope note,
- viewport(s), route/state, and seed/login assumptions,
- baseline screenshot path or capture command,
- interaction parity notes,
- known exclusions such as backend/auth/personalized data/third-party widget parity.

For generated UI concepts, use `$imagegen` to produce the reference. Prompt for a
`ui-mockup` with viewport/aspect ratio, intended surface, hierarchy, typography,
color direction, exact text, and a ban on unrequested logos/watermarks.

For project-bound implementation, save the approved reference in the workspace,
for example `.omx/artifacts/visual-ralph/<slug>/reference.png`.

### 3. Require User Approval

Stop after reference generation or URL-derived reference capture and ask the user
to approve one reference image/state or request targeted changes. Do not start
frontend implementation before approval.

### 4. Hand Off To Ralph

Invoke `$ralph` with:
- approved reference image path or URL-derived artifact,
- source URL and scope note when relevant,
- viewport/content state,
- detected repo/frontend context,
- exact screenshot command and output path,
- the completion checklist below.

### 5. Use Visual Verdict Before Every Next Edit

For each visual iteration:
1. Capture the current screenshot with recorded viewport/state.
2. Run `$visual-verdict` against the approved reference.
3. Treat the JSON verdict as authoritative.
4. If `score < 90`, convert `differences[]` and `suggestions[]` into the next edit plan.
5. Rerun before the next edit.

Pixel diff is secondary evidence only. It helps translate mismatch hotspots into
concrete edits, but it does not replace `$visual-verdict`.

### 6. Leave A Reproducible Design System

Encode the match in repo-native reusable artifacts: CSS variables, theme tokens,
Tailwind config, component variants, stories, docs, or the existing equivalent.
Capture applicable colors, spacing, typography, radii, shadows, and key states.

## Completion Checklist

- Approved reference or URL-derived artifact is saved in the workspace.
- Screenshot reproduction command, viewport, route/state, and output paths are documented.
- Final `$visual-verdict` score is `>= 90`.
- Pixel diff or overlay evidence is recorded when useful.
- Design tokens/components are repo-native and reusable.
- Build/lint/test or the repo equivalent passes.
- Remaining visual differences are documented with rationale.

## Handoff Template

```text
$ralph "Implement the approved frontend reference.
Reference: <workspace-reference-image-or-url-derived-artifact>
Source URL: <url and permission/scope note, if relevant>
Viewport/content state: <viewport, route/state, seed/login assumptions>
Interaction parity notes: <visible controls and known exclusions>
Route/surface: <route or component>
Screenshot command: <command and viewport>
Use $visual-verdict before every next edit; pass threshold score >= 90.
Use pixel diff only as secondary debug evidence.
Extract reusable design tokens/components.
Run build/lint/test before completion.
Do not make major design pivots unless explicitly requested."
```

Task: {{ARGUMENTS}}
