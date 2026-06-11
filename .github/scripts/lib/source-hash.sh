#!/usr/bin/env bash
# source-hash.sh — shared SHA-256 hashing helper for wiki content-drift detection (#1494 Phase A).
#
# Purpose: a SINGLE source of hashing truth shared by the PRODUCER (future wiki sync)
# and the CHECKER (.github/scripts/verify-wiki-sync.sh). Both must compute hashes
# identically so unchanged source never produces false drift.
#
# Cross-platform: shasum -a 256 (macOS) / sha256sum (Linux). LC_ALL=C for deterministic sort.
# Source-set mirrors verify-wiki-sync.sh: agents (.codex/agents/*.md), skills
# (.codex/skills/*/SKILL.md, or .agents/skills/*/SKILL.md when that installed-root exists),
# rules (.codex/rules/*.md), guides (guides/*/ dirs, concat-hashed).
#
# Source-able (functions) AND runnable:
#   bash .github/scripts/lib/source-hash.sh generate <output_path>   → writes manifest JSON
#
# This file is intentionally side-effect-free when sourced (no top-level execution).

portable_sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    echo "ERROR: neither shasum nor sha256sum found" >&2
    return 1
  fi
}

hash_one_file() {
  local file_path="$1"
  [ -f "$file_path" ] || { echo "ERROR: hash_one_file: not a file: $file_path" >&2; return 1; }
  portable_sha256 < "$file_path"
}

hash_dir_concat() {
  local dir_path="$1"
  if [ ! -d "$dir_path" ]; then
    echo "ERROR: hash_dir_concat: not a directory: $dir_path" >&2
    return 1
  fi
  if [ -z "$(find "$dir_path" -type f 2>/dev/null | head -c1)" ]; then
    printf '' | portable_sha256
    return 0
  fi
  find "$dir_path" -type f -print0 2>/dev/null | LC_ALL=C sort -z | xargs -0 cat | portable_sha256
}

generate_manifest() {
  local out_file="$1"
  if [ -z "$out_file" ]; then
    echo "ERROR: generate_manifest: output path required" >&2
    return 1
  fi

  local skills_root=".codex/skills"
  if [ -d ".agents/skills" ]; then
    skills_root=".agents/skills"
  fi

  local entries
  entries=$(
    for src_file in .codex/agents/*.md; do
      [ -e "$src_file" ] || continue
      printf '%s\t%s\n' "$src_file" "$(hash_one_file "$src_file")"
    done

    while IFS= read -r src_file; do
      [ -n "$src_file" ] || continue
      printf '%s\t%s\n' "$src_file" "$(hash_one_file "$src_file")"
    done < <(find "$skills_root" -name "SKILL.md" -type f 2>/dev/null)

    for src_file in .codex/rules/*.md; do
      [ -e "$src_file" ] || continue
      printf '%s\t%s\n' "$src_file" "$(hash_one_file "$src_file")"
    done

    while IFS= read -r src_dir; do
      [ -n "$src_dir" ] || continue
      printf '%s\t%s\n' "$src_dir" "$(hash_dir_concat "$src_dir")"
    done < <(find guides -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
  )

  printf '%s\n' "$entries" \
    | grep -v '^[[:space:]]*$' \
    | LC_ALL=C sort \
    | jq -R -s '
        split("\n")
        | map(select(length > 0) | split("\t") | {key: .[0], value: .[1]})
        | from_entries
      ' > "$out_file"
}

if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  cmd="${1:-}"
  case "$cmd" in
    generate)
      shift
      generate_manifest "${1:-}"
      ;;
    *)
      echo "Usage: bash $0 generate <output_path>" >&2
      echo "       (or 'source $0' to use hash_one_file / hash_dir_concat / generate_manifest)" >&2
      exit 1
      ;;
  esac
fi
