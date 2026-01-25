#!/bin/bash
# run.sh - Build and launch Claude Terminal
# Uses shared Cargo target for efficient multi-worktree builds

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Shared Cargo target for all worktrees
export CARGO_TARGET_DIR="$HOME/.cargo/target/claude-terminal"

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_BUNDLE="$CARGO_TARGET_DIR/release/bundle/macos/CT.app"
INSTALL_PATH="/Applications/CT.app"

# Flags
MODE="dev"
FORCE=false

print_help() {
    echo "Usage: ./run.sh [OPTIONS]"
    echo ""
    echo "Build and launch Claude Terminal."
    echo "Uses shared Cargo target at $CARGO_TARGET_DIR"
    echo ""
    echo "Options:"
    echo "  --dev      Development mode with hot reload (default)"
    echo "  --build    Build production app only"
    echo "  --prod     Build and launch production app"
    echo "  --install  Build and copy to /Applications"
    echo "  --force    Force rebuild even if app exists"
    echo "  --help     Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./run.sh              # Start dev server"
    echo "  ./run.sh --build      # Build production app"
    echo "  ./run.sh --install    # Build and install to /Applications"
}

check_deps() {
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}node_modules not found. Running setup...${NC}"
        ./setup.sh
    fi
}

run_dev() {
    echo -e "${BLUE}Starting development mode...${NC}"
    echo -e "${BLUE}Cargo target: $CARGO_TARGET_DIR${NC}"
    echo ""
    check_deps
    npm run tauri dev
}

run_build() {
    echo -e "${BLUE}Building production app...${NC}"
    echo -e "${BLUE}Cargo target: $CARGO_TARGET_DIR${NC}"
    echo ""

    if [ "$FORCE" = false ] && [ -d "$APP_BUNDLE" ]; then
        echo -e "${YELLOW}App bundle exists at $APP_BUNDLE${NC}"
        echo -e "${YELLOW}Use --force to rebuild${NC}"
        echo ""
        return 0
    fi

    check_deps
    npm run tauri build

    echo ""
    echo -e "${GREEN}Build complete!${NC}"
    echo "App bundle: $APP_BUNDLE"
}

run_prod() {
    run_build

    if [ ! -d "$APP_BUNDLE" ]; then
        echo -e "${RED}ERROR: App bundle not found at $APP_BUNDLE${NC}"
        exit 1
    fi

    echo ""
    echo -e "${BLUE}Launching CT.app...${NC}"
    open "$APP_BUNDLE"
}

run_install() {
    FORCE=true  # Always rebuild for install
    run_build

    if [ ! -d "$APP_BUNDLE" ]; then
        echo -e "${RED}ERROR: App bundle not found at $APP_BUNDLE${NC}"
        exit 1
    fi

    echo ""
    echo -e "${BLUE}Installing to $INSTALL_PATH...${NC}"

    # Remove existing installation
    if [ -d "$INSTALL_PATH" ]; then
        echo -e "${YELLOW}Removing existing installation...${NC}"
        rm -rf "$INSTALL_PATH"
    fi

    # Copy new app
    cp -R "$APP_BUNDLE" "$INSTALL_PATH"
    echo -e "${GREEN}Installed to $INSTALL_PATH${NC}"

    echo ""
    echo "Launch with: open /Applications/CT.app"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dev)
            MODE="dev"
            shift
            ;;
        --build)
            MODE="build"
            shift
            ;;
        --prod)
            MODE="prod"
            shift
            ;;
        --install)
            MODE="install"
            shift
            ;;
        --force)
            FORCE=true
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
echo -e "${BLUE}=== Claude Terminal ===${NC}"
echo ""

case $MODE in
    dev)
        run_dev
        ;;
    build)
        run_build
        ;;
    prod)
        run_prod
        ;;
    install)
        run_install
        ;;
esac
