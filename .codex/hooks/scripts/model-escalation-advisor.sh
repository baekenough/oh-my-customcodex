#!/bin/bash
set -euo pipefail

# Dependency check: exit silently if jq is unavailable.
command -v jq >/dev/null 2>&1 || exit 0

# Reasoning Escalation Advisor Hook
# Trigger: PreToolUse, tool == "Task" || tool == "Agent"
# Purpose: Advise role/config reasoning-effort changes when failure patterns are detected.
# Protocol: stdin JSON -> process -> stdout pass-through, exit 0 always.

input=$(cat)
agent_type=$(echo "$input" | jq -r '.tool_input.agent_type // .tool_input.subagent_type // "unknown"')

is_supported_effort() {
  case "$1" in
    none|minimal|low|medium|high|xhigh|ultra|max) return 0 ;;
    *) return 1 ;;
  esac
}

read_toml_effort() {
  local file="$1"
  local value
  [ -f "$file" ] || return 1
  value=$(awk '
    /^[[:space:]]*\[/ { exit }
    /^[[:space:]]*model_reasoning_effort[[:space:]]*=[[:space:]]*"[^"]+"/ {
      line = $0
      sub(/^[^=]*=[[:space:]]*"/, "", line)
      sub(/".*$/, "", line)
      print line
      exit
    }
  ' "$file" 2>/dev/null || true)
  is_supported_effort "$value" || return 1
  printf '%s\n' "$value"
}

find_project_file() {
  local relative_path="$1"
  local directory="${OMX_PROJECT_ROOT:-$PWD}"
  local parent
  while [ -n "$directory" ]; do
    if [ -f "$directory/$relative_path" ]; then
      printf '%s\n' "$directory/$relative_path"
      return 0
    fi
    parent=$(dirname "$directory")
    [ "$parent" != "$directory" ] || break
    directory="$parent"
  done
  return 1
}

resolve_role_effort() {
  local codex_home="${CODEX_HOME:-${HOME:-}/.codex}"
  local project_role=""
  local project_config=""
  local value=""

  case "$agent_type" in
    ""|unknown|*[!A-Za-z0-9_-]*) return 1 ;;
  esac

  # OMX runtime role overrides are authoritative over generated/default role TOML.
  if [ -n "$codex_home" ] && [ -f "$codex_home/.omx-config.json" ]; then
    value=$(jq -r --arg role "$agent_type" '.agentReasoning[$role] // empty' "$codex_home/.omx-config.json" 2>/dev/null || true)
    if is_supported_effort "$value"; then
      printf '%s\t%s\n' "$value" "$codex_home/.omx-config.json agentReasoning.${agent_type}"
      return 0
    fi
  fi

  project_role=$(find_project_file ".codex/agents/${agent_type}.toml" || true)
  if [ -n "$project_role" ]; then
    value=$(read_toml_effort "$project_role" || true)
    if [ -n "$value" ]; then
      printf '%s\t%s\n' "$value" "$project_role"
      return 0
    fi
  fi

  if [ -n "$codex_home" ] && [ -f "$codex_home/agents/${agent_type}.toml" ]; then
    value=$(read_toml_effort "$codex_home/agents/${agent_type}.toml" || true)
    if [ -n "$value" ]; then
      printf '%s\t%s\n' "$value" "$codex_home/agents/${agent_type}.toml"
      return 0
    fi
  fi

  project_config=$(find_project_file ".codex/config.toml" || true)
  if [ -n "$project_config" ]; then
    value=$(read_toml_effort "$project_config" || true)
    if [ -n "$value" ]; then
      printf '%s\t%s\n' "$value" "$project_config"
      return 0
    fi
  fi

  if [ -n "$codex_home" ] && [ -f "$codex_home/config.toml" ]; then
    value=$(read_toml_effort "$codex_home/config.toml" || true)
    if [ -n "$value" ]; then
      printf '%s\t%s\n' "$value" "$codex_home/config.toml"
      return 0
    fi
  fi
  return 1
}

resolved_effort=$(resolve_role_effort || true)
current_effort=$(printf '%s' "$resolved_effort" | cut -f1)
effort_source=$(printf '%s' "$resolved_effort" | cut -f2-)
current_effort=${current_effort:-inherit}
effort_source=${effort_source:-runtime inheritance}

OUTCOME_FILE="${CODEX_TASK_OUTCOMES_FILE:-/tmp/.codex-task-outcomes-${PPID}}"
if [ ! -f "$OUTCOME_FILE" ]; then
  echo "$input"
  exit 0
fi

FAILURE_THRESHOLD=2
CONSECUTIVE_THRESHOLD=3
COOLDOWN=5

agent_failures=0
if [ -n "$agent_type" ] && [ "$agent_type" != "unknown" ]; then
  agent_failures=$(jq -s --arg role "$agent_type" '[.[] | select(.agent_type == $role and .outcome == "failure")] | length' "$OUTCOME_FILE" 2>/dev/null || echo "0")
fi
consecutive_failures=$(tail -n "$CONSECUTIVE_THRESHOLD" "$OUTCOME_FILE" 2>/dev/null | jq -s '[.[] | select(.outcome == "failure")] | length' 2>/dev/null || echo "0")

next_effort=""
case "$current_effort" in
  none) next_effort="minimal" ;;
  minimal) next_effort="low" ;;
  low) next_effort="medium" ;;
  medium) next_effort="high" ;;
  high) next_effort="xhigh" ;;
  xhigh) next_effort="ultra" ;;
  ultra) next_effort="max" ;;
