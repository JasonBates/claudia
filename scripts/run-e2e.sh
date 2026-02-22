#!/bin/bash
# run-e2e.sh - Build Claudia debug binary and start WebDriver server for E2E testing
#
# The tauri-plugin-webdriver embeds a W3C WebDriver server in debug builds.
# The tauri-webdriver CLI launches the app and proxies WebDriver commands to it.
#
# Usage: ./scripts/run-e2e.sh
#   Then connect MCP or WebdriverIO to http://127.0.0.1:4444
#
# Prerequisites:
#   cargo install tauri-webdriver --locked

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v tauri-webdriver &> /dev/null; then
    echo "ERROR: tauri-webdriver not found. Install with:"
    echo "  cargo install tauri-webdriver --locked"
    exit 1
fi

echo "Building Claudia debug binary..."
cd "$PROJECT_DIR"
# Must use 'npx tauri build --debug' instead of plain 'cargo build'.
# Plain 'cargo build' does NOT embed the frontend assets into the binary,
# resulting in "asset not found: index.html" and a white screen.
npx tauri build --debug --no-bundle

BINARY="$PROJECT_DIR/src-tauri/target/debug/claudia"
if [ ! -f "$BINARY" ]; then
    echo "ERROR: Debug binary not found at $BINARY"
    exit 1
fi

echo ""
echo "Debug binary: $BINARY"
echo ""
echo "Starting tauri-webdriver on port 4444..."
echo "Connect MCP or WebdriverIO to http://127.0.0.1:4444"
echo "Press Ctrl+C to stop"
echo ""

exec tauri-webdriver --port 4444
