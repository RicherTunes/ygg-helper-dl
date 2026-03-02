#!/usr/bin/env bash
# Release a new version of YggTorrent Helper
# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 1.3.4
#
# This script:
#   1. Bumps version in manifest.json and JS file headers
#   2. Adds a CHANGELOG.md section (you fill it in)
#   3. Commits, tags, and pushes
#   4. The CI workflow builds the .zip and creates the GitHub Release

set -euo pipefail

# --- Validate arguments ---
if [ $# -lt 1 ]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 1.3.4"
    exit 1
fi

NEW_VERSION="$1"
NEW_VERSION="${NEW_VERSION#v}" # Strip v prefix if provided

# Validate version format
if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    echo "Error: Version must be in X.Y.Z format (got: $NEW_VERSION)"
    exit 1
fi

# --- Check prerequisites ---
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Check for clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Error: Working tree is not clean. Commit or stash your changes first."
    exit 1
fi

# Check we're on main
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
    echo "Error: Must be on main branch (currently on $BRANCH)"
    exit 1
fi

# Get current version
OLD_VERSION=$(grep -oP '"version": "\K[^"]+' manifest.json)
echo "Bumping version: $OLD_VERSION → $NEW_VERSION"

# Check that new version is actually newer
if [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
    echo "Error: New version is the same as current version ($OLD_VERSION)"
    exit 1
fi

# Check tag doesn't already exist
if git tag -l "v$NEW_VERSION" | grep -q .; then
    echo "Error: Tag v$NEW_VERSION already exists"
    exit 1
fi

# --- Bump version in all files ---
echo ""
echo "Updating version references..."

# manifest.json
sed -i "s/\"version\": \"$OLD_VERSION\"/\"version\": \"$NEW_VERSION\"/" manifest.json
echo "  manifest.json ✓"

# JS file headers
for file in background.js content.js popup.js; do
    if grep -q "v$OLD_VERSION" "$file"; then
        sed -i "s/v$OLD_VERSION/v$NEW_VERSION/" "$file"
        echo "  $file ✓"
    fi
done

# --- Update CHANGELOG ---
DATE=$(date +%Y-%m-%d)

# Check if changelog already has this version
if grep -q "## \[$NEW_VERSION\]" CHANGELOG.md; then
    echo "  CHANGELOG.md already has [$NEW_VERSION] section ✓"
else
    # Insert new section after [Unreleased]
    sed -i "/^## \[Unreleased\]/a\\\\n## [$NEW_VERSION] - $DATE\\n\\n### Added\\n\\n### Fixed\\n\\n### Changed\\n- **Version** : $OLD_VERSION → $NEW_VERSION." CHANGELOG.md
    echo "  CHANGELOG.md section added ✓"
    echo ""
    echo "================================================"
    echo "  CHANGELOG.md needs your input!"
    echo "  Fill in the Added/Fixed/Changed sections,"
    echo "  then re-run this script."
    echo "================================================"
    exit 0
fi

# --- Commit, tag, push ---
echo ""
echo "Committing..."
git add manifest.json background.js content.js popup.js CHANGELOG.md
git commit -m "v$NEW_VERSION: $(head -1 <(grep -A1 "## \[$NEW_VERSION\]" CHANGELOG.md | tail -1) || echo "Release $NEW_VERSION")" \
    -m "Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

echo "Tagging v$NEW_VERSION..."
git tag "v$NEW_VERSION"

echo "Pushing..."
git push origin main "v$NEW_VERSION"

echo ""
echo "================================================"
echo "  v$NEW_VERSION released!"
echo "  CI will build the .zip and create the release."
echo "  https://github.com/RicherTunes/ygg-helper-dl/actions"
echo "================================================"
