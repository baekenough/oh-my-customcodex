#!/usr/bin/env bash
set -euo pipefail

# auto-dev token spend tracker.
# Trigger: PostToolUse on Agent/Task during auto-dev pipeline.
# Protocol: stdin JSON -> append JSONL estimate -> stdout pass-through, exit 0.

input=$(cat)
trap 'printf "%s" "$input"' EXIT

PIPELINE_STATE="${AUTO_DEV_PIPELINE_STATE:-/tmp/.codex-pipeline-auto-dev-${PPID}.json}"
[ -f "$PIPELINE_STATE" ] || exit 0

command -v jq >/dev/null 2>&1 || exit 0

LOG_FILE="${AUTO_DEV_SPEND_LOG:-/tmp/auto-dev-spend-${PPID}.json}"

agent_type=$(printf "%s" "$input" | jq -r '.tool_input.subagent_type // .tool_input.agent_type // "unknown"' 2>/dev/null || echo "unknown")
description=$(printf "%s" "$input" | jq -r '.tool_input.description // ""' 2>/dev/null || echo "")
prompt_text=$(printf "%s" "$input" | jq -r '.tool_input.prompt // .tool_input.message // ""' 2>/dev/null || echo "")
output_text=$(printf "%s" "$input" | jq -r '.tool_output.output // .tool_output // ""' 2>/dev/null || echo "")

phase=$(jq -r '.current_phase // .phase // "unknown"' "$PIPELINE_STATE" 2>/dev/null || echo "unknown")
if [ "$phase" = "unknown" ] || [ "$phase" = "null" ]; then
  phase=$(printf "%s" "$description" | grep -oE '^\[[0-9]+\][^|]*' | head -c 40 || true)
  [ -z "$phase" ] && phase=$(printf "%s" "$description" | head -c 30)
  [ -z "$phase" ] && phase="unknown"
fi

in_bytes=$(printf "%s" "$prompt_text" | wc -c | tr -d ' ')
out_bytes=$(printf "%s" "$output_text" | wc -c | tr -d ' ')
tokens_in=$((in_bytes / 4))
tokens_out=$((out_bytes / 4))
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

entry=$(jq -n -c \
  --arg ts "$ts" \
  --arg phase "$phase" \
  --arg agent "$agent_type" \
  --argjson tin "$tokens_in" \
  --argjson tout "$tokens_out" \
  '{ts: $ts, phase: $phase, agent: $agent, tokens_in: $tin, tokens_out: $tout}' 2>/dev/null) || exit 0

printf "%s\n" "$entry" >> "$LOG_FILE" 2>/dev/null || true

exit 0