esac

if [ -n "$next_effort" ]; then
  should_advise=false
  reason=""
  if [ "$agent_failures" -ge "$FAILURE_THRESHOLD" ]; then
    should_advise=true
    reason="${agent_type} failed ${agent_failures}x with effort=${current_effort}"
  elif [ "$consecutive_failures" -ge "$CONSECUTIVE_THRESHOLD" ]; then
    should_advise=true
    reason="${consecutive_failures} consecutive failures"
  fi

  if [ "$should_advise" = true ]; then
    echo "" >&2
    echo "--- [Reasoning Escalation Advisory] ---" >&2
    echo "  Agent type: ${agent_type}" >&2
    echo "  Current model_reasoning_effort: ${current_effort}" >&2
    echo "  Configuration source: ${effort_source}" >&2
    echo "  ⚡ Recommended effort: ${next_effort}" >&2
    echo "  Apply via the role TOML or OMX agentReasoning config; native dispatch has no per-call effort override" >&2
    echo "  Model lane: unchanged; OMX runtime config remains authoritative" >&2
    echo "  Reason: ${reason}" >&2
    echo "----------------------------------------" >&2
  fi
fi

if [ "$current_effort" != "none" ] && [ "$current_effort" != "inherit" ] && [ "$current_effort" != "" ]; then
  recent_successes=$(tail -n "$COOLDOWN" "$OUTCOME_FILE" 2>/dev/null | jq -s '[.[] | select(.outcome == "success")] | length' 2>/dev/null || echo "0")
  if [ "$recent_successes" -ge "$COOLDOWN" ]; then
    lower_effort=""
    case "$current_effort" in
      max) lower_effort="ultra" ;;
      ultra) lower_effort="xhigh" ;;
      xhigh) lower_effort="high" ;;
      high) lower_effort="medium" ;;
      medium) lower_effort="low" ;;
      low) lower_effort="minimal" ;;
      minimal) lower_effort="none" ;;
    esac

    if [ -n "$lower_effort" ]; then
      echo "" >&2
      echo "--- [Reasoning De-escalation Advisory] ---" >&2
      echo "  ↓ Consider effort: ${current_effort} → ${lower_effort}" >&2
      echo "  Apply via the role TOML or OMX agentReasoning config" >&2
      echo "  ${recent_successes} consecutive successes" >&2
      echo "------------------------------------------" >&2
    fi
  fi
fi

echo "$input"
exit 0
