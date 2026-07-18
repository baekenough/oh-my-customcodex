#!/usr/bin/env bash

set -euo pipefail

REPO="${GH_REPO:?GH_REPO is required}"
ISSUE="${ISSUE_NUMBER:?ISSUE_NUMBER is required}"
ACK_MARKER='<!-- triage-dispatch:acknowledged -->'

if ! labels=$(
  gh api --paginate \
    "repos/${REPO}/issues/${ISSUE}/labels?per_page=100" \
    --jq '.[].name'
); then
  echo "::error::Could not read the latest labels for issue #${ISSUE}." >&2
  exit 1
fi

if grep -Fqx 'triaged' <<< "$labels"; then
  echo "Issue #${ISSUE} is already triaged; no acknowledgment mutation is needed."
  exit 0
fi

if ! comments=$(
  gh api --paginate \
    "repos/${REPO}/issues/${ISSUE}/comments?per_page=100" \
    --jq '.[].body'
); then
  echo "::error::Could not read the latest comments for issue #${ISSUE}." >&2
  exit 1
fi

if ! grep -Fq "$ACK_MARKER" <<< "$comments"; then
  body_file=$(mktemp)
  trap 'rm -f "$body_file"' EXIT
  cat > "$body_file" <<'EOF'
<!-- triage-dispatch:acknowledged -->
Thanks for filing this issue! It has been acknowledged by our triage dispatch and will be reviewed shortly. Detailed triage is performed by the professor-triage skill during active development sessions.
EOF

  # The marker is persisted before the label. If the label mutation fails, a
  # queued retry observes this comment and repairs only the missing label.
  gh issue comment "$ISSUE" \
    --repo "$REPO" \
    --body-file "$body_file"
fi

gh issue edit "$ISSUE" \
  --repo "$REPO" \
  --add-label 'triaged'
