# Autonomous Challenge Lessons

This guide captures repeatable lessons from long autonomous runs where the agent must inspect an existing challenge environment, produce a fix, and verify the result without frequent human steering.

## Start With Ground Truth

Before implementing a guessed mechanism, check whether the environment already contains an answer artifact, compiled fix, reference binary, fixture, or expected-output file.

Required first-pass questions:

1. Is there a supplied fix artifact, golden output, or reference implementation?
2. Which runtime version and mapping namespace are actually present?
3. Which identifiers are proven by code inspection rather than inferred from memory?
4. Which launcher or environment flags are being used, and what do they mean?

## Repeated Failure Discipline

If the same critical error appears twice, stop repeating the launch or tool call. Re-check the option, permission, process state, or single-instance constraint that may make the command invalid.

Examples:

- Tool permission denial: do not repeat the exact same tool call; switch evidence path.
- Launcher flag failure: read the flag meaning before another launch.
- Single-instance process collision: check and clean the process state before relaunch.
- Background command output loss: locate the output file or rerun through a managed log path.

## Parallel Work Heuristic

When a single command is about to process dozens of independent files, downloads, or checks, split it into bounded parallel lanes instead of making one long opaque shell run.

Use this when:

- There are about 30 or more independent units.
- Failures can be isolated by chunk.
- Results can be merged deterministically.

## QA Evidence

QA reports must quote identifiers from the target code before using them. Selectors, `data-testid` values, mapping names, CLI flags, and config keys are not valid unless read or grepped from the project.

## GUI Verification

For visual or interactive tasks, collect direct browser, screenshot, or runtime evidence when possible. If only indirect evidence is available, label it as indirect and explain what could not be captured.
