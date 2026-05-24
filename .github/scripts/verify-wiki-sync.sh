#!/usr/bin/env bash
# verify-wiki-sync.sh — mirrors wiki-sync.yml missing-page checks and validates
# wiki/index.yaml counts. Navigation pages under wiki/ root are excluded from
# total_pages; indexed content pages live below wiki/*/.

set -euo pipefail

errors=0
missing=0

if [ ! -d "wiki" ]; then
  echo "::error::wiki/ directory not found. Run /omcustomcodex:wiki first."
  exit 1
fi

SKILLS_ROOT=".codex/skills"
if [ -d ".agents/skills" ]; then
  SKILLS_ROOT=".agents/skills"
fi

src_agents=0
for src in .codex/agents/*.md; do
  [ -e "$src" ] || continue
  src_agents=$((src_agents + 1))
  name=$(basename "$src" .md)
  wiki_page="wiki/agents/${name}.md"
  if [ ! -f "$wiki_page" ]; then
    echo "::error::Missing wiki page: $wiki_page (source: $src)"
    missing=$((missing + 1))
    errors=$((errors + 1))
  fi
done

src_skills=0
while IFS= read -r src; do
  src_skills=$((src_skills + 1))
  name=$(basename "$(dirname "$src")")
  wiki_page="wiki/skills/${name}.md"
  if [ ! -f "$wiki_page" ]; then
    echo "::error::Missing wiki page: $wiki_page (source: $src)"
    missing=$((missing + 1))
    errors=$((errors + 1))
  fi
done < <(find "$SKILLS_ROOT" -name "SKILL.md" -type f 2>/dev/null)

src_rules=0
for src in .codex/rules/*.md; do
  [ -e "$src" ] || continue
  src_rules=$((src_rules + 1))
  rule_id=$(grep -oE 'ID\*\*: R[0-9]+' "$src" 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)
  if [ -n "$rule_id" ]; then
    wiki_page="wiki/rules/r$(printf '%03d' "$((10#$rule_id))").md"
    if [ ! -f "$wiki_page" ]; then
      echo "::error::Missing wiki page: $wiki_page (source: $src)"
      missing=$((missing + 1))
      errors=$((errors + 1))
    fi
  fi
done

src_guides=0
while IFS= read -r src; do
  src_guides=$((src_guides + 1))
  name=$(basename "$src")
  wiki_page="wiki/guides/${name}.md"
  if [ ! -f "$wiki_page" ]; then
    echo "::error::Missing wiki page: $wiki_page (source: $src)"
    missing=$((missing + 1))
    errors=$((errors + 1))
  fi
done < <(find guides -mindepth 1 -maxdepth 1 -type d 2>/dev/null)

if [ ! -f "wiki/index.yaml" ]; then
  echo "::error::Missing wiki/index.yaml"
  errors=$((errors + 1))
fi

total_wiki=$(find wiki -name "*.md" ! -name "index.md" ! -name "log.md" 2>/dev/null | wc -l | tr -d ' ')
echo "Source entities: agents=$src_agents skills=$src_skills rules=$src_rules guides=$src_guides"
echo "Wiki pages (all .md): $total_wiki  |  Missing: $missing"

if [ "$errors" -gt 0 ]; then
  echo ""
  echo "Fix: run /omcustomcodex:wiki to regenerate wiki pages."
  exit 1
fi

echo "Wiki missing-page check passed"

echo ""
echo "=== Wiki Index Count Consistency ==="

index_yaml="wiki/index.yaml"
index_total=$( { grep -E '^  total_pages:' "$index_yaml" || true; } | sed 's/.*total_pages: *//' | tr -d ' ')
index_skills=$( { awk '/^  counts:/,/^[a-z]/' "$index_yaml" || true; } | { grep -E '^ +skills:' || true; } | sed 's/.*skills: *//' | tr -d ' ')
index_agents=$( { awk '/^  counts:/,/^[a-z]/' "$index_yaml" || true; } | { grep -E '^ +agents:' || true; } | sed 's/.*agents: *//' | tr -d ' ')
index_rules=$( { awk '/^  counts:/,/^[a-z]/' "$index_yaml" || true; } | { grep -E '^ +rules:' || true; } | sed 's/.*rules: *//' | tr -d ' ')
index_guides=$( { awk '/^  counts:/,/^[a-z]/' "$index_yaml" || true; } | { grep -E '^ +guides:' || true; } | sed 's/.*guides: *//' | tr -d ' ')

# total_pages counts indexed content pages only. Navigation/landing pages at
# wiki/ root are intentionally excluded.
actual_total=$(find wiki -mindepth 2 -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')
actual_skills=$(find wiki/skills -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')
actual_agents=$(find wiki/agents -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')
actual_rules=$(find wiki/rules -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')
actual_guides=$(find wiki/guides -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')

count_errors=0

if [ -n "$index_total" ] && [ "$index_total" != "$actual_total" ]; then
  echo "::error::wiki/index.yaml total_pages drift:"
  echo "  index.yaml: $index_total"
  echo "  actual:     $actual_total"
  count_errors=$((count_errors + 1))
else
  echo "[OK] total_pages: $actual_total"
fi

check_count() {
  local name="$1" index_value="$2" actual_value="$3"
  if [ -n "$index_value" ] && [ "$index_value" != "$actual_value" ]; then
    echo "::error::wiki/index.yaml counts.$name drift:"
    echo "  index.yaml: $index_value"
    echo "  actual:     $actual_value"
    count_errors=$((count_errors + 1))
  elif [ -n "$index_value" ]; then
    echo "[OK] counts.$name: $actual_value"
  else
    echo "[SKIP] counts.$name: key not present in index.yaml"
  fi
}

check_count "skills" "$index_skills" "$actual_skills"
check_count "agents" "$index_agents" "$actual_agents"
check_count "rules" "$index_rules" "$actual_rules"
check_count "guides" "$index_guides" "$actual_guides"

if [ "$count_errors" -gt 0 ]; then
  echo ""
  echo "Fix: run /omcustomcodex:wiki to regenerate wiki/index.yaml."
  exit 1
fi
