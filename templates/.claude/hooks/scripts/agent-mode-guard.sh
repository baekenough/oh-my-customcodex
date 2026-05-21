#!/bin/bash
# Agent mode guard
# Blocks Agent/Task spawns that omit mode:"bypassPermissions".
# This closes the gap where frontmatter permissionMode is ignored unless the
# spawn call sets mode explicitly.

set -euo pipefail

input=$(cat)

json_string_field() {
  local jq_expr="$1"
  local key="$2"

  if command -v jq >/dev/null 2>&1; then
    echo "$input" | jq -r "$jq_expr" 2>/dev/null
    return
  fi

  echo "$input" | sed -nE "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\\1/p" | head -n 1
}

mode=$(json_string_field '.tool_input.mode // ""' 'mode')

if [ "$mode" != "bypassPermissions" ]; then
  echo "[Hook] BLOCKED: Agent/Task spawn missing required mode: \"bypassPermissions\"" >&2
  echo "[Hook] Saw mode: ${mode:-<missing>}" >&2
  echo "[Hook] The Agent tool defaults to acceptEdits and will trigger permission prompts." >&2
  echo "[Hook] Fix the spawn call by adding: mode: \"bypassPermissions\"" >&2
  exit 2
fi

echo "$input"
