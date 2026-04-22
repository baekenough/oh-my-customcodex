#!/bin/bash
# Block Bash write operations targeting .claude/ sensitive paths.
# Claude Code can surface a sensitive-file permission prompt before allow rules
# or bypassPermissions are evaluated, so fail fast before the command runs.

set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

if [ -z "$cmd" ]; then
  echo "$input"
  exit 0
fi

targets_claude=0
if [[ "$cmd" =~ \.claude/ ]]; then
  targets_claude=1
fi

writes_claude=0
if [[ "$cmd" =~ (^|[[:space:]])(cp|mv|install|rsync|tee|touch|mkdir|ln)[[:space:]] ]]; then
  writes_claude=1
elif [[ "$cmd" =~ sed[[:space:]]+-i ]] || [[ "$cmd" =~ perl[[:space:]]+-pi ]]; then
  writes_claude=1
elif [[ "$cmd" =~ [\>]{1,2}[[:space:]]*[^[:space:]]*\.claude/ ]]; then
  writes_claude=1
fi

if [ "$targets_claude" -eq 1 ] && [ "$writes_claude" -eq 1 ]; then
  echo "[Hook] BLOCKED: Bash write targeting .claude/ sensitive path" >&2
  echo "[Hook] Command: $cmd" >&2
  echo "[Hook] Use Write/Edit or the repo's managed sync/update path instead of Bash for .claude/ changes." >&2
  exit 2
fi

echo "$input"
