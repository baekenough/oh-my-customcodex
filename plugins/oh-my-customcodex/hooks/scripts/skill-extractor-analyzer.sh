#!/bin/bash
# skill-extractor-analyzer.sh — Stop hook for skill candidate detection
# Advisory-only: exit 0 always. Emits stderr message if candidates found.

set -euo pipefail

# Pass through stdin (Stop hook protocol)
input=$(cat)

OUTCOMES_FILE="${CODEX_TASK_OUTCOMES_FILE:-/tmp/.codex-task-outcomes-${PPID}}"
PROPOSALS_FILE="${CODEX_SKILL_PROPOSALS_FILE:-/tmp/.codex-skill-proposals-${PPID}}"

# Early exit if no outcomes
if [ ! -f "$OUTCOMES_FILE" ] || [ ! -s "$OUTCOMES_FILE" ]; then
  echo "$input"
  exit 0
fi

# Count qualifying patterns (3+ successes with 80%+ rate).
# Parse the JSONL conservatively with awk to avoid external jq dependency
# and reduce batch-test flakiness around optional PATH/tool availability.
CANDIDATES=$(
  awk '
    {
      agent = ""
      skill = "none"
      outcome = ""

      if (match($0, /"agent_type"[[:space:]]*:[[:space:]]*"[^"]+"/)) {
        agent = substr($0, RSTART, RLENGTH)
        sub(/^.*"agent_type"[[:space:]]*:[[:space:]]*"/, "", agent)
        sub(/"$/, "", agent)
      }

      if (match($0, /"skill"[[:space:]]*:[[:space:]]*"[^"]+"/)) {
        skill = substr($0, RSTART, RLENGTH)
        sub(/^.*"skill"[[:space:]]*:[[:space:]]*"/, "", skill)
        sub(/"$/, "", skill)
      }

      if (match($0, /"outcome"[[:space:]]*:[[:space:]]*"[^"]+"/)) {
        outcome = substr($0, RSTART, RLENGTH)
        sub(/^.*"outcome"[[:space:]]*:[[:space:]]*"/, "", outcome)
        sub(/"$/, "", outcome)
      }

      if (agent != "" && outcome != "") {
        key = agent "|" skill
        total[key]++
        if (outcome == "success") {
          successes[key]++
        }
      }
    }

    END {
      candidates = 0
      for (key in total) {
        success_count = successes[key] + 0
        if (success_count >= 3 && (success_count / total[key]) >= 0.8) {
          candidates++
        }
      }
      print candidates + 0
    }
  ' "$OUTCOMES_FILE" 2>/dev/null || echo "0"
)

if [ "$CANDIDATES" -gt 0 ] 2>/dev/null; then
  echo "[skill-extractor] ${CANDIDATES} skill candidate(s) detected from session outcomes" >&2
  echo "[skill-extractor] Run /skill-extractor to review and create" >&2

  # Save proposal count for Stop prompt hook to pick up
  echo "{\"candidates\": $CANDIDATES, \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$PROPOSALS_FILE" || true
fi

# CRITICAL: Always pass through input and exit 0
# This hook MUST NEVER block session termination
echo "$input"
exit 0
