#!/bin/bash
# Codex-native advisory boundary for managed compatibility hooks.
# Reads a Codex hook payload from stdin and emits either no output or one valid
# JSON hook response. All checks are advisory and always exit 0.

set -u

handler="${1:-}"
input=$(cat)
message=""

command -v jq >/dev/null 2>&1 || exit 0
printf '%s' "$input" | jq -e 'type == "object"' >/dev/null 2>&1 || exit 0

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

append_message() {
  local next="$1"
  if [ -n "$message" ]; then
    message="${message}
${next}"
  else
    message="$next"
  fi
}

emit_message() {
  [ -n "$message" ] || exit 0
  hook_event_name=$(printf '%s' "$input" | jq -r '.hook_event_name // ""' 2>/dev/null)
  jq -cn \
    --arg message "$message" \
    --arg hook_event_name "$hook_event_name" \
    '{
      systemMessage: $message,
      hookSpecificOutput: {
        hookEventName: $hook_event_name,
        additionalContext: $message
      }
    }'
  exit 0
}

tool_name=$(printf '%s' "$input" | jq -r '.tool_name // .tool // "unknown"' 2>/dev/null)
tool_command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
heredoc_stripped_command=""
inspection_command=""
unquoted_command=""
shell_inspection_ready=0
prepare_shell_inspection() {
  [ "$shell_inspection_ready" -eq 0 ] || return
  heredoc_stripped_command=$(strip_quoted_heredoc_bodies "$tool_command")
  inspection_command=$(build_shell_inspection_command "$heredoc_stripped_command")
  unquoted_command=$(strip_quoted_literals "$heredoc_stripped_command")
  shell_inspection_ready=1
}
apply_patch_text=$(
  printf '%s' "$input" | jq -r '
    .tool_input as $tool_input
    | if ($tool_input | type) == "object" then
        ([$tool_input.input, $tool_input.patch, $tool_input.content, $tool_input.text, $tool_input.command]
          | map(select(type == "string" and length > 0))
          | .[0] // "")
      elif ($tool_input | type) == "string" then $tool_input
      else ""
      end
  ' 2>/dev/null
) || apply_patch_text=""

case "$handler" in
  destructive-git-guard.sh)
    prepare_shell_inspection
    pattern=""
    case "$inspection_command" in
      *"git reset --hard"*) pattern="git reset --hard" ;;
      *"git clean -fd"*|*"git clean -df"*|*"git clean -fxd"*|*"git clean -xdf"*)
        pattern="git clean -fd/-fdx"
        ;;
      *"git restore"*|*"git checkout -- ."*|*"git checkout -- "*)
        pattern="git restore / git checkout --"
        ;;
      *"git branch -D"*) pattern="git branch -D" ;;
      *"git push --force"*|*"git push -f"*) pattern="git push --force" ;;
    esac
    if [ -n "$pattern" ]; then
      append_message "[Hook] Advisory: destructive git command detected (${pattern}). Verify the target and preserve important work before continuing. Recovery: inspect git status, git diff, and git reflog."
    fi
    ;;

  schema-validator.sh)
    git_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
    if [ -f "${git_root}/.codex/schemas/tool-inputs.json" ]; then
      case "$tool_name" in
        Bash)
          prepare_shell_inspection
          [ -n "$tool_command" ] || append_message "[Schema] Bash: command is empty"
          printf '%s' "$inspection_command" | grep -qE 'rm[[:space:]]+-rf[[:space:]]+/[^.]' && append_message "[Schema] Bash: DANGER — recursive delete from root detected"
          printf '%s' "$inspection_command" | grep -qE '^[[:space:]]*sudo[[:space:]]+' && append_message "[Schema] Bash: elevated privilege command detected"
          printf '%s' "$inspection_command" | grep -qE '> /dev/sd' && append_message "[Schema] Bash: direct disk write detected"
          printf '%s' "$inspection_command" | grep -qE 'mkfs\.' && append_message "[Schema] Bash: filesystem format command detected"
          printf '%s' "$inspection_command" | grep -qE 'curl[[:space:]]+.*\|[[:space:]]*(ba)?sh' && append_message "[Schema] Bash: remote code execution pattern (curl | bash) detected"
          printf '%s' "$inspection_command" | grep -qE 'wget[[:space:]]+.*\|[[:space:]]*(ba)?sh' && append_message "[Schema] Bash: remote code execution pattern (wget | sh) detected"
          printf '%s' "$inspection_command" | grep -qE 'eval[[:space:]]+\$\(' && append_message "[Schema] Bash: dynamic code execution (eval) detected"
          printf '%s' "$inspection_command" | grep -qE 'chmod[[:space:]]+777' && append_message "[Schema] Bash: broad permission grant (chmod 777) detected"
          ;;
        apply_patch)
          [ -n "$apply_patch_text" ] || append_message "[Schema] apply_patch: input is empty or missing"
          ;;
      esac
    fi
    ;;

  secret-filter.sh)
    output=$(
      printf '%s' "$input" | jq -r '
        def normalized_output:
          if . == null then ""
          elif type == "object" then (.output // .stdout // tostring)
          elif type == "string" then
            . as $raw
            | (try ($raw | fromjson) catch $raw) as $parsed
            | if ($parsed | type) == "object"
              then ($parsed.output // $parsed.stdout // ($parsed | tostring))
              else ($parsed | tostring)
              end
          else tostring
          end;
        if has("tool_response") then (.tool_response | normalized_output)
        elif has("tool_output") then (.tool_output | normalized_output)
        else ""
        end
      ' 2>/dev/null
    ) || output=""

    detected=""
    printf '%s' "$output" | grep -qE 'AKIA[0-9A-Z]{16}' && detected="Potential AWS Access Key"
    printf '%s' "$output" | grep -qE 'sk-[a-zA-Z0-9]{32,}' && detected="Potential API key (sk-*)"
    printf '%s' "$output" | grep -qE 'ghp_[a-zA-Z0-9]{36}' && detected="Potential GitHub PAT"
    printf '%s' "$output" | grep -qE -- '-----BEGIN.*PRIVATE KEY-----' && detected="Potential private key"
    printf '%s' "$output" | grep -qE 'Bearer [a-zA-Z0-9._-]{20,}' && detected="Potential Bearer token"
    printf '%s' "$output" | grep -qE 'gho_[a-zA-Z0-9]{36}' && detected="Potential GitHub OAuth token"
    printf '%s' "$output" | grep -qE 'github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}' && detected="Potential GitHub Fine-Grained PAT"
    printf '%s' "$output" | grep -qE 'ghs_[a-zA-Z0-9]{36}' && detected="Potential GitHub Actions token"
    printf '%s' "$output" | grep -qE 'npm_[a-zA-Z0-9]{36}' && detected="Potential npm token"
    printf '%s' "$output" | grep -qE 'xox[bsarp]-[a-zA-Z0-9-]{10,}' && detected="Potential Slack token"
    printf '%s' "$output" | grep -qE 'dckr_pat_[a-zA-Z0-9_-]{20,}' && detected="Potential Docker Hub PAT"
    if [ -n "$detected" ]; then
      append_message "[Security] ${detected} detected in ${tool_name} output. Review output carefully — do not commit or expose secrets."
    fi
    ;;

  file-change-validator.sh)
    file_paths=$(printf '%s' "$input" | jq -r '.file_path // .tool_input.file_path // ""' 2>/dev/null)
    if [ -z "$file_paths" ] && [ "$tool_name" = "apply_patch" ]; then
      file_paths=$(printf '%s\n' "$apply_patch_text" | sed -nE 's/^\*\*\* (Add|Update|Delete) File: (.+)$/\2/p')
    fi
    while IFS= read -r file_path; do
      [ -n "$file_path" ] || continue
      append_message "[Hook] External file change detected: ${file_path}"
      case "$file_path" in
        AGENTS.md|*/AGENTS.md|hooks.json|*/hooks.json|settings*.json|*/settings*.json|config.toml|*/config.toml)
          append_message "[Hook] Configuration file changed — re-read recommended"
          ;;
        *.lock|*-lock.*|*lockfile*) append_message "[Hook] Lock file changed — dependency state may have shifted" ;;
      esac
    done <<EOF
