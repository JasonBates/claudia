#!/bin/bash
# setup.sh - Install dependencies and prepare the environment for Claude Terminal
# Optimized for multiple Conductor worktrees with shared Cargo target

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Shared directories
CARGO_TARGET="$HOME/.cargo/target/claude-terminal"
CONFIG_DIR="$HOME/.config/claude-terminal"

# Flags
FORCE=false

print_help() {
    echo "Usage: ./setup.sh [OPTIONS]"
    echo ""
    echo "Verify prerequisites and install dependencies for Claude Terminal."
    echo "Optimized for multiple worktrees with shared Cargo target."
    echo ""
    echo "Options:"
    echo "  --force    Reinstall all dependencies even if cached"
    echo "  --help     Show this help message"
    echo ""
    echo "Prerequisites:"
    echo "  - Node.js 18+"
    echo "  - Rust toolchain (rustc, cargo)"
    echo "  - Claude Code CLI (claude command)"
}

check_node() {
    echo -e "${BLUE}Checking Node.js...${NC}"
    if ! command -v node &> /dev/null; then
        echo -e "${RED}ERROR: Node.js not found${NC}"
        echo "Install Node.js 18+ from https://nodejs.org or via nvm"
        exit 2
    fi

    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo -e "${RED}ERROR: Node.js 18+ required, found v$NODE_VERSION${NC}"
        exit 2
    fi
    echo -e "${GREEN}  Node.js $(node --version)${NC}"
}

check_rust() {
    echo -e "${BLUE}Checking Rust toolchain...${NC}"
    if ! command -v rustc &> /dev/null; then
        echo -e "${RED}ERROR: Rust not found${NC}"
        echo "Install Rust from https://rustup.rs"
        exit 2
    fi
    if ! command -v cargo &> /dev/null; then
        echo -e "${RED}ERROR: Cargo not found${NC}"
        echo "Install Rust from https://rustup.rs"
        exit 2
    fi
    echo -e "${GREEN}  rustc $(rustc --version | awk '{print $2}')${NC}"
    echo -e "${GREEN}  cargo $(cargo --version | awk '{print $2}')${NC}"
}

check_claude() {
    echo -e "${BLUE}Checking Claude Code CLI...${NC}"
    if ! command -v claude &> /dev/null; then
        echo -e "${RED}ERROR: Claude Code CLI not found${NC}"
        echo "Install Claude Code CLI: npm install -g @anthropic-ai/claude-code"
        exit 2
    fi
    echo -e "${GREEN}  claude CLI found at $(which claude)${NC}"
}

setup_shared_dirs() {
    echo -e "${BLUE}Setting up shared directories...${NC}"

    if [ ! -d "$CARGO_TARGET" ]; then
        mkdir -p "$CARGO_TARGET"
        echo -e "${GREEN}  Created $CARGO_TARGET${NC}"
    else
        echo -e "${GREEN}  Cargo target exists: $CARGO_TARGET${NC}"
    fi

    if [ ! -d "$CONFIG_DIR" ]; then
        mkdir -p "$CONFIG_DIR"
        echo -e "${GREEN}  Created $CONFIG_DIR${NC}"
    else
        echo -e "${GREEN}  Config dir exists: $CONFIG_DIR${NC}"
    fi
}

install_npm_deps() {
    echo -e "${BLUE}Checking npm dependencies...${NC}"

    HASH_FILE="node_modules/.package-lock-hash"
    CURRENT_HASH=$(md5 -q package-lock.json 2>/dev/null || md5sum package-lock.json | awk '{print $1}')

    if [ "$FORCE" = true ]; then
        echo -e "${YELLOW}  Force flag set, reinstalling...${NC}"
        npm install
        echo "$CURRENT_HASH" > "$HASH_FILE"
        echo -e "${GREEN}  Dependencies installed${NC}"
    elif [ -f "$HASH_FILE" ] && [ "$(cat "$HASH_FILE")" = "$CURRENT_HASH" ]; then
        echo -e "${GREEN}  Dependencies up to date (cached)${NC}"
    else
        echo -e "${YELLOW}  Installing dependencies...${NC}"
        npm install
        echo "$CURRENT_HASH" > "$HASH_FILE"
        echo -e "${GREEN}  Dependencies installed${NC}"
    fi
}

# Parse arguments
for arg in "$@"; do
    case $arg in
        --force)
            FORCE=true
            shift
            ;;
        --help)
            print_help
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $arg${NC}"
            print_help
            exit 1
            ;;
    esac
done

echo ""
echo -e "${BLUE}=== Claude Terminal Setup ===${NC}"
echo ""

check_node
check_rust
check_claude
setup_shared_dirs
install_npm_deps

echo ""
echo -e "${GREEN}=== Setup Complete ===${NC}"
echo ""
echo "Next steps:"
echo "  ./run.sh --dev      Start development mode"
echo "  ./run.sh --build    Build production app"
echo "  ./run.sh --help     See all options"
echo ""
