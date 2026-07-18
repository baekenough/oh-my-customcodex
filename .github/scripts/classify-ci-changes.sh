#!/usr/bin/env bash

set -uo pipefail

BASE_SHA="${1:-}"
HEAD_SHA="${2:-}"
OUTPUT_FILE="${GITHUB_OUTPUT:-/dev/stdout}"

emit_full_ci() {
  if ! printf 'full_ci=%s\n' "$1" >> "$OUTPUT_FILE"; then
    echo '::error::Could not publish the fail-closed CI classification.' >&2
    exit 1
  fi
}

fail_closed() {
  printf 'CI change classification failed closed: %s\n' "$1" >&2
  emit_full_ci true
  exit 0
}

if [[ -z "$BASE_SHA" || -z "$HEAD_SHA" ]]; then
  fail_closed 'base or head revision is missing'
fi

if [[ "$BASE_SHA" =~ ^0+$ || "$HEAD_SHA" =~ ^0+$ ]]; then
  fail_closed 'base or head revision is the all-zero sentinel'
fi

if ! git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then
  fail_closed 'base revision is unavailable'
fi

if ! git cat-file -e "${HEAD_SHA}^{commit}" 2>/dev/null; then
  fail_closed 'head revision is unavailable'
fi

CHANGED_PATHS=$(mktemp) || fail_closed 'unable to allocate a temporary path list'
trap 'rm -f "$CHANGED_PATHS"' EXIT

# Disable rename detection so moving executable content into the documentation
# allowlist still reports its original, non-documentation path.
if ! git diff --no-renames --name-only -z "$BASE_SHA" "$HEAD_SHA" -- > "$CHANGED_PATHS"; then
  fail_closed 'git diff could not compare the requested revisions'
fi

if [[ ! -s "$CHANGED_PATHS" ]]; then
  fail_closed 'revision range contains no changed paths'
fi

FULL_CI=false
while IFS= read -r -d '' path; do
  case "$path" in
    docs/.vitepress | docs/.vitepress/*)
      FULL_CI=true
      break
      ;;
    README*.md)
      if [[ "$path" == */* ]]; then
        FULL_CI=true
        break
      fi
      ;;
    CHANGELOG.md | docs/*.md | guides/*.md | wiki/*.md)
      ;;
    *)
      FULL_CI=true
      break
      ;;
  esac
done < "$CHANGED_PATHS"

emit_full_ci "$FULL_CI"
