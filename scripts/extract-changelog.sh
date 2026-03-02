#!/usr/bin/env bash
# Extract a specific version section from CHANGELOG.md
# Usage: ./extract-changelog.sh <version>
# Example: ./extract-changelog.sh 1.3.2

set -euo pipefail

# Normalize version argument (strip "v" prefix if present)
VERSION="${1#v}"
CHANGELOG_FILE="$(git rev-parse --show-toplevel)/CHANGELOG.md"

# Check if CHANGELOG.md exists
if [[ ! -f "$CHANGELOG_FILE" ]]; then
    echo "Error: CHANGELOG.md not found at $CHANGELOG_FILE" >&2
    exit 1
fi

# Check if version argument is provided
if [[ -z "$VERSION" ]]; then
    echo "Error: Version argument required" >&2
    echo "Usage: $0 <version>" >&2
    exit 1
fi

# Find the version section using awk
# Extracts content between "## [VERSION]" and the next "## [" header or EOF
extract_version() {
    local version="$1"
    local file="$2"

    awk -v version="$version" '
    BEGIN {
        found = 0
        in_section = 0
    }

    # Match version header: ## [X.Y.Z] or ## [X.Y.Z] - YYYY-MM-DD
    /^## \[[0-9]+\.[0-9]+\.[0-9]+\]/ {
        # Extract version number from header
        if (match($0, /\[([0-9]+\.[0-9]+\.[0-9]+)\]/) > 0) {
            header_version = substr($0, RSTART + 1, RLENGTH - 2)
        }

        if (header_version == version) {
            found = 1
            in_section = 1
            # Print the version header
            print $0
            next
        } else if (in_section) {
            # We hit the next version header, stop processing
            exit
        }
    }

    # Handle "Unreleased" section and continue
    /^## \[Unreleased\]/ {
        if (in_section) {
            exit
        }
        next
    }

    # Print lines within the target section
    in_section {
        print $0
    }

    END {
        if (!found) {
            print "Error: Version " version " not found in CHANGELOG.md" > "/dev/stderr"
            exit 1
        }
    }
    ' "$file"
}

# Extract and output the version section
if ! extract_version "$VERSION" "$CHANGELOG_FILE"; then
    exit 1
fi
