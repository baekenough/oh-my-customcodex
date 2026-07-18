#!/usr/bin/env bash
# shell-reserved-var-advisor.sh — advisory guard for zsh/bash special variable assignments.
# Trigger: PreToolUse (Bash matcher)

set -euo pipefail

input=$(cat)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null || true)

if [ -z "$command" ]; then
  printf '%s' "$input"
  exit 0
fi

# zsh exposes several lowercase special parameters as read-only or semantically
# dangerous. `status=...` is the frequent footgun in polling snippets; `path`
# and `argv` are arrays/special parameters. Match assignment starts after common
# shell separators or whitespace, but do not match safe names like run_status=.
if printf '%s\n' "$command" | grep -Eq '(^|[[:space:];&|])(status|path|argv)[[:space:]]*='; then
  echo '[Hook] WARNING: reserved shell variable assignment detected (R020/#1491).' >&2
  echo '[Hook] Avoid zsh/bash special names: status, path, argv.' >&2
  echo '[Hook] Use safe names such as run_status, cmd_path, or args before executing.' >&2
fi

# Remove quoted spans before checking URL metacharacters. This is deliberately
# advisory: it catches common shell hazards after a Bash payload reaches the
# hook. It cannot prevent a JavaScript/template parse failure that happens
# before any shell payload exists, and it does not pretend to be a shell parser.
unquoted_command=$(printf '%s\n' "$command" | sed -E "s/\"[^\"]*\"//g; s/'[^']*'//g")
if printf '%s\n' "$unquoted_command" | grep -Eq '(^|[;&|[:space:]])gh[[:space:]]+api([[:space:]]+[^;&|[:space:]]+)*[[:space:]]+[^;&|[:space:]]*[?&][^;&|[:space:]]*'; then
  echo '[Hook] WARNING: quote gh api URLs containing ? or & before execution.' >&2
fi

if printf '%s\n' "$unquoted_command" | grep -Eq '(^|[;&|[:space:]])gh[[:space:]]+api([[:space:]][^;&|]*)?[[:space:]]-[fF][[:space:]]+body='; then
  echo '[Hook] WARNING: stage mutation bodies in reviewed JSON and use gh api --input.' >&2
fi

if printf '%s\n' "$command" | grep -Eq 'trap[[:space:]]+"[^"]*[$][{]?[A-Za-z_][A-Za-z0-9_]*[}]?[^"]*"[[:space:]]+EXIT'; then
  echo '[Hook] WARNING: double-quoted EXIT trap expands variables at registration; use a named cleanup function.' >&2
fi

printf '%s' "$input"
