#!/bin/bash
# R010 git-delegation-guard hook
# Warns when git operations are delegated to a non-mgr-gitnerd agent via Agent/subagent tool.
# WARN only - does NOT block (exit 0, passes input through).
#
# PPID Scoping Convention:
#   All session-scoped temp files MUST use $PPID (Claude Code parent PID),
#   NOT $$ (subprocess PID which changes per hook invocation).
#   Pattern: /tmp/.codex-{purpose}-${PPID}
#   See also: agent-teams-advisor.sh, context-budget-advisor.sh, stuck-detector.sh

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

agent_type=$(json_string_field '.tool_input.subagent_type // ""' 'subagent_type')
prompt=$(json_string_field '.tool_input.prompt // ""' 'prompt')

# R010 violation tracking file (PPID-scoped for session persistence)
VIOLATION_FILE="/tmp/.codex-r010-violations-${PPID}"

# Only warn when the delegated agent is NOT mgr-gitnerd
if [ "$agent_type" != "mgr-gitnerd" ]; then
  git_keywords=(
    "git add"
    "git commit"
    "git push"
    "git revert"
    "git merge"
    "git rebase"
    "git checkout"
    "git branch"
    "git reset"
    "git cherry-pick"
    "git tag"
  )

  for keyword in "${git_keywords[@]}"; do
    if echo "$prompt" | grep -qi "$keyword"; then
      echo "[Hook] WARNING: R010 violation detected - git operation ('$keyword') delegated to '$agent_type' instead of 'mgr-gitnerd'" >&2
      echo "[Hook] Per R010, all git operations (commit/push/branch/merge/etc.) MUST be delegated to mgr-gitnerd" >&2

      # Record violation for R021 promotion tracking
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $keyword $agent_type" >> "$VIOLATION_FILE"
      violation_count=$(wc -l < "$VIOLATION_FILE" 2>/dev/null | tr -d ' ')
      if [ "$violation_count" -ge 3 ]; then
        echo "[Hook] R010 violations: ${violation_count} this session — R021 promotion threshold reached" >&2
      fi

      break
    fi
  done
fi

# Always pass through - this hook is advisory only
echo "$input"
