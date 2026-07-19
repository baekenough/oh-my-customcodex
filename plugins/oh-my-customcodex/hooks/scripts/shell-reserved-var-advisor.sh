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

# Remove data-only quoted-heredoc bodies before shell-token inspection while
# preserving bodies supplied directly or through a pipeline to bash/sh/zsh.
quoted_heredoc_executes_shell() {
  local opener="$1"
  local delimiter="$2"
  local before_heredoc="${opener%%<<*}"
  local assignment_prefix="([A-Za-z_][A-Za-z0-9_]*=[^;&|()[:space:]]*[[:space:]]+)*"
  local shell_prefix="${assignment_prefix}((command|exec)[[:space:]]+)?(env([[:space:]]+-[^;&|()[:space:]]+)*[[:space:]]+${assignment_prefix})?"
  local direct_shell_pattern="(^|[;&|()])[[:space:]]*${shell_prefix}(bash|sh|zsh)([[:space:]][^;&|()]*)?$"
  local piped_shell_pattern="<<-?[[:space:]]*([\"'])${delimiter}([\"'])[[:space:]]*\\|[[:space:]]*${shell_prefix}(bash|sh|zsh)([[:space:]]|$)"

  [[ "$before_heredoc" =~ $direct_shell_pattern ]] || [[ "$opener" =~ $piped_shell_pattern ]]
}

strip_quoted_heredoc_bodies() {
  local source_text="$1"
  local delimiter=""
  local strip_tabs=0
  local preserve_body=0
  local heredoc_pattern="<<(-?)[[:space:]]*([\"'])([A-Za-z_][A-Za-z0-9_]*)([\"'])"
  local line comparison

  while IFS= read -r line || [ -n "$line" ]; do
    if [ -n "$delimiter" ]; then
      comparison="$line"
      if [ "$strip_tabs" -eq 1 ]; then
        while [[ "$comparison" == $'\t'* ]]; do
          comparison="${comparison#$'\t'}"
        done
      fi
      if [ "$comparison" = "$delimiter" ]; then
        printf '%s\n' "$line"
        delimiter=""
        strip_tabs=0
        preserve_body=0
      elif [ "$preserve_body" -eq 1 ]; then
        printf '%s\n' "$line"
      else
        printf '\n'
      fi
      continue
    fi

    printf '%s\n' "$line"
    if [[ "$line" =~ $heredoc_pattern ]] &&
      [ "${BASH_REMATCH[2]}" = "${BASH_REMATCH[4]}" ]; then
      delimiter="${BASH_REMATCH[3]}"
      [ "${BASH_REMATCH[1]}" = '-' ] && strip_tabs=1 || strip_tabs=0
      quoted_heredoc_executes_shell "$line" "$delimiter" && preserve_body=1 || preserve_body=0
    fi
  done <<< "$source_text"
}

strip_quoted_literals() {
  printf '%s\n' "$1" | sed -E "s/\"[^\"]*\"//g; s/'[^']*'//g"
}

# Inspect unquoted top-level shell text plus recursively sanitized literal
# scripts passed to shell -c/eval. This keeps executable nested shell payloads
# visible without treating normal quoted search data as commands.
build_shell_inspection_command() {
  local source_text="$1"
  local nested_shell_pattern="(^|.*[;&|[:space:]])(bash|sh|zsh)[[:space:]]+-[A-Za-z]*c[A-Za-z]*[[:space:]]*([\"'])(.*)([\"'])"
  local eval_pattern="(^|.*[;&|[:space:]])eval[[:space:]]*([\"'])(.*)([\"'])"
  local trap_pattern="(^|.*[;&|[:space:]])trap[[:space:]]*([\"'])(.*)([\"'])[[:space:]]+EXIT([;&|[:space:]]|$)"
  local line

  strip_quoted_literals "$source_text"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ $nested_shell_pattern ]] &&
      [ "${BASH_REMATCH[3]}" = "${BASH_REMATCH[5]}" ]; then
      strip_quoted_literals "${BASH_REMATCH[4]}"
    fi
    if [[ "$line" =~ $eval_pattern ]] &&
      [ "${BASH_REMATCH[2]}" = "${BASH_REMATCH[4]}" ]; then
      strip_quoted_literals "${BASH_REMATCH[3]}"
    fi
    if [[ "$line" =~ $trap_pattern ]] &&
      [ "${BASH_REMATCH[2]}" = "${BASH_REMATCH[4]}" ]; then
      printf '%s\n' "$line"
    fi
  done <<< "$source_text"
}

heredoc_stripped_command=$(strip_quoted_heredoc_bodies "$command")
inspection_command=$(build_shell_inspection_command "$heredoc_stripped_command")

# zsh exposes several lowercase special parameters as read-only or semantically
# dangerous. `status=...` is the frequent footgun in polling snippets; `path`
# and `argv` are arrays/special parameters. Match assignment starts after common
# shell separators or whitespace, but do not match safe names like run_status=.
if printf '%s\n' "$inspection_command" | grep -Eq '(^|[[:space:];&|])(status|path|argv)[[:space:]]*='; then
  echo '[Hook] WARNING: reserved shell variable assignment detected (R020/#1491).' >&2
  echo '[Hook] Avoid zsh/bash special names: status, path, argv.' >&2
  echo '[Hook] Use safe names such as run_status, cmd_path, or args before executing.' >&2
fi

# Remove quoted spans before checking URL metacharacters. This is deliberately
# advisory: it catches common shell hazards after a Bash payload reaches the
# hook. It cannot prevent a JavaScript/template parse failure that happens
# before any shell payload exists, and it does not pretend to be a shell parser.
unquoted_command=$(strip_quoted_literals "$heredoc_stripped_command")
if printf '%s\n' "$unquoted_command" | grep -Eq '(^|[;&|[:space:]])gh[[:space:]]+api([[:space:]]+[^;&|[:space:]]+)*[[:space:]]+[^;&|[:space:]]*[?&][^;&|[:space:]]*'; then
  echo '[Hook] WARNING: quote gh api URLs containing ? or & before execution.' >&2
fi

if printf '%s\n' "$unquoted_command" | grep -Eq '(^|[;&|[:space:]])gh[[:space:]]+api([[:space:]][^;&|]*)?[[:space:]]-[fF][[:space:]]+body='; then
  echo '[Hook] WARNING: stage mutation bodies in reviewed JSON and use gh api --input.' >&2
fi

if printf '%s\n' "$inspection_command" | grep -Eq 'trap[[:space:]]+"[^"]*[$][{]?[A-Za-z_][A-Za-z0-9_]*[}]?[^"]*"[[:space:]]+EXIT'; then
  echo '[Hook] WARNING: double-quoted EXIT trap expands variables at registration; use a named cleanup function.' >&2
fi

printf '%s' "$input"
