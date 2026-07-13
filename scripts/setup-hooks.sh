#!/bin/sh
# Setup git hooks for oh-my-customcodex development

fail() {
    echo "Error: $1" >&2
    exit 1
}

if ! SCRIPT_DIR=$(CDPATH= cd -P "$(dirname "$0")" 2>/dev/null && pwd -P); then
    fail "unable to resolve the setup script directory"
fi
PACKAGE_ROOT=$(dirname "$SCRIPT_DIR")

if ! command -v git >/dev/null 2>&1; then
    echo "Skipping Git hooks setup: Git is not available."
    exit 0
fi

if GIT_ROOT_OUTPUT=$(LC_ALL=C git rev-parse --show-toplevel 2>&1); then
    :
else
    case "$GIT_ROOT_OUTPUT" in
        *"not a git repository"*|*"must be run in a work tree"*)
            echo "Skipping Git hooks setup: not inside a Git work tree."
            exit 0
            ;;
        *)
            fail "unable to resolve Git work tree: $GIT_ROOT_OUTPUT"
            ;;
    esac
fi

if ! GIT_ROOT=$(CDPATH= cd -P "$GIT_ROOT_OUTPUT" 2>/dev/null && pwd -P); then
    fail "unable to access Git work tree: $GIT_ROOT_OUTPUT"
fi

if [ "$PACKAGE_ROOT" != "$GIT_ROOT" ]; then
    echo "Skipping Git hooks setup: package directory is not the Git work-tree root."
    exit 0
fi

HOOK_SOURCE="$PACKAGE_ROOT/.husky/pre-commit"
if [ ! -f "$HOOK_SOURCE" ]; then
    fail ".husky/pre-commit not found"
fi

if HOOK_DIR_OUTPUT=$(cd "$GIT_ROOT" && LC_ALL=C git rev-parse --git-path hooks 2>&1); then
    :
else
    fail "unable to resolve Git hooks directory: $HOOK_DIR_OUTPUT"
fi

if [ -z "$HOOK_DIR_OUTPUT" ]; then
    fail "Git returned an empty hooks directory"
fi

case "$HOOK_DIR_OUTPUT" in
    /*) HOOK_DIR="$HOOK_DIR_OUTPUT" ;;
    *) HOOK_DIR="$GIT_ROOT/$HOOK_DIR_OUTPUT" ;;
esac

if ! mkdir -p "$HOOK_DIR"; then
    fail "unable to create Git hooks directory: $HOOK_DIR"
fi

if ! cp "$HOOK_SOURCE" "$HOOK_DIR/pre-commit"; then
    fail "unable to copy pre-commit hook to: $HOOK_DIR/pre-commit"
fi

if ! chmod +x "$HOOK_DIR/pre-commit"; then
    fail "unable to make pre-commit hook executable: $HOOK_DIR/pre-commit"
fi

echo "Pre-commit hook installed successfully!"
echo "Git hooks setup complete."
