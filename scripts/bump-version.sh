#!/bin/bash
#
# Bump version across all project files.
#
# Usage: ./scripts/bump-version.sh <version>
#
# Example: ./scripts/bump-version.sh 0.2.0
#
# This updates:
#   - package.json
#   - src-tauri/tauri.conf.json
#   - src-tauri/Cargo.toml

set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 0.2.0"
  exit 1
fi

# Validate version format (basic check)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: Invalid version format. Expected X.Y.Z or X.Y.Z-suffix"
  exit 1
fi

echo "Bumping version to $VERSION..."

# Update package.json (npm handles this well)
npm version "$VERSION" --no-git-tag-version --allow-same-version
echo "  Updated package.json"

# Update tauri.conf.json
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json
echo "  Updated src-tauri/tauri.conf.json"

# Update Cargo.toml (the first version line, which is the package version)
sed -i '' "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
echo "  Updated src-tauri/Cargo.toml"

echo ""
echo "Version bumped to $VERSION"
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff"
echo "  2. Commit: git add -A && git commit -m \"Bump version to $VERSION\""
echo "  3. Tag: git tag v$VERSION"
echo "  4. Push: git push origin main v$VERSION"
