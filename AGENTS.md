# Repository Guidance

- `oh-my-customcodex` is a child package of `oh-my-customcode`.
- Preserve upstream behavior, structure, naming patterns, release flow, CI intent, and package shape unless the change is required to convert the provider boundary.
- The core porting purpose of this repository is: take the Claude Code native harness from `oh-my-customcode` and make it run on top of a GPT Codex + OMX stack in `oh-my-customcodex`.
- Treat this repository as the child-package port that preserves parent-package behavior while moving the harness onto GPT Codex + OMX, not as an independent redesign.
- Follow the upstream publish pattern:
  - npm package: `oh-my-customcodex`
  - GitHub Packages package: `@baekenough/oh-my-customcodex`
