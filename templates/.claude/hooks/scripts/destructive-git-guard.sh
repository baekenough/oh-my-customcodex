#!/bin/bash
# Advisory guard for destructive git commands.
# Warns before commands that can discard worktree or branch state.
# This hook is advisory only: it prints warnings to stderr, records a
# PPID-scoped event, echoes the original hook input, and exits 0.

input=$(cat)
cmd=""

if command -v jq >/dev/null 2>&1; then
  cmd=$(echo "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
elif command -v node >/dev/null 2>&1; then
  cmd=$(
    printf '%s' "$input" | node -e 'let s = ""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => { try { const j = JSON.parse(s); process.stdout.write(j?.tool_input?.command || ""); } catch { process.exit(0); } });' 2>/dev/null
  )
fi

warn() {
  local pattern="$1"
  local command="$2"
  local violation_file="/tmp/.codex-destructive-git-violations-${PPID}"

  echo "[Hook] WARNING: destructive git command detected: ${pattern}" >&2
  echo "[Hook] Command: ${command}" >&2
  echo "[Hook] Verify target, preserve important work, and get explicit approval before continuing." >&2
  echo "[Hook] Recovery: inspect 'git status', 'git diff', and 'git reflog' before attempting repair." >&2

  printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$pattern" "$command" >> "$violation_file"
}

if [ -n "$cmd" ]; then
  case "$cmd" in
    *"git reset --hard"*)
      warn "git reset --hard" "$cmd"
      ;;
    *"git clean -fd"*|*"git clean -df"*|*"git clean -fxd"*|*"git clean -xdf"*)
      warn "git clean -fd/-fdx" "$cmd"
      ;;
    *"git restore"*|*"git checkout -- ."*|*"git checkout -- *"*)
      warn "git restore / git checkout --" "$cmd"
      ;;
    *"git branch -D"*)
      warn "git branch -D" "$cmd"
      echo "[Hook] Check whether the branch is merged before deleting it." >&2
      ;;
    *"git push --force"*|*"git push -f"*)
      warn "git push --force" "$cmd"
      ;;
  esac
fi

echo "$input"
exit 0
