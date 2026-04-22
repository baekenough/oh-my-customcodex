# Repository Guidance

- `oh-my-customcodex` is a child package of `oh-my-customcode`.
- This repository is managed locally with `omcustomcodex`.
- Do not use or document `omcustom` in this repository; that command is reserved for `oh-my-customcode`.
- Use `omcustomcodex` in shell examples and operator guidance.
- Repo-local response contract:
  - Start responses with an agent identification block.
  - If no skill is active, still show `Agent` and `Status`.
  - Prefer this visible format:

    ```text
    ┌─ Agent: Codex (gpt-5.4)
    ├─ Skill: <active-skill-or-routing-surface>
    └─ Status: <current-action-or-verdict>
    ```
- Preserve upstream behavior, structure, naming patterns, release flow, CI intent, and package shape unless the change is required to convert the provider boundary.
- The core porting purpose of this repository is: take the Claude Code native harness from `oh-my-customcode` and make it run on top of a GPT Codex + OMX stack in `oh-my-customcodex`.
- Treat this repository as the child-package port that preserves parent-package behavior while moving the harness onto GPT Codex + OMX, not as an independent redesign.
- Follow the upstream publish pattern:
  - npm package: `oh-my-customcodex`
  - GitHub Packages package: `@baekenough/oh-my-customcodex`
