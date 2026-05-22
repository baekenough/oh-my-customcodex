#!/usr/bin/env bash
# plugin-cache-check.sh - SessionStart advisory hook.
# Detects plugin cache packages with package.json but missing node_modules.
# Always exits 0. Output advisory to stderr only.

set -euo pipefail

input=$(cat)

cache_roots=()
if [ -n "${CODEX_PLUGIN_CACHE:-}" ]; then
  cache_roots+=("$CODEX_PLUGIN_CACHE")
fi
if [ -n "${CLAUDE_PLUGIN_CACHE:-}" ]; then
  cache_roots+=("$CLAUDE_PLUGIN_CACHE")
fi
cache_roots+=("${HOME}/.codex/plugins/cache")
cache_roots+=("${HOME}/.claude/shared-plugins/cache")

missing=()
for cache_root in "${cache_roots[@]}"; do
  if [ ! -d "$cache_root" ]; then
    continue
  fi

  while IFS= read -r package_json; do
    package_dir=$(dirname "$package_json")
    if [ ! -d "$package_dir/node_modules" ]; then
      missing+=("$package_dir")
    fi
  done < <(find "$cache_root" -maxdepth 5 -name package.json 2>/dev/null)
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "[Advisory] Plugin cache missing node_modules (run \`(cd <dir> && bun install)\` per directory):" >&2
  for dir in "${missing[@]}"; do
    echo "  - $dir" >&2
  done
fi

echo "$input"
exit 0
