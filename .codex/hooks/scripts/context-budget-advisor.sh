#!/bin/bash
set -euo pipefail
HOOK_START=$(date +%s%N 2>/dev/null || echo 0)

# Dependency check: exit silently if jq not available
command -v jq >/dev/null 2>&1 || exit 0

# Context Budget Advisor Hook
# Trigger: PostToolUse (Edit/Write/Agent/Task/Read/Glob/Grep/Bash)
# Purpose: Monitor context usage and advise ecomode activation based on task type
# Protocol: stdin JSON -> stdout pass-through; exit 2 only for continueOnBlock signals

input=$(cat)

# Read context info from status file if available
COST_FILE="/tmp/.codex-cost-${PPID}"
BUDGET_FILE="/tmp/.codex-context-budget-${PPID}"
SIGNAL_FILE="/tmp/.codex-context-budget-signal-${PPID}"

# Initialize budget tracking file
if [ ! -f "$BUDGET_FILE" ]; then
  echo "task_type=general" > "$BUDGET_FILE"
  echo "tool_count=0" >> "$BUDGET_FILE"
  echo "write_count=0" >> "$BUDGET_FILE"
  echo "read_count=0" >> "$BUDGET_FILE"
  echo "agent_count=0" >> "$BUDGET_FILE"
fi

# Read current counts
source "$BUDGET_FILE" 2>/dev/null || true
tool_count=${tool_count:-0}
write_count=${write_count:-0}
read_count=${read_count:-0}
agent_count=${agent_count:-0}

# Determine tool type from input
TOOL=$(echo "$input" | jq -r '.tool_name // ""' 2>/dev/null || echo "")
tool_count=$((tool_count + 1))

case "$TOOL" in
  Write|Edit)
    write_count=$((write_count + 1))
    ;;
  Read|Glob|Grep)
    read_count=$((read_count + 1))
    ;;
  Task|Agent)
    agent_count=$((agent_count + 1))
    ;;
esac

# Infer task type based on tool usage pattern
if [ "$agent_count" -ge 4 ]; then
  task_type="research"
elif [ "$write_count" -gt "$read_count" ] && [ "$write_count" -ge 5 ]; then
  task_type="implementation"
elif [ "$read_count" -gt "$write_count" ] && [ "$read_count" -ge 10 ]; then
  task_type="review"
else
  task_type="general"
fi

# Update budget file
cat > "$BUDGET_FILE" << EOF
task_type=${task_type}
tool_count=${tool_count}
write_count=${write_count}
read_count=${read_count}
agent_count=${agent_count}
EOF

# Determine threshold for current task type
case "$task_type" in
  research)      THRESHOLD=40 ;;
  implementation) THRESHOLD=50 ;;
  review)        THRESHOLD=60 ;;
  management)    THRESHOLD=70 ;;
  *)             THRESHOLD=80 ;;
esac

# Use statusline bridge data when available. Exiting 2 with continueOnBlock=true
# turns a high-context advisory into model-visible feedback without halting.
ctx_pct="0"
ctx_timestamp="0"
if [ -f "$COST_FILE" ]; then
  IFS=$'\t' read -r _cost_usd ctx_pct ctx_timestamp _rl_5h _rl_7d _rl_5h_resets _rl_7d_resets < "$COST_FILE" 2>/dev/null || true
fi

ctx_int="${ctx_pct%%.*}"
case "$ctx_int" in
  ''|*[!0-9]*) ctx_int=0 ;;
esac
case "$ctx_timestamp" in
  ''|*[!0-9]*) ctx_timestamp=0 ;;
esac

now=$(date +%s)
age=$((now - ${ctx_timestamp:-0}))
signal_key="${task_type}:${THRESHOLD}"
last_signal=""
if [ -f "$SIGNAL_FILE" ]; then
  last_signal=$(cat "$SIGNAL_FILE" 2>/dev/null || echo "")
fi

if [ "$age" -le 60 ] && [ "$ctx_int" -ge "$THRESHOLD" ] && [ "$last_signal" != "$signal_key" ]; then
  echo "[Context Budget] ${ctx_int}% context used meets ${task_type} threshold ${THRESHOLD}%" >&2
  echo "[Context Budget] Switch to ecomode, compact, or narrow the remaining task before continuing." >&2
  echo "$signal_key" > "$SIGNAL_FILE"
  echo "$input"
  HOOK_END=$(date +%s%N 2>/dev/null || echo 0)
  if [ "$HOOK_START" != "0" ] && [ "$HOOK_END" != "0" ]; then
    HOOK_MS=$(( (HOOK_END - HOOK_START) / 1000000 ))
    echo "[Hook Perf] $(basename "$0"): ${HOOK_MS}ms" >> "/tmp/.codex-hook-perf-${PPID}.log"
  fi
  exit 2
fi

# Emit advisory at milestones (every 25 tool calls)
if [ "$tool_count" -gt 0 ] && [ $((tool_count % 25)) -eq 0 ]; then
  echo "[Context Budget] Task: ${task_type} | Threshold: ${THRESHOLD}% | Tools used: ${tool_count}" >&2
  if [ "$tool_count" -ge 75 ]; then
    echo "[Context Budget] ⚠ High tool usage — consider /compact or ecomode" >&2
  fi
fi

# R010 compliance heartbeat (every 50 tool calls)
if [ "$tool_count" -gt 0 ] && [ $((tool_count % 50)) -eq 0 ]; then
  echo "[Compliance] R007: Agent ID required | R008: Tool ID required | R010: Delegate writes" >&2
  VIOLATION_FILE="/tmp/.codex-r010-violations-${PPID}"
  if [ -f "$VIOLATION_FILE" ]; then
    v_count=$(wc -l < "$VIOLATION_FILE" | tr -d ' ')
    if [ "$v_count" -gt 0 ]; then
      echo "[Compliance] R010 violations this session: ${v_count}" >&2
    fi
  fi
fi

# Pass through
echo "$input"
HOOK_END=$(date +%s%N 2>/dev/null || echo 0)
if [ "$HOOK_START" != "0" ] && [ "$HOOK_END" != "0" ]; then
  HOOK_MS=$(( (HOOK_END - HOOK_START) / 1000000 ))
  echo "[Hook Perf] $(basename "$0"): ${HOOK_MS}ms" >> "/tmp/.codex-hook-perf-${PPID}.log"
fi
exit 0
