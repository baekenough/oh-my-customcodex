#!/usr/bin/env bash
# skill-count-reminder.sh — Advisory reminder when skills are created/modified
# Triggered by PostToolUse on Write/Edit targeting .codex/skills/*/SKILL.md
# R021: Advisory-only, never blocks (always exit 0)

set -euo pipefail

# Read tool input from stdin
INPUT=$(cat)

# Extract the file path from the tool input
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""' 2>/dev/null)

# Only trigger for .codex/skills/ paths with SKILL.md
if [[ "$FILE_PATH" == *".codex/skills/"*"SKILL.md"* ]]; then
    SKILL_NAME=$(echo "$FILE_PATH" | sed 's|.*\.codex/skills/||' | sed 's|/SKILL.md||')
    ACTUAL_COUNT=$(find .codex/skills -name 'SKILL.md' 2>/dev/null | wc -l | tr -d ' ')

    cat >&2 << EOF
─── [Skill Sync Reminder] New/modified skill: ${SKILL_NAME} ───
Current skill count: ${ACTUAL_COUNT}

Update these 6 locations before committing:
  1. AGENTS.md           → 스킬 (${ACTUAL_COUNT} 디렉토리)
  2. README.md line ~16  → ${ACTUAL_COUNT} skills
  3. README.md line ~135 → ### Skills (${ACTUAL_COUNT})
  4. README.md line ~275 → # ${ACTUAL_COUNT} skill modules
  5. templates/AGENTS.md → 스킬 (${ACTUAL_COUNT} 디렉토리)
  6. templates/.codex/skills/${SKILL_NAME}/SKILL.md → copy file
───────────────────────────────────────────────────────
EOF
fi

exit 0
