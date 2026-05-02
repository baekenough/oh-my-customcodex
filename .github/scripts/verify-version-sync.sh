#!/usr/bin/env bash
# Verify package.json and templates/manifest.json versions stay aligned.
# Usage: bash .github/scripts/verify-version-sync.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PACKAGE_JSON="${ROOT}/package.json"
MANIFEST_JSON="${ROOT}/templates/manifest.json"

if [[ ! -f "${PACKAGE_JSON}" ]]; then
  echo "error: ${PACKAGE_JSON} not found" >&2
  exit 1
fi

if [[ ! -f "${MANIFEST_JSON}" ]]; then
  echo "error: ${MANIFEST_JSON} not found" >&2
  exit 1
fi

PACKAGE_VERSION="$(node -p "require('${PACKAGE_JSON}').version")"
MANIFEST_VERSION="$(node -p "require('${MANIFEST_JSON}').version")"

echo "package.json version: ${PACKAGE_VERSION}"
echo "templates/manifest.json version: ${MANIFEST_VERSION}"

if [[ "${PACKAGE_VERSION}" != "${MANIFEST_VERSION}" ]]; then
  echo "::error::Version mismatch! package.json (${PACKAGE_VERSION}) != templates/manifest.json (${MANIFEST_VERSION}). Update templates/manifest.json to match package.json."
  exit 1
fi

echo "Version sync check passed: ${PACKAGE_VERSION}"
