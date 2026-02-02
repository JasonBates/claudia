#!/bin/bash
#
# Launch Claudia with debug logging enabled
#
# This enables detailed logging to:
#   ~/Library/Application Support/com.jasonbates.claudia/logs/claude-debug.log
#   /tmp/claude-commands-debug.log
#
# Usage: ./scripts/run-claudia-debug.sh
#        claudia-debug  (if alias is set up)
#

set -euo pipefail

# Find the Claudia app - prefer /Applications, fall back to dev build
if [[ -x "/Applications/Claudia.app/Contents/MacOS/Claudia" ]]; then
    APP_PATH="/Applications/Claudia.app/Contents/MacOS/Claudia"
elif [[ -x "$HOME/Applications/Claudia.app/Contents/MacOS/Claudia" ]]; then
    APP_PATH="$HOME/Applications/Claudia.app/Contents/MacOS/Claudia"
else
    # Dev build path
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    APP_PATH="$SCRIPT_DIR/../src-tauri/target/release/bundle/macos/Claudia.app/Contents/MacOS/Claudia"
fi

if [[ ! -x "$APP_PATH" ]]; then
    echo "Error: Claudia not found at expected locations"
    exit 1
fi

LOG_DIR="$HOME/Library/Application Support/com.jasonbates.claudia/logs"

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

echo "Starting Claudia with debug logging enabled..."
echo "App: $APP_PATH"
echo ""
echo "Debug logs will be written to:"
echo "  - $LOG_DIR/claude-debug.log"
echo "  - /tmp/claude-commands-debug.log"
echo ""
echo "When the issue occurs, run: bugtime"
echo ""

# Check if Claudia is already running
if pgrep -f "Claudia.app" > /dev/null 2>&1; then
    echo "Warning: Claudia is already running. Kill existing process? (y/N)"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        pkill -f "Claudia.app" || true
        sleep 1
    else
        echo "Exiting. Stop existing Claudia first."
        exit 1
    fi
fi

# Launch with debug enabled - use env to explicitly pass the variable
exec env CLAUDIA_DEBUG=1 "$APP_PATH"
