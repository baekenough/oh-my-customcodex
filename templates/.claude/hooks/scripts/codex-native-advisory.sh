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
    pattern=""
    case "$tool_command" in
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
          [ -n "$tool_command" ] || append_message "[Schema] Bash: command is empty"
          printf '%s' "$tool_command" | grep -qE 'rm[[:space:]]+-rf[[:space:]]+/[^.]' && append_message "[Schema] Bash: DANGER — recursive delete from root detected"
          printf '%s' "$tool_command" | grep -qE '^[[:space:]]*sudo[[:space:]]+' && append_message "[Schema] Bash: elevated privilege command detected"
          printf '%s' "$tool_command" | grep -qE '> /dev/sd' && append_message "[Schema] Bash: direct disk write detected"
          printf '%s' "$tool_command" | grep -qE 'mkfs\.' && append_message "[Schema] Bash: filesystem format command detected"
          printf '%s' "$tool_command" | grep -qE 'curl[[:space:]]+.*\|[[:space:]]*(ba)?sh' && append_message "[Schema] Bash: remote code execution pattern (curl | bash) detected"
          printf '%s' "$tool_command" | grep -qE 'wget[[:space:]]+.*\|[[:space:]]*(ba)?sh' && append_message "[Schema] Bash: remote code execution pattern (wget | sh) detected"
          printf '%s' "$tool_command" | grep -qE 'eval[[:space:]]+\$\(' && append_message "[Schema] Bash: dynamic code execution (eval) detected"
          printf '%s' "$tool_command" | grep -qE 'chmod[[:space:]]+777' && append_message "[Schema] Bash: broad permission grant (chmod 777) detected"
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
      if printf '%s\n' "$tool_command" | grep -Eq '(^|[[:space:];&|])(status|path|argv)[[:space:]]*='; then
        append_message '[Hook] Advisory: reserved shell variable assignment detected. Use run_status, cmd_path, or args instead of status, path, or argv.'
      fi

      unquoted_command=$(printf '%s\n' "$tool_command" | sed -E "s/\"[^\"]*\"//g; s/'[^']*'//g")
      if printf '%s\n' "$unquoted_command" | grep -Eq '(^|[;&|[:space:]])gh[[:space:]]+api([[:space:]]+[^;&|[:space:]]+)*[[:space:]]+[^;&|[:space:]]*[?&][^;&|[:space:]]*'; then
        append_message '[Hook] Advisory: quote gh api URLs containing ? or & before execution.'
      fi
      if printf '%s\n' "$unquoted_command" | grep -Eq '(^|[;&|[:space:]])gh[[:space:]]+api([[:space:]][^;&|]*)?[[:space:]]-[fF][[:space:]]+body='; then
        append_message '[Hook] Advisory: stage mutation bodies in reviewed JSON and use gh api --input.'
      fi
      if printf '%s\n' "$tool_command" | grep -Eq 'trap[[:space:]]+"[^"]*[$][{]?[A-Za-z_][A-Za-z0-9_]*[}]?[^"]*"[[:space:]]+EXIT'; then
        append_message '[Hook] Advisory: double-quoted EXIT trap expands variables at registration; use a named cleanup function.'
      fi
    fi
    ;;
esac

emit_message
