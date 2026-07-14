#!/usr/bin/env bash
# session-reflection.sh — Stop/SubagentStop advisory reflection capture
#
# Records lightweight session-end evidence from Claude/Codex hook input. The
# hook never blocks shutdown; it writes a markdown reflection when transcript,
# background task, or session cron evidence is available.

set +e

input="$(cat)"
project_root="${OMCUSTOMCODEX_PROJECT_ROOT:-${OMCODEX_PROJECT_ROOT:-$PWD}}"

pass_through() {
  printf '%s' "$input"
  exit 0
}

case "${OMCUSTOMCODEX_SESSION_REFLECTION:-${OMCODEX_SESSION_REFLECTION:-${OMCUSTOM_SESSION_REFLECTION:-on}}}" in
  off|false|0|no)
    pass_through
    ;;
esac

json_get() {
  local expr="$1"
  local fallback_key="$2"

  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r "$expr" 2>/dev/null
    return
  fi

  # Minimal fallback for flat string fields when jq is unavailable.
  printf '%s' "$input" | sed -nE "s/.*\"${fallback_key}\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\\1/p" | head -n 1
}

session_id="$(json_get '.session_id // .sessionId // empty' 'session_id')"
transcript_path="$(json_get '.transcript_path // .conversation_transcript_path // .transcript.path // .transcript.file_path // empty' 'transcript_path')"

if command -v jq >/dev/null 2>&1; then
  background_task_count="$(printf '%s' "$input" | jq -r '[.background_tasks[]?] | length' 2>/dev/null)"
  session_cron_count="$(printf '%s' "$input" | jq -r '[.session_crons[]?] | length' 2>/dev/null)"
  background_task_lines="$(printf '%s' "$input" | jq -r '.background_tasks[]? | "- " + ((.id // .task_id // "task") | tostring) + " [" + ((.status // .state // "unknown") | tostring) + "] " + ((.command // .description // .prompt // "") | tostring)' 2>/dev/null)"
  session_cron_lines="$(printf '%s' "$input" | jq -r '.session_crons[]? | "- " + ((.id // .name // "cron") | tostring) + " [" + ((.status // .state // "unknown") | tostring) + "] " + ((.command // .description // .schedule // "") | tostring)' 2>/dev/null)"
else
  background_task_count=0
  session_cron_count=0
  background_task_lines=""
  session_cron_lines=""
fi

if ! [[ "$background_task_count" =~ ^[0-9]+$ ]]; then
  background_task_count=0
fi
if ! [[ "$session_cron_count" =~ ^[0-9]+$ ]]; then
  session_cron_count=0
fi

if [[ -z "$transcript_path" && -n "$session_id" ]]; then
  transcript_base="${OMCUSTOMCODEX_TRANSCRIPT_BASE:-${OMCODEX_TRANSCRIPT_BASE:-${OMCUSTOM_TRANSCRIPT_BASE:-${HOME}/.codex/projects}}}"
  if [[ -d "$transcript_base" ]]; then
    transcript_path="$(find "$transcript_base" -type f -name "*${session_id}*.jsonl" -print -quit 2>/dev/null)"
  fi
fi

if [[ -z "$transcript_path" && "$background_task_count" -eq 0 && "$session_cron_count" -eq 0 ]]; then
  pass_through
fi

out_dir="${project_root}/.codex/outputs/reflections"
mkdir -p "$out_dir" 2>/dev/null || pass_through
out_file="${out_dir}/$(date -u +%Y-%m-%d).md"

tool_uses=0
assistant_turns=0
handoff_prompts=0
if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
  tool_uses="$(grep -c '"tool_use"' "$transcript_path" 2>/dev/null || echo 0)"
  assistant_turns="$(grep -c '"role"[[:space:]]*:[[:space:]]*"assistant"' "$transcript_path" 2>/dev/null || echo 0)"
  handoff_prompts="$(grep -Eci 'should I proceed|shall I proceed|계속할까요|진행할까요' "$transcript_path" 2>/dev/null || echo 0)"
fi

{
  printf '\n## %s Session Reflection\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf -- '- Session: `%s`\n' "${session_id:-unknown}"
  printf -- '- Transcript: `%s`\n' "${transcript_path:-unavailable}"
  printf -- '- Tool uses observed: %s\n' "$tool_uses"
  printf -- '- Assistant turns observed: %s\n' "$assistant_turns"
  printf -- '- Permission-handoff prompts observed: %s\n' "$handoff_prompts"
  printf -- '- Background tasks in hook input: %s\n' "$background_task_count"
  printf -- '- Session crons in hook input: %s\n' "$session_cron_count"
  if [[ -n "$background_task_lines" ]]; then
    printf '\n### Background Tasks\n%s\n' "$background_task_lines"
  fi
  if [[ -n "$session_cron_lines" ]]; then
    printf '\n### Session Crons\n%s\n' "$session_cron_lines"
  fi
  if [[ "$handoff_prompts" =~ ^[0-9]+$ && "$handoff_prompts" -gt 0 ]]; then
    printf -- '\n### Follow-up\n- Review permission-handoff prompts against the autonomous execution directive.\n'
  fi
} >> "$out_file" 2>/dev/null

echo "[SessionReflection] Recorded reflection: ${out_file}" >&2
echo "[SessionReflection] background_tasks=${background_task_count} session_crons=${session_cron_count}" >&2

pass_through
