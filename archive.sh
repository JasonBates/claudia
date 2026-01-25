#!/bin/bash
# archive.sh - Clean up build artifacts and optionally archive the workspace
# Preserves node_modules by default for faster rebuilds

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME=$(basename "$SCRIPT_DIR")
ARCHIVE_DIR="$HOME/conductor-archives"
CARGO_TARGET="$HOME/.cargo/target/claude-terminal"

# Flags
FULL=false
ARCHIVE=false
CLEAN_RUST=false

print_help() {
    echo "Usage: ./archive.sh [OPTIONS]"
    echo ""
    echo "Clean up build artifacts and temp files."
    echo "By default, preserves node_modules for faster rebuilds."
    echo ""
    echo "Options:"
    echo "  --full     Also remove node_modules/"
    echo "  --archive  Create timestamped tarball to ~/conductor-archives/"
    echo "  --rust     Also clean Rust artifacts from shared target"
    echo "  --help     Show this help message"
    echo ""
    echo "Default behavior:"
    echo "  - Kill running CT processes"
    echo "  - Clean dist/ (Vite output)"
    echo "  - Clean temp/debug files in /tmp/"
    echo "  - Keep node_modules/"
    echo "  - Keep shared Cargo target (unless --rust)"
}

kill_processes() {
    echo -e "${BLUE}Checking for running CT processes...${NC}"

    # Kill any running CT.app instances
    if pgrep -f "CT.app" > /dev/null 2>&1; then
        echo -e "${YELLOW}  Killing CT.app processes...${NC}"
        pkill -f "CT.app" || true
    fi

    # Kill any running tauri dev processes
    if pgrep -f "tauri dev" > /dev/null 2>&1; then
        echo -e "${YELLOW}  Killing tauri dev processes...${NC}"
        pkill -f "tauri dev" || true
    fi

    # Kill vite dev server
    if pgrep -f "vite" > /dev/null 2>&1; then
        echo -e "${YELLOW}  Killing vite processes...${NC}"
        pkill -f "vite" || true
    fi

    echo -e "${GREEN}  Processes cleaned${NC}"
}

clean_temp_files() {
    echo -e "${BLUE}Cleaning temp/debug files...${NC}"

    local files=(
        "/tmp/claude-bridge-debug.log"
        "/tmp/claude-rust-debug.log"
        "/tmp/claude-commands-debug.log"
        "/tmp/claude-permission-mcp.log"
        "/tmp/claude-terminal-permission-request.json"
        "/tmp/claude-terminal-permission-response.json"
    )

    for file in "${files[@]}"; do
        if [ -f "$file" ]; then
            rm -f "$file"
            echo -e "${GREEN}  Removed $file${NC}"
        fi
    done

    echo -e "${GREEN}  Temp files cleaned${NC}"
}

clean_dist() {
    echo -e "${BLUE}Cleaning dist/ directory...${NC}"

    if [ -d "dist" ]; then
        rm -rf dist
        echo -e "${GREEN}  Removed dist/${NC}"
    else
        echo -e "${GREEN}  dist/ not present${NC}"
    fi
}

clean_node_modules() {
    echo -e "${BLUE}Cleaning node_modules/...${NC}"

    if [ -d "node_modules" ]; then
        rm -rf node_modules
        echo -e "${GREEN}  Removed node_modules/${NC}"
    else
        echo -e "${GREEN}  node_modules/ not present${NC}"
    fi
}

clean_rust_artifacts() {
    echo -e "${BLUE}Cleaning Rust artifacts from shared target...${NC}"

    # Only clean this project's artifacts, not dependencies
    local build_dir="$CARGO_TARGET/release/build/claude-terminal-*"
    local deps_dir="$CARGO_TARGET/release/deps/claude_terminal*"
    local incremental="$CARGO_TARGET/release/incremental/claude_terminal*"

    rm -rf $build_dir 2>/dev/null || true
    rm -rf $deps_dir 2>/dev/null || true
    rm -rf $incremental 2>/dev/null || true

    # Clean debug artifacts too
    build_dir="$CARGO_TARGET/debug/build/claude-terminal-*"
    deps_dir="$CARGO_TARGET/debug/deps/claude_terminal*"
    incremental="$CARGO_TARGET/debug/incremental/claude_terminal*"

    rm -rf $build_dir 2>/dev/null || true
    rm -rf $deps_dir 2>/dev/null || true
    rm -rf $incremental 2>/dev/null || true

    # Clean bundle output
    rm -rf "$CARGO_TARGET/release/bundle" 2>/dev/null || true
    rm -rf "$CARGO_TARGET/debug/bundle" 2>/dev/null || true

    echo -e "${GREEN}  Rust artifacts cleaned${NC}"
}

create_archive() {
    echo -e "${BLUE}Creating archive...${NC}"

    # Create archive directory if needed
    mkdir -p "$ARCHIVE_DIR"

    # Generate timestamp
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    ARCHIVE_NAME="${PROJECT_NAME}_${TIMESTAMP}.tar.gz"
    ARCHIVE_PATH="$ARCHIVE_DIR/$ARCHIVE_NAME"

    # Create tarball (excluding heavy directories)
    echo -e "${YELLOW}  Creating $ARCHIVE_NAME...${NC}"
    tar -czf "$ARCHIVE_PATH" \
        --exclude='node_modules' \
        --exclude='dist' \
        --exclude='src-tauri/target' \
        --exclude='.git' \
        -C "$(dirname "$SCRIPT_DIR")" \
        "$PROJECT_NAME"

    echo -e "${GREEN}  Archive created: $ARCHIVE_PATH${NC}"
    echo -e "${GREEN}  Size: $(du -h "$ARCHIVE_PATH" | cut -f1)${NC}"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --full)
            FULL=true
            shift
            ;;
        --archive)
            ARCHIVE=true
            shift
            ;;
        --rust)
            CLEAN_RUST=true
            shift
            ;;
        --help)
            print_help
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            print_help
            exit 1
            ;;
    esac
done

# Change to script directory
cd "$SCRIPT_DIR"

echo ""
echo -e "${BLUE}=== Claude Terminal Archive/Clean ===${NC}"
echo ""

# Create archive first if requested
if [ "$ARCHIVE" = true ]; then
    create_archive
    echo ""
fi

# Kill processes
kill_processes
echo ""

# Clean temp files
clean_temp_files
echo ""

# Clean dist
clean_dist
echo ""

# Clean node_modules if --full
if [ "$FULL" = true ]; then
    clean_node_modules
    echo ""
fi

# Clean Rust artifacts if --rust
if [ "$CLEAN_RUST" = true ]; then
    clean_rust_artifacts
    echo ""
fi

echo -e "${GREEN}=== Cleanup Complete ===${NC}"
echo ""

if [ "$FULL" = true ]; then
    echo "Cleaned: dist/, node_modules/, temp files"
    echo "Run ./setup.sh to reinstall dependencies"
else
    echo "Cleaned: dist/, temp files"
    echo "node_modules/ preserved (use --full to remove)"
fi

if [ "$CLEAN_RUST" = true ]; then
    echo "Rust artifacts cleaned from shared target"
fi

echo ""
