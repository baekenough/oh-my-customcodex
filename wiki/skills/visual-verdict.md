# visual-verdict

Structured visual QA verdict skill for comparing a generated screenshot against
one or more references.

## Contract

- Inputs: reference image paths, generated screenshot path, optional category hint.
- Output: JSON only with `score`, `verdict`, `category_match`, `differences`,
  `suggestions`, and `reasoning`.
- Pass threshold: `score >= 90`.

Pixel diff evidence is secondary. The JSON verdict remains the authoritative
iteration signal for visual UI work.
