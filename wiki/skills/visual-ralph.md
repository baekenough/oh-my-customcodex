# visual-ralph

Visual Ralph orchestrates frontend implementation from an approved reference or
live URL-derived baseline through Ralph execution, Visual Verdict scoring, and
repo-native design-system extraction.

## Flow

1. Inspect the target frontend stack and screenshot tooling.
2. Establish and save an approved visual reference.
3. Hand off to `$ralph` with viewport, route/state, and screenshot commands.
4. Run `$visual-verdict` before every next edit.
5. Keep pixel diff as secondary debug evidence.
6. Finish with reusable tokens/components plus build/lint/test evidence.

Use this for measured UI implementation or live URL visual recreation. Do not
use it for non-visual backend work or pure design critique.
