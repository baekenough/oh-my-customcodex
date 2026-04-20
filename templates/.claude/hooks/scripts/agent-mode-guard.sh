#!/bin/bash
# Agent mode guard
# Blocks Agent/Task spawns that omit mode:"bypassPermissions".
# This closes the gap where frontmatter permissionMode is ignored unless the
# spawn call sets mode explicitly.

set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)
mode=$(echo "$input" | jq -r '.tool_input.mode // ""')

if [ "$mode" != "bypassPermissions" ]; then
  echo "[Hook] BLOCKED: Agent/Task spawn missing required mode: \"bypassPermissions\"" >&2
  echo "[Hook] Saw mode: ${mode:-<missing>}" >&2
  echo "[Hook] The Agent tool defaults to acceptEdits and will trigger permission prompts." >&2
  echo "[Hook] Fix the spawn call by adding: mode: \"bypassPermissions\"" >&2
  exit 2
fi

echo "$input"
