#!/bin/bash
# Claudia CLI Installer
# Installs the 'claudia' command to launch Claudia.app from any directory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/.local/bin"
LAUNCHER="$SCRIPT_DIR/claudia"

echo "🔧 Installing Claudia CLI..."

# Check if Claudia.app exists
APP_PATH=""
if [ -d "/Applications/Claudia.app" ]; then
    APP_PATH="/Applications/Claudia.app"
elif [ -d "$HOME/Applications/Claudia.app" ]; then
    APP_PATH="$HOME/Applications/Claudia.app"
fi

if [ -z "$APP_PATH" ]; then
    echo ""
    echo "⚠️  Claudia.app not found in /Applications or ~/Applications"
    echo ""
    echo "Build and install it first:"
    echo "  npm install"
    echo "  npm run tauri build"
    echo "  cp -R src-tauri/target/release/bundle/macos/Claudia.app /Applications/"
    echo ""
    echo "Then run this script again."
    exit 1
fi

echo "✓ Found $APP_PATH"

# Create bin directory if needed
if [ ! -d "$BIN_DIR" ]; then
    echo "Creating $BIN_DIR..."
    mkdir -p "$BIN_DIR"
fi

# Copy launcher script
echo "Installing claudia to $BIN_DIR..."
cp "$LAUNCHER" "$BIN_DIR/claudia"
chmod +x "$BIN_DIR/claudia"

echo "✓ Installed $BIN_DIR/claudia"

# Check if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo ""
    echo "⚠️  $BIN_DIR is not in your PATH"
    echo ""
    echo "Add this to your ~/.zshrc (or ~/.bashrc):"
    echo ""
    echo '  export PATH="$HOME/.local/bin:$PATH"'
    echo ""
    echo "Then run: source ~/.zshrc"
else
    echo "✓ $BIN_DIR is in PATH"
fi

echo ""
echo "✅ Done! Run 'claudia' from any project directory to launch Claudia."
