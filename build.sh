#!/bin/bash
# Build script for YggTorrent Helper
# Cross-platform script for Linux/macOS/Windows (Git Bash) - suitable for CI/CD

set -e

# Get script directory (works on Linux/macOS/Git Bash)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Files to include in the package
FILES=(
    "manifest.json"
    "background.js"
    "content.js"
    "content.css"
    "popup.html"
    "popup.js"
    "popup.css"
    "icons/icon16.png"
    "icons/icon48.png"
    "icons/icon128.png"
)

echo "Building YggTorrent Helper..."

# Check for jq dependency
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed."
    echo "  Ubuntu/Debian: sudo apt-get install jq"
    echo "  macOS: brew install jq"
    echo "  Windows: choco install jq"
    exit 1
fi

# Extract version from manifest.json
VERSION=$(jq -r '.version' manifest.json)

if [ -z "$VERSION" ]; then
    echo "Error: Unable to extract version from manifest.json"
    exit 1
fi

OUTPUT="ygg-helper-dl-v${VERSION}.zip"

echo "Version: $VERSION"

# Check if all required files exist
MISSING=0
for file in "${FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "Error: Required file missing: $file"
        MISSING=1
    fi
done

if [ $MISSING -eq 1 ]; then
    echo "Build failed: Missing required files"
    exit 1
fi

# Remove existing output if present
if [ -f "$OUTPUT" ]; then
    rm "$OUTPUT"
fi

# Create zip archive
# Using -y for symlinks (Linux/macOS compatibility)
# Using -X to exclude extended attributes (macOS compatibility)
if ! zip -y -X "$OUTPUT" "${FILES[@]}" > /dev/null; then
    echo "Error: Failed to create $OUTPUT"
    exit 1
fi

if [ ! -f "$OUTPUT" ]; then
    echo "Error: Failed to create $OUTPUT"
    exit 1
fi

# Get file size
SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')

echo "Success: Built $OUTPUT ($SIZE)"
echo ""
echo "To install:"
echo "  1. Unzip $OUTPUT"
echo "  2. Go to brave://extensions (or chrome://extensions)"
echo "  3. Enable Developer Mode"
echo "  4. Click \"Load unpacked\" and select the unzipped folder"
