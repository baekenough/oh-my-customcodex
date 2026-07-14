#!/bin/bash
# Stage-blocking hook: blocks Write/Edit in non-implement stages
# Mutual Exclusion: This hook is mutually exclusive with autonomous mode (R010).
# When /tmp/.codex-dev-stage exists, autonomous mode cannot be activated.
# When /tmp/.codex-autonomous-$PPID exists, /structured-dev-cycle should not be started.
# See: MUST-orchestrator-coordination.md "Autonomous Execution Mode" section.
if [ -f /tmp/.codex-dev-stage ]; then
  stage=$(cat /tmp/.codex-dev-stage | tr -d '[:space:]')
  if [ -z "$stage" ]; then exit 0; fi
  case "$stage" in
    plan|verify-plan|verify-impl|compound|done)
      echo "⛔ BLOCKED: Write/Edit disabled in '$stage' stage. Only allowed during 'implement' stage. Use 'echo implement > /tmp/.codex-dev-stage' to transition."
      exit 2
      ;;
  esac
fi
