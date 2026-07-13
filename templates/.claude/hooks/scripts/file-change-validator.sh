#!/bin/bash
# File validation hook for Claude FileChanged and Codex PostToolUse payloads.
# Advisory warning when important files are modified.

command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // .tool // ""' 2>/dev/null)
file_path=$(echo "$input" | jq -r '.file_path // .tool_input.file_path // ""' 2>/dev/null)
change_type=$(echo "$input" | jq -r '.change_type // "modified"' 2>/dev/null)

if [ -z "$file_path" ] && [ "$tool_name" = "apply_patch" ]; then
  patch_command=$(echo "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
  file_path=$(
    printf '%s\n' "$patch_command" |
      sed -nE 's/^\*\*\* (Add|Update|Delete) File: (.+)$/\2/p' |
      head -n 1
  )
fi

if [ -z "$file_path" ]; then
  echo "$input"
  exit 0
fi

echo "[Hook] External file change detected: ${change_type} ${file_path}" >&2

# Warn about important files
case "$file_path" in
  AGENTS.md|*/AGENTS.md|hooks.json|*/hooks.json|settings*.json|*/settings*.json)
    echo "[Hook] WARNING: Configuration file changed externally — re-read recommended" >&2
    ;;
  *.lock|*lockfile*)
    echo "[Hook] Lock file changed — dependency state may have shifted" >&2
    ;;
esac

echo "$input"
