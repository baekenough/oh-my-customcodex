#!/usr/bin/env bash
# Verify R006 Context Fork Criteria matches actual SKILL.md frontmatter.
# Usage: bash .github/scripts/verify-fork-list.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RULE_FILE="${ROOT}/.codex/rules/MUST-agent-design.md"
SKILLS_DIR="${ROOT}/.codex/skills"

if [[ ! -f "${RULE_FILE}" ]]; then
  echo "error: ${RULE_FILE} not found" >&2
  exit 1
fi

if [[ ! -d "${SKILLS_DIR}" ]]; then
  echo "error: ${SKILLS_DIR} not found" >&2
  exit 1
fi

DOC_LINE="$(grep -E 'Current: [0-9]+/12 \(' "${RULE_FILE}" | head -1 || true)"

if [[ -z "${DOC_LINE}" ]]; then
  echo "error: R006 Context Fork Criteria line not found" >&2
  exit 1
fi

DOC_COUNT="$(printf '%s\n' "${DOC_LINE}" | sed -E 's#.*Current: ([0-9]+)/12.*#\1#')"
DOC_LIST="$(printf '%s\n' "${DOC_LINE}" | sed -E 's#.*Current: [0-9]+/12 \(([^)]*)\).*#\1#' | tr ',' '\n' | sed 's/^ *//; s/ *$//' | sort)"

ACTUAL_LIST="$(
  for skill_file in "${SKILLS_DIR}"/*/SKILL.md; do
    [[ -f "${skill_file}" ]] || continue
    if awk '
      BEGIN { in_frontmatter = 0; found = 0 }
      NR == 1 && $0 == "---" { in_frontmatter = 1; next }
      in_frontmatter && $0 == "---" { exit }
      in_frontmatter && $0 ~ /^context:[[:space:]]*fork[[:space:]]*$/ { found = 1 }
      END { exit found ? 0 : 1 }
    ' "${skill_file}"; then
      skill_name="$(awk '
        NR == 1 && $0 == "---" { in_frontmatter = 1; next }
        in_frontmatter && $0 == "---" { exit }
        in_frontmatter && $0 ~ /^name:[[:space:]]*/ {
          sub(/^name:[[:space:]]*/, "")
          gsub(/^"|"$/, "")
          print
          exit
        }
      ' "${skill_file}")"
      if [[ -z "${skill_name}" ]]; then
        echo "error: context: fork skill has no frontmatter name: ${skill_file}" >&2
        exit 1
      fi
      printf '%s\n' "${skill_name}"
    fi
  done | sort
)"

ACTUAL_COUNT="$(printf '%s\n' "${ACTUAL_LIST}" | sed '/^$/d' | wc -l | tr -d ' ')"
DOC_LIST_COUNT="$(printf '%s\n' "${DOC_LIST}" | sed '/^$/d' | wc -l | tr -d ' ')"

DOC_TMP="$(mktemp)"
ACTUAL_TMP="$(mktemp)"
trap 'rm -f "${DOC_TMP}" "${ACTUAL_TMP}"' EXIT

printf '%s\n' "${DOC_LIST}" | sed '/^$/d' > "${DOC_TMP}"
printf '%s\n' "${ACTUAL_LIST}" | sed '/^$/d' > "${ACTUAL_TMP}"

MISSING="$(comm -23 "${ACTUAL_TMP}" "${DOC_TMP}" || true)"
EXTRA="$(comm -13 "${ACTUAL_TMP}" "${DOC_TMP}" || true)"

echo "R006 documented count: ${DOC_COUNT}"
echo "R006 listed skills: ${DOC_LIST_COUNT}"
echo "Actual fork skill count: ${ACTUAL_COUNT}"
echo ""
echo "Actual fork skills:"
sed 's/^/  - /' "${ACTUAL_TMP}"

if [[ "${DOC_COUNT}" != "${ACTUAL_COUNT}" || "${DOC_LIST_COUNT}" != "${ACTUAL_COUNT}" || -n "${MISSING}" || -n "${EXTRA}" ]]; then
  echo ""
  echo "ERROR: R006 fork list drift detected"
  [[ "${DOC_COUNT}" != "${ACTUAL_COUNT}" ]] && echo "  - documented count ${DOC_COUNT} != actual count ${ACTUAL_COUNT}"
  [[ "${DOC_LIST_COUNT}" != "${ACTUAL_COUNT}" ]] && echo "  - listed skill count ${DOC_LIST_COUNT} != actual count ${ACTUAL_COUNT}"
  if [[ -n "${MISSING}" ]]; then
    echo "  - missing from R006:"
    printf '%s\n' "${MISSING}" | sed 's/^/    - /'
  fi
  if [[ -n "${EXTRA}" ]]; then
    echo "  - extra in R006:"
    printf '%s\n' "${EXTRA}" | sed 's/^/    - /'
  fi
  echo "  Fix: update Context Fork Criteria in ${RULE_FILE}"
  exit 1
fi

echo ""
echo "OK: R006 fork list matches actual SKILL.md frontmatter (${ACTUAL_COUNT}/12)"
