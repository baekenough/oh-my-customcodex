---
name: visual-verdict
description: Structured visual QA verdict for screenshot-to-reference comparisons
---

# Visual Verdict Skill

Use this skill when a UI task needs a strict visual comparison between one or
more reference images and the current generated screenshot.

## Inputs

- `reference_images[]`: one or more reference image paths
- `generated_screenshot`: current output screenshot path
- `category_hint`: optional UI category, such as `dashboard`, `landing-page`, or `editor`

## Output Contract

Return JSON only:

```json
{
  "score": 0,
  "verdict": "revise",
  "category_match": false,
  "differences": ["..."],
  "suggestions": ["..."],
  "reasoning": "short explanation"
}
```

Rules:
- `score` is an integer from 0 to 100.
- `verdict` is `pass`, `revise`, or `fail`.
- `category_match` is true only when the screenshot matches the intended UI category.
- `differences[]` lists concrete visual mismatches.
- `suggestions[]` lists concrete next edits tied to the mismatches.
- `reasoning` is one or two short sentences.

## Threshold And Loop

- Target pass threshold is `score >= 90`.
- If `score < 90`, continue editing and rerun `$visual-verdict` before the next edit.
- Persist useful verdict evidence in `.omx/state/{scope}/ralph-progress.json` when Ralph is active.

## Debug Visualization

Pixel diff or pixelmatch overlays are secondary debugging aids. They help locate
hotspots, but `$visual-verdict` remains the authoritative pass/fail signal.
