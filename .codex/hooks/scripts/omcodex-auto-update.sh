#!/usr/bin/env bash
# Canonical wrapper for the child-package SessionStart auto-update hook.
# Keep the legacy script name as an implementation alias for compatibility.
exec "$(dirname "$0")/omcustom-auto-update.sh" "$@"