$file_paths
EOF
    ;;

  shell-reserved-var-advisor.sh)
    if [ "$tool_name" = "Bash" ] && [ -n "$tool_command" ]; then
      prepare_shell_inspection
      if printf '%s\n' "$inspection_command" | grep -Eq '(^|[[:space:];&|])(status|path|argv)[[:space:]]*='; then
        append_message '[Hook] Advisory: reserved shell variable assignment detected. Use run_status, cmd_path, or args instead of status, path, or argv.'
      fi

      if printf '%s\n' "$unquoted_command" | grep -Eq '(^|[;&|[:space:]])gh[[:space:]]+api([[:space:]]+[^;&|[:space:]]+)*[[:space:]]+[^;&|[:space:]]*[?&][^;&|[:space:]]*'; then
        append_message '[Hook] Advisory: quote gh api URLs containing ? or & before execution.'
      fi
      if printf '%s\n' "$unquoted_command" | grep -Eq '(^|[;&|[:space:]])gh[[:space:]]+api([[:space:]][^;&|]*)?[[:space:]]-[fF][[:space:]]+body='; then
        append_message '[Hook] Advisory: stage mutation bodies in reviewed JSON and use gh api --input.'
      fi
      if printf '%s\n' "$inspection_command" | grep -Eq 'trap[[:space:]]+"[^"]*[$][{]?[A-Za-z_][A-Za-z0-9_]*[}]?[^"]*"[[:space:]]+EXIT'; then
        append_message '[Hook] Advisory: double-quoted EXIT trap expands variables at registration; use a named cleanup function.'
      fi
    fi
    ;;
esac

emit_message
