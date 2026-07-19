#!/bin/bash
# Advisory guard for destructive git commands.
# Warns before commands that can discard worktree or branch state.
# This hook is advisory only: it prints warnings to stderr, records a
# PPID-scoped event, echoes the original hook input, and exits 0.

input=$(cat)
cmd=""

if command -v jq >/dev/null 2>&1; then
  cmd=$(echo "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
elif command -v node >/dev/null 2>&1; then
  cmd=$(
    printf '%s' "$input" | node -e 'let s = ""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => { try { const j = JSON.parse(s); process.stdout.write(j?.tool_input?.command || ""); } catch { process.exit(0); } });' 2>/dev/null
  )
fi

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

warn() {
  local pattern="$1"
  local command="$2"
  local violation_file="/tmp/.codex-destructive-git-violations-${PPID}"

  echo "[Hook] WARNING: destructive git command detected: ${pattern}" >&2
  echo "[Hook] Command: ${command}" >&2
  echo "[Hook] Verify target, preserve important work, and get explicit approval before continuing." >&2
  echo "[Hook] Recovery: inspect 'git status', 'git diff', and 'git reflog' before attempting repair." >&2

  printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$pattern" "$command" >> "$violation_file"
}

if [ -n "$cmd" ]; then
  inspection_command=$(build_shell_inspection_command "$(strip_quoted_heredoc_bodies "$cmd")")
  case "$inspection_command" in
    *"git reset --hard"*)
      warn "git reset --hard" "$cmd"
      ;;
    *"git clean -fd"*|*"git clean -df"*|*"git clean -fxd"*|*"git clean -xdf"*)
      warn "git clean -fd/-fdx" "$cmd"
      ;;
    *"git restore"*|*"git checkout -- ."*|*"git checkout -- *"*)
      warn "git restore / git checkout --" "$cmd"
      ;;
    *"git branch -D"*)
      warn "git branch -D" "$cmd"
      echo "[Hook] Check whether the branch is merged before deleting it." >&2
      ;;
    *"git push --force"*|*"git push -f"*)
      warn "git push --force" "$cmd"
      ;;
  esac
fi

echo "$input"
exit 0
