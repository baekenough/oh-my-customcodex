#!/usr/bin/env bash
# verify-template-sync.sh — read-only parity guard for .codex/ source files
# and templates/.claude/ packaged files.
#
# Count parity catches missing files. Content drift checks catch stale template
# copies while allowing the explicit Claude-source to Codex-native agent metadata
# conversion performed by the agent compiler.

set -euo pipefail

errors=0

SRC_SKILLS_DIR=".codex/skills"
if [ -d ".agents/skills" ]; then
  SRC_SKILLS_DIR=".agents/skills"
fi

count_files() {
  local pattern="$1"
  find $pattern 2>/dev/null | wc -l | tr -d ' '
}

skill_name_list() {
  local root="$1"
  find "$root" -name "SKILL.md" -type f 2>/dev/null | while IFS= read -r f; do
    basename "$(dirname "$f")"
  done | sort
}

report_count_mismatch() {
  local label="$1" src="$2" tpl="$3"
  echo "::error::$label count mismatch: source=$src template=$tpl"
  errors=$((errors + 1))
}

echo "=== Template Sync: Counts ==="

src_skills=$(find "$SRC_SKILLS_DIR" -name "SKILL.md" -type f 2>/dev/null | wc -l | tr -d ' ')
tpl_skills=$(find templates/.claude/skills -name "SKILL.md" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$src_skills" != "$tpl_skills" ]; then
  echo "::error::Skill count mismatch: $SRC_SKILLS_DIR=$src_skills templates/.claude/skills=$tpl_skills"
  src_names=$(mktemp)
  tpl_names=$(mktemp)
  skill_name_list "$SRC_SKILLS_DIR" > "$src_names"
  skill_name_list "templates/.claude/skills" > "$tpl_names"
  comm -3 "$src_names" "$tpl_names" | sed 's/^/  /'
  rm -f "$src_names" "$tpl_names"
  errors=$((errors + 1))
fi

stray_skill_files=0
while IFS= read -r stray; do
  echo "::error::Stray skill root markdown file: $stray (skills must use {name}/SKILL.md)"
  stray_skill_files=$((stray_skill_files + 1))
done < <(find "$SRC_SKILLS_DIR" -maxdepth 1 -type f -name "*.md" 2>/dev/null)
while IFS= read -r stray; do
  echo "::error::Stray template skill root markdown file: $stray (skills must use {name}/SKILL.md)"
  stray_skill_files=$((stray_skill_files + 1))
done < <(find templates/.claude/skills -maxdepth 1 -type f -name "*.md" 2>/dev/null)
errors=$((errors + stray_skill_files))

src_hooks=$(find .codex/hooks/scripts -maxdepth 1 -type f -name "*.sh" 2>/dev/null | wc -l | tr -d ' ')
tpl_hooks=$(find templates/.claude/hooks/scripts -maxdepth 1 -type f -name "*.sh" 2>/dev/null | wc -l | tr -d ' ')
if [ "$src_hooks" != "$tpl_hooks" ]; then
  report_count_mismatch "Hook script" "$src_hooks" "$tpl_hooks"
fi

src_hook_entries=$(grep -c '"matcher"' .codex/hooks/hooks.json 2>/dev/null || echo 0)
tpl_hook_entries=$(grep -c '"matcher"' templates/.claude/hooks/hooks.json 2>/dev/null || echo 0)
if [ "$src_hook_entries" != "$tpl_hook_entries" ]; then
  report_count_mismatch "hooks.json matcher" "$src_hook_entries" "$tpl_hook_entries"
fi

if [ -d ".codex/schemas" ]; then
  src_schemas=$(find .codex/schemas -maxdepth 1 -type f -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
  tpl_schemas=$(find templates/.claude/schemas -maxdepth 1 -type f -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$src_schemas" != "$tpl_schemas" ]; then
    report_count_mismatch "Schema" "$src_schemas" "$tpl_schemas"
  fi
fi

skill_script_errors=0
for script_dir in "$SRC_SKILLS_DIR"/*/scripts; do
  [ -d "$script_dir" ] || continue
  skill_name=$(basename "$(dirname "$script_dir")")
  template_dir="templates/.claude/skills/$skill_name/scripts"
  if [ ! -d "$template_dir" ]; then
    echo "::error::Missing template scripts dir: $template_dir"
    skill_script_errors=$((skill_script_errors + 1))
    continue
  fi
  for script in "$script_dir"/*; do
    [ -e "$script" ] || continue
    script_name=$(basename "$script")
    if [ ! -f "$template_dir/$script_name" ]; then
      echo "::error::Missing template script: $template_dir/$script_name"
      skill_script_errors=$((skill_script_errors + 1))
    fi
  done
done
errors=$((errors + skill_script_errors))

src_agents=$(find .codex/agents -maxdepth 1 -type f -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
tpl_agents=$(find templates/.claude/agents -maxdepth 1 -type f -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
if [ "$src_agents" != "$tpl_agents" ]; then
  report_count_mismatch "Agent" "$src_agents" "$tpl_agents"
fi

src_rules=$(find .codex/rules -maxdepth 1 -type f -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
tpl_rules=$(find templates/.claude/rules -maxdepth 1 -type f -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
if [ "$src_rules" != "$tpl_rules" ]; then
  report_count_mismatch "Rule" "$src_rules" "$tpl_rules"
fi

src_guides=$(find guides -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
tpl_guides=$(find templates/guides -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
if [ "$src_guides" != "$tpl_guides" ]; then
  report_count_mismatch "Guide" "$src_guides" "$tpl_guides"
fi

echo ""
echo "=== Manifest Guides Count Consistency ==="
if command -v jq >/dev/null 2>&1; then
  manifest_guides=$(jq '.components[] | select(.name == "guides") | .files' templates/manifest.json 2>/dev/null)
  if [ -n "$manifest_guides" ] && [ "$manifest_guides" != "null" ] && [ "$manifest_guides" != "$src_guides" ]; then
    echo "::error::templates/manifest.json guides count drift:"
    echo "  manifest.json: $manifest_guides"
    echo "  actual guides/*/: $src_guides"
    errors=$((errors + 1))
  else
    echo "[OK] manifest.json guides count: $src_guides"
  fi
else
  echo "::warning::jq not installed — manifest count verification skipped"
fi

echo ""
echo "=== Entry Doc Count Consistency ==="
entry_doc="AGENTS.md"
if [ ! -f "$entry_doc" ]; then
  entry_doc="CLAUDE.md"
fi

doc_agents=$(grep -Eo '에이전트 정의 \([0-9]+|agents[^0-9]*\([0-9]+' "$entry_doc" 2>/dev/null | grep -Eo '[0-9]+' | head -1 || true)
doc_skills=$(grep -Eo '스킬 \([0-9]+|skills[^0-9]*\([0-9]+' "$entry_doc" 2>/dev/null | grep -Eo '[0-9]+' | head -1 || true)

echo "Actual: agents=$src_agents skills=$src_skills rules=$src_rules guides=$src_guides"
echo "$entry_doc documented: agents=${doc_agents:-0} skills=${doc_skills:-0}"

if [ -n "$doc_agents" ] && [ "$doc_agents" != "$src_agents" ]; then
  echo "::error::$entry_doc agent count ($doc_agents) != actual ($src_agents)"
  errors=$((errors + 1))
fi
if [ -n "$doc_skills" ] && [ "$doc_skills" != "$src_skills" ]; then
  echo "::error::$entry_doc skill count ($doc_skills) != actual ($src_skills)"
  errors=$((errors + 1))
fi

echo ""
echo "=== Content Drift Check ==="
content_drift=0

check_content_dir() {
  local src_dir="$1" tpl_dir="$2" glob="$3" label="$4"
  [ -d "$src_dir" ] || return 0
  while IFS= read -r f; do
    local base="${f#"$src_dir"/}"
    local tpl="$tpl_dir/$base"
    if [ ! -f "$tpl" ]; then
      echo "::error::Template missing for $label: $base"
      content_drift=$((content_drift + 1))
    elif ! diff -q "$f" "$tpl" >/dev/null 2>&1; then
      echo "::error::Content drift in $label: $base (source != template)"
      content_drift=$((content_drift + 1))
    fi
  done < <(find "$src_dir" -maxdepth 1 -type f -name "$glob")
}

check_content_file() {
  local src="$1" tpl="$2" label="$3"
  if [ ! -f "$tpl" ]; then
    echo "::error::Template missing for $label"
    content_drift=$((content_drift + 1))
  elif ! diff -q "$src" "$tpl" >/dev/null 2>&1; then
    echo "::error::Content drift in $label (source != template)"
    content_drift=$((content_drift + 1))
  fi
}

normalize_compat_agent() {
  sed \
    -e 's/^model: inherit$/model_lane: inherit/' \
    -e 's/^model: haiku$/model_lane: spark/' \
    -e 's/^model: sonnet$/model_lane: frontier/' \
    -e 's/^model: opus$/model_lane: frontier/' \
    -e 's/^effort:/model_reasoning_effort:/' \
    -e 's/^  path: sonnet → opus$/  model_reasoning_effort_path: medium → high → xhigh/' \
    "$1"
}

check_agent_content_dir() {
  local src_dir="$1" tpl_dir="$2"
  while IFS= read -r f; do
    local base="${f#"$src_dir"/}"
    local tpl="$tpl_dir/$base"
    if [ ! -f "$tpl" ]; then
      echo "::error::Template missing for agents: $base"
      content_drift=$((content_drift + 1))
      continue
    fi

    local normalized
    normalized=$(mktemp)
    normalize_compat_agent "$tpl" > "$normalized"
    if ! diff -q "$f" "$normalized" >/dev/null 2>&1; then
      echo "::error::Content drift in agents: $base (source != template after provider normalization)"
      content_drift=$((content_drift + 1))
    fi
    rm -f "$normalized"
  done < <(find "$src_dir" -maxdepth 1 -type f -name "*.md")
}

check_content_dir ".codex/rules" "templates/.claude/rules" "*.md" "rules"
check_agent_content_dir ".codex/agents" "templates/.claude/agents"
check_content_dir ".codex/hooks/scripts" "templates/.claude/hooks/scripts" "*.sh" "hooks/scripts"
check_content_file ".codex/hooks/hooks.json" "templates/.claude/hooks/hooks.json" "hooks/hooks.json"
check_content_file ".codex/statusline.sh" "templates/.claude/statusline.sh" "statusline.sh"
check_content_dir "workflows" "templates/workflows" "*.yaml" "workflow yaml"

while IFS= read -r src_skill; do
  skill_name=$(basename "$(dirname "$src_skill")")
  tpl_skill="templates/.claude/skills/$skill_name/SKILL.md"
  if [ ! -f "$tpl_skill" ]; then
    echo "::error::Template missing for skill: $skill_name/SKILL.md"
    content_drift=$((content_drift + 1))
  elif ! diff -q "$src_skill" "$tpl_skill" >/dev/null 2>&1; then
    echo "::error::Content drift in skill: $skill_name/SKILL.md (source != template)"
    content_drift=$((content_drift + 1))
  fi
done < <(find "$SRC_SKILLS_DIR" -name "SKILL.md" -type f)

if [ "$content_drift" -gt 0 ]; then
  echo "::error::$content_drift content drift(s) detected between .codex/ and templates/.claude/"
  errors=$((errors + content_drift))
else
  echo "[OK] Content drift check: rules, agents, hooks, statusline, workflow yaml, and skills are in sync"
fi

if [ "$errors" -gt 0 ]; then
  echo ""
  echo "Fix: sync source files from .codex/ to templates/.claude/ according to the port mapping."
  exit 1
fi

echo "Template sync verified: $src_skills skills, $src_hooks hook scripts, $src_hook_entries hook matchers"
echo "Agents: $src_agents  Rules: $src_rules  Guides: $src_guides"
