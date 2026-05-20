#!/usr/bin/env bash
# agent-capability-precheck.sh — R010 capability gate for Agent/Task spawns
#
# Blocks delegation when the prompt asks for shell/GitHub work but the target
# agent frontmatter does not allow Bash, or explicitly disallows it.

set +e

input="$(cat)"

json_string_field() {
  local jq_expr="$1"
  local key="$2"

  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r "$jq_expr" 2>/dev/null
    return
  fi

  printf '%s' "$input" | sed -nE "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\\1/p" | head -n 1
}

agent_type="$(json_string_field '.tool_input.subagent_type // .tool_input.agent_type // .agent_type // empty' 'subagent_type')"
if [[ -z "$agent_type" ]]; then
  agent_type="$(json_string_field '.tool_input.agent_type // .agent_type // empty' 'agent_type')"
fi
prompt="$(json_string_field '.tool_input.prompt // .tool_input.description // .prompt // .description // empty' 'prompt')"
if [[ -z "$prompt" ]]; then
  prompt="$(json_string_field '.tool_input.description // .description // empty' 'description')"
fi

if [[ -z "$agent_type" || -z "$prompt" ]]; then
  printf '%s' "$input"
  exit 0
fi

shell_pattern='(^|[^[:alnum:]_-])(bash|shell|command|execute|run|gh|git|npm|pnpm|yarn|bun|python|node|curl|jq|sed|awk|make|docker)([[:space:]:;,.]|$)'
if ! printf '%s' "$prompt" | grep -Eiq "$shell_pattern"; then
  printf '%s' "$input"
  exit 0
fi

agent_file=""
for candidate in \
  ".codex/agents/${agent_type}.md" \
  "templates/.claude/agents/${agent_type}.md" \
  ".claude/agents/${agent_type}.md"
do
  if [[ -f "$candidate" ]]; then
    agent_file="$candidate"
    break
  fi
done

if [[ -z "$agent_file" ]]; then
  echo "[Hook] Agent capability pre-check: no frontmatter found for ${agent_type}; proceeding advisory-only" >&2
  printf '%s' "$input"
  exit 0
fi

frontmatter="$(awk '
  BEGIN { in_fm = 0; seen = 0 }
  /^---[[:space:]]*$/ {
    if (seen == 0) { in_fm = 1; seen = 1; next }
    if (in_fm == 1) { exit }
  }
  in_fm == 1 { print }
' "$agent_file")"

has_bash_tool="$(printf '%s\n' "$frontmatter" | awk '
  /^tools:[[:space:]]*$/ { in_tools = 1; next }
  /^[^[:space:]-][^:]*:/ { in_tools = 0 }
  in_tools == 1 && /^[[:space:]]*-[[:space:]]*Bash[[:space:]]*$/ { found = 1 }
  END { print found ? "yes" : "no" }
')"

disallows_bash="no"
if printf '%s\n' "$frontmatter" | grep -Eq '^disallowedTools:[[:space:]]*\[[^]]*Bash[^]]*\]'; then
  disallows_bash="yes"
elif printf '%s\n' "$frontmatter" | awk '
  /^disallowedTools:[[:space:]]*$/ { in_disallowed = 1; next }
  /^[^[:space:]-][^:]*:/ { in_disallowed = 0 }
  in_disallowed == 1 && /^[[:space:]]*-[[:space:]]*Bash[[:space:]]*$/ { found = 1 }
  END { exit found ? 0 : 1 }
'; then
  disallows_bash="yes"
fi

if [[ "$has_bash_tool" != "yes" || "$disallows_bash" == "yes" ]]; then
  echo "[Hook] BLOCKED: Agent capability mismatch for '${agent_type}'" >&2
  echo "[Hook] Prompt appears to require shell/GitHub/command execution, but ${agent_file} does not allow Bash." >&2
  if [[ "$disallows_bash" == "yes" ]]; then
    echo "[Hook] The agent frontmatter explicitly lists disallowedTools: Bash." >&2
  fi
  echo "[Hook] Re-route command work to a Bash-capable agent, or pre-collect command output before delegating." >&2
  exit 2
fi

printf '%s' "$input"
