#!/bin/bash
# cost-cap-advisor.sh — Advisory hook for session cost monitoring
# Trigger: PostToolUse (Agent/Task)
# Purpose: Warn when session cost approaches configurable cap
# Protocol: stdin JSON -> stdout pass-through; exit 2 only for continueOnBlock wrap-up signals

input=$(cat)

# Cost bridge file written by statusline.sh
COST_FILE="/tmp/.codex-cost-${PPID}"
ADVISORY_FILE="/tmp/.codex-cost-advisory-${PPID}"

# Configurable cap (default $5.00, override via CLAUDE_COST_CAP env var)
COST_CAP="${CLAUDE_COST_CAP:-5.00}"

# Check if cost data is available
if [ ! -f "$COST_FILE" ]; then
  echo "$input"
  exit 0
fi

# TSV: cost_usd, ctx_pct, timestamp, rl_5h_pct, rl_7d_pct, rl_5h_resets, rl_7d_resets
IFS=$'\t' read -r cost_usd ctx_pct timestamp _rl_5h _rl_7d _rl_5h_resets _rl_7d_resets < "$COST_FILE" 2>/dev/null || {
  echo "$input"
  exit 0
}

# Validate cost_usd is a number
if ! printf '%f' "$cost_usd" >/dev/null 2>&1; then
  echo "$input"
  exit 0
fi
if ! printf '%f' "$COST_CAP" >/dev/null 2>&1; then
  echo "$input"
  exit 0
fi

# Calculate percentage of cap used
cost_pct=$(awk -v cost="$cost_usd" -v cap="$COST_CAP" 'BEGIN { if (cap <= 0) print 0; else printf "%d", (cost * 100 / cap) }' 2>/dev/null || echo "0")

# Staleness check — skip if data is older than 60 seconds
now=$(date +%s)
age=$((now - ${timestamp:-0}))
if [ "$age" -gt 60 ]; then
  echo "$input"
  exit 0
fi

# Read last advisory level to avoid repeating the same warning
last_level=""
if [ -f "$ADVISORY_FILE" ]; then
  last_level=$(cat "$ADVISORY_FILE" 2>/dev/null || echo "")
fi

# Determine advisory level and emit warning (only once per level)
if [ "$cost_pct" -ge 100 ] && [ "$last_level" != "100" ]; then
  echo "[Cost Cap] Session cost \$${cost_usd} has reached cap \$${COST_CAP} (${cost_pct}%)" >&2
  echo "[Cost Cap] Consider wrapping up or increasing CLAUDE_COST_CAP" >&2
  echo "100" > "$ADVISORY_FILE"
  echo "$input"
  exit 2
elif [ "$cost_pct" -ge 90 ] && [ "$last_level" != "90" ] && [ "$last_level" != "100" ]; then
  echo "[Cost Cap] Session cost \$${cost_usd} at 90% of cap \$${COST_CAP}" >&2
  echo "[Cost Cap] Ecomode recommended — consider /compact" >&2
  echo "90" > "$ADVISORY_FILE"
elif [ "$cost_pct" -ge 75 ] && [ "$last_level" != "75" ] && [ "$last_level" != "90" ] && [ "$last_level" != "100" ]; then
  echo "[Cost Cap] Session cost \$${cost_usd} at 75% of cap \$${COST_CAP}" >&2
  echo "75" > "$ADVISORY_FILE"
elif [ "$cost_pct" -ge 50 ] && [ -z "$last_level" ]; then
  echo "[Cost Cap] Session cost \$${cost_usd} at 50% of cap \$${COST_CAP}" >&2
  echo "50" > "$ADVISORY_FILE"
fi

# Pass through — advisory only
echo "$input"
exit 0
