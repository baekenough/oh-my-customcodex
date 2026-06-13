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

echo "Wiki index count check passed"

# ── Content-Drift Check (Phase B — BLOCKING on genuine drift) ────────────────
# #1494 Phase A → #1513 Phase B: detect SOURCE body changes that leave a wiki page
# stale even when no page is added/removed and counts are unchanged. Compares current
# source hashes against the wiki/.source-hashes.json manifest (recorded at last sync).
#
# Phase B (R021 hard-block promotion): GENUINE content drift
# (STALE wiki page / NEW source not in manifest / ORPHAN deleted source) now FAILS
# the build (exit 1). INFRASTRUCTURE-MISSING cases (helper not found, manifest absent,
# jq unavailable, corrupt manifest, hash-generation failure, helper-source failure)
# remain advisory ::warning:: + non-failing — those mean the check is UNAVAILABLE
# (graceful degradation), not that drift was found. Only real drift blocks.
echo ""
echo "=== Wiki Content-Drift Check (Phase B — blocking) ==="

MANIFEST="wiki/.source-hashes.json"
HELPER_LIB=""
for cand in \
  "$(dirname "$0")/lib/source-hash.sh" \
  ".github/scripts/lib/source-hash.sh"; do
  if [ -f "$cand" ]; then HELPER_LIB="$cand"; break; fi
done

# DRIFT_MARKER: a sentinel file the guarded subshell touches ONLY when GENUINE
# content drift is found. The subshell swallows non-zero status (set -e inside the
# helper must not abort the parent), so we cannot exit 1 from within it directly.
# After the subshell, if the marker exists, the parent fails the build (Phase B).
# Infra-missing branches never touch the marker → they stay advisory (graceful skip).
DRIFT_MARKER="$(mktemp 2>/dev/null || echo "/tmp/wiki-drift-marker.$$")"
rm -f "$DRIFT_MARKER" 2>/dev/null || true

# Run the drift detection in a guarded subshell so set -e inside the helper can't
# abort the parent script. Genuine drift is signalled out via $DRIFT_MARKER, not
# via the subshell's exit status (which is deliberately swallowed below).
{
  if [ -z "$HELPER_LIB" ]; then
    echo "::warning::source-hash helper not found — content-drift check skipped (infra unavailable, graceful skip)"
  elif [ ! -f "$MANIFEST" ]; then
    echo "::warning::$MANIFEST absent — content-drift check skipped (infra unavailable, graceful skip). Run '/omcustomcodex:wiki' to seed the manifest."
  elif ! command -v jq >/dev/null 2>&1; then
    echo "::warning::jq not available — content-drift check skipped (infra unavailable, graceful skip)"
  elif ! jq empty "$MANIFEST" 2>/dev/null; then
    # Malformed/corrupt manifest: ONE advisory, skip the drift comparison.
    # Without this guard a corrupt manifest degrades to many false "NEW source" warnings.
    # This is an infra/environment issue (manifest unreadable), NOT genuine drift → advisory.
    echo "::warning::$MANIFEST unreadable (malformed JSON) — content-drift check skipped (infra unavailable, graceful skip). Run '/omcustomcodex:wiki' to re-seed the manifest."
  else
    # Source the shared helper so producer/checker hashing stays in parity.
    # shellcheck source=/dev/null
    if ! . "$HELPER_LIB" 2>/dev/null; then
      echo "::warning::failed to source $HELPER_LIB — content-drift check skipped (infra unavailable, graceful skip)"
    else
      # Generate a fresh manifest to a temp file, then diff against the committed one.
      CUR_MANIFEST="$(mktemp 2>/dev/null || echo "/tmp/wiki-cur-hashes.$$.json")"
      if generate_manifest "$CUR_MANIFEST" 2>/dev/null && [ -s "$CUR_MANIFEST" ]; then
        DRIFT=0

        while IFS= read -r line; do
          [ -n "$line" ] || continue
          src="${line%%$'\t'*}"
          cur_hash="${line#*$'\t'}"
          old_hash="$(jq -r --arg k "$src" '.[$k] // empty' "$MANIFEST" 2>/dev/null || true)"
          if [ -z "$old_hash" ]; then
            echo "::warning::content-drift: NEW source not in manifest: $src — remedy: /omcustomcodex:wiki ingest $src"
            DRIFT=$((DRIFT + 1))
          elif [ "$old_hash" != "$cur_hash" ]; then
            echo "::warning::content-drift: STALE wiki page for changed source: $src — remedy: /omcustomcodex:wiki ingest $src"
            DRIFT=$((DRIFT + 1))
          fi
        done < <(jq -r 'to_entries[] | "\(.key)\t\(.value)"' "$CUR_MANIFEST" 2>/dev/null || true)

        while IFS= read -r src; do
          [ -n "$src" ] || continue
          cur_val="$(jq -r --arg k "$src" '.[$k] // empty' "$CUR_MANIFEST" 2>/dev/null || true)"
          if [ -z "$cur_val" ]; then
            echo "::warning::content-drift: ORPHAN in manifest (source deleted?): $src — remedy: run '/omcustomcodex:wiki' to refresh the manifest"
            DRIFT=$((DRIFT + 1))
          fi
        done < <(jq -r 'keys[]' "$MANIFEST" 2>/dev/null || true)

        if [ "$DRIFT" -eq 0 ]; then
          echo "[OK] no content drift detected (all source hashes match manifest)"
        else
          # GENUINE drift: signal the parent to fail the build (Phase B blocking).
          echo "::error::$DRIFT content-drift item(s) detected — wiki out of sync. Remedy: /omcustomcodex:wiki ingest <path> (Phase B blocking)"
          : > "$DRIFT_MARKER" 2>/dev/null || true
        fi
      else
        echo "::warning::failed to generate current source hashes — content-drift check skipped (infra unavailable, graceful skip)"
      fi
      rm -f "$CUR_MANIFEST" 2>/dev/null || true
    fi
  fi
} || echo "::warning::content-drift check encountered an error — skipped (infra error, graceful skip, non-blocking)"

# Phase B: fail the build ONLY on genuine content drift (marker present).
# Infra-missing / graceful-skip branches never create the marker, so the check
# remains advisory when it is merely unavailable (R021 hard-block promotion scoped
# to real drift only).
if [ -f "$DRIFT_MARKER" ]; then
  rm -f "$DRIFT_MARKER" 2>/dev/null || true
  echo ""
  echo "Fix: run '/omcustomcodex:wiki ingest <path>' to re-sync stale wiki pages, then re-run."
  exit 1
fi
rm -f "$DRIFT_MARKER" 2>/dev/null || true
