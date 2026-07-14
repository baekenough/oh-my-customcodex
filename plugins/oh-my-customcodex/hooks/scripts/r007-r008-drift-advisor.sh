#!/usr/bin/env bash
# r007-r008-drift-advisor.sh — UserPromptSubmit hook: proactive R007/R008 drift advisory.
#
# Inspects the last completed assistant turn in the session transcript before
# the next response. If the previous turn missed the R007 identity header or an
# R008 tool prefix, emit a stderr advisory. Advisory-only: never blocks.

set -euo pipefail

input=$(cat)

if [ "${OMCODEX_R007_ADVISOR:-}" = "off" ]; then
  echo "$input"
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "$input"
  exit 0
fi

session_id=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null)
transcript_path=$(echo "$input" | jq -r '.transcript_path // .transcriptPath // empty' 2>/dev/null)

if [ -z "$transcript_path" ] && [ -n "$session_id" ]; then
  transcript_base="${OMCODEX_TRANSCRIPT_BASE:-}"
  if [ -n "$transcript_base" ]; then
    transcript_path="${transcript_base}/${session_id}.jsonl"
  fi
fi

if [ -z "$transcript_path" ] || [ ! -f "$transcript_path" ]; then
  echo "$input"
  exit 0
fi

reverse_file() {
  tail -r "$1" 2>/dev/null || tac "$1" 2>/dev/null || cat "$1"
}

last_assistant=""
while IFS= read -r line; do
  role=$(echo "$line" | jq -r '.role // .message.role // empty' 2>/dev/null) || continue
  if [ "$role" = "assistant" ]; then
    last_assistant="$line"
    break
  fi
done < <(reverse_file "$transcript_path")

if [ -z "$last_assistant" ]; then
  echo "$input"
  exit 0
fi

content_type=$(echo "$last_assistant" | jq -r '(.content // .message.content // []) | type' 2>/dev/null) || content_type="array"
if [ "$content_type" = "string" ]; then
  content_raw=$(echo "$last_assistant" | jq -c '[{"type":"text","text":(.content // .message.content // "")}]' 2>/dev/null) || content_raw="[]"
else
  content_raw=$(echo "$last_assistant" | jq -c '.content // .message.content // []' 2>/dev/null) || content_raw="[]"
fi

r007_violations=0
r008_violations=0

first_text=$(echo "$content_raw" | jq -r '[.[] | select(.type == "text")][0].text // empty' 2>/dev/null) || first_text=""
if [ -n "$first_text" ]; then
  first_line=$(printf '%s' "$first_text" | head -1)
  if ! printf '%s' "$first_line" | grep -qE '(^┌─ Agent:|^\[.+\])'; then
    r007_violations=$((r007_violations + 1))
  fi
fi

content_length=$(echo "$content_raw" | jq 'length' 2>/dev/null) || content_length=0
i=0
while [ "$i" -lt "$content_length" ]; do
  block_type=$(echo "$content_raw" | jq -r ".[$i].type // empty" 2>/dev/null) || {
    i=$((i + 1))
    continue
  }

  if [ "$block_type" = "tool_use" ] || [ "$block_type" = "tool_call" ]; then
    has_prefix=false
    if [ "$i" -gt 0 ]; then
      prev_type=$(echo "$content_raw" | jq -r ".[$((i - 1))].type // empty" 2>/dev/null) || true
      if [ "$prev_type" = "text" ]; then
        prev_text=$(echo "$content_raw" | jq -r ".[$((i - 1))].text // empty" 2>/dev/null) || true
        if printf '%s' "$prev_text" | grep -qE '\[.+\]\[.+\] ?(→|->|—>) ?(Tool|Target):'; then
          has_prefix=true
        fi
      fi
    fi
    if [ "$has_prefix" = "false" ]; then
      r008_violations=$((r008_violations + 1))
    fi
  fi

  i=$((i + 1))
done

if [ "$r007_violations" -gt 0 ] || [ "$r008_violations" -gt 0 ]; then
  printf '[R007/R008 Advisory] Previous assistant turn missed identification (R007 header=%d, R008 prefix=%d). Start this response with the ┌─ Agent: block and prefix tool calls with [agent][model] → Tool:.\n' \
    "$r007_violations" "$r008_violations" >&2
fi

echo "$input"
exit 0
