#!/bin/bash
set -euo pipefail

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // .tool // ""')

if [[ ! "$tool_name" =~ ^mcp__playwright__ ]]; then
  exit 0
fi

raw_output=$(echo "$input" | jq -c '.tool_response // .tool_output.output // .tool_output // empty')

if [ -z "$raw_output" ] || [ "$raw_output" = "null" ]; then
  exit 0
fi

text_output=$(printf '%s' "$raw_output" | jq -r 'if type == "string" then . else tostring end')
min_chars=${PLAYWRIGHT_COMPRESS_MIN_CHARS:-3000}

if [ "${#text_output}" -lt "$min_chars" ]; then
  exit 0
fi

ref_matches=$(printf '%s\n' "$text_output" | grep -oE 'ref[=:]"?[^", ]+' || true)
refs=$(printf '%s\n' "$ref_matches" \
  | sed 's/^ref[=:]"*/ref=/' \
  | awk 'length($0) > 0 && !seen[$0]++' \
  | head -12 \
  | paste -sd ', ' -)

url_matches=$(printf '%s\n' "$text_output" | grep -oE 'https?://[^" )]+' || true)
urls=$(printf '%s\n' "$url_matches" \
  | awk 'length($0) > 0 && !seen[$0]++' \
  | head -6 \
  | paste -sd ', ' -)

important_matches=$(printf '%s\n' "$text_output" | grep -iE 'ref=|error|failed|warning|timeout|assert|url|title|text|name|role|selector' || true)
important_lines=$(printf '%s\n' "$important_matches" \
  | sed 's/^[[:space:]]*//; s/[[:space:]]\+/ /g' \
  | awk 'length($0) > 0 && !seen[$0]++' \
  | head -25)

if [ -z "$important_lines" ]; then
  important_lines=$(printf '%s\n' "$text_output" \
    | sed 's/^[[:space:]]*//; s/[[:space:]]\+/ /g' \
    | awk 'length($0) > 0 && !seen[$0]++' \
    | head -20)
fi

if [ -z "$important_lines" ]; then
  important_lines='(no high-signal lines detected; payload was compressed by fallback rules)'
fi

summary=$(
  {
    printf 'Playwright MCP output compressed.\n'
    printf 'Original size: %s chars.\n' "${#text_output}"
    if [ -n "$refs" ]; then
      printf 'Preserved refs: %s\n' "$refs"
    fi
    if [ -n "$urls" ]; then
      printf 'URLs: %s\n' "$urls"
    fi
    printf '\nHigh-signal lines:\n'
    printf '%s\n' "$important_lines"
  } | head -c "${PLAYWRIGHT_COMPRESS_MAX_CHARS:-2500}"
)

if [ -z "$summary" ]; then
  exit 0
fi

jq -n \
  --arg summary "$summary" \
  --arg note "Playwright MCP output compressed to preserve refs and reduce context cost." \
  '{
    additionalContext: $note,
    updatedMCPToolOutput: $summary
  }'
