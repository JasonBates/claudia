#!/bin/bash
#
# Claudia Debug Log Collector
#
# Collects relevant logs and state for troubleshooting hang issues.
# Output is formatted for LLM analysis with limited context to avoid overwhelming.
#
# Usage: ./scripts/collect-debug-logs.sh [output_file] [session_id]
#

set -uo pipefail
trap '' PIPE

# Configuration
APP_SUPPORT_DIR="$HOME/Library/Application Support/com.jasonbates.claudia"
CLAUDE_PROJECTS_DIR="$HOME/.claude/projects"
OUTPUT_FILE="${1:-/tmp/claudia-debug-$(date +%Y%m%d-%H%M%S).md}"
SESSION_ID="${2:-}"

# Log line limits (keep small to fit in context window)
RUST_LOG_LINES=50
CMD_LOG_LINES=50
BRIDGE_LOG_LINES=30
SESSION_LINES=15

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1" >&2; }

{
    echo "# Claudia Debug Log Collection"
    echo ""
    echo "**Collected:** $(date '+%Y-%m-%d %H:%M:%S') | **macOS:** $(sw_vers -productVersion)"
    echo ""

    # Section 1: Process Status (compact)
    echo "## 1. Process Status"
    echo ""
    echo "\`\`\`"
    if pgrep -f "Claudia.app" > /dev/null 2>&1; then
        ps -o pid,state,%cpu,%mem,etime,command -p $(pgrep -f "Claudia.app" | tr '\n' ',') 2>/dev/null | head -5
    else
        echo "Claudia not running"
    fi
    echo "\`\`\`"
    echo ""

    # Section 2: Debug Logs (most important for hang diagnosis)
    echo "## 2. Debug Logs (last $RUST_LOG_LINES lines each)"
    echo ""

    MACOS_TEMP="${TMPDIR:-$(dirname $(mktemp -u))}"

    # Rust debug log
    RUST_LOG="$MACOS_TEMP/claude-rust-debug.log"
    if [[ -f "$RUST_LOG" ]]; then
        log_info "Found Rust debug log"
        echo "### claude-rust-debug.log"
        echo "**Size:** $(du -h "$RUST_LOG" | cut -f1) | **Modified:** $(stat -f '%Sm' -t '%H:%M:%S' "$RUST_LOG")"
        echo "\`\`\`"
        tail -$RUST_LOG_LINES "$RUST_LOG"
        echo "\`\`\`"
    else
        log_warn "No Rust debug log. Run: CLAUDIA_DEBUG=1 /Applications/Claudia.app/Contents/MacOS/Claudia"
        echo "**No Rust debug log found** - run with CLAUDIA_DEBUG=1"
    fi
    echo ""

    # Command debug log
    CMD_LOG="$MACOS_TEMP/claude-commands-debug.log"
    if [[ -f "$CMD_LOG" ]]; then
        log_info "Found command debug log"
        echo "### claude-commands-debug.log"
        echo "**Size:** $(du -h "$CMD_LOG" | cut -f1) | **Modified:** $(stat -f '%Sm' -t '%H:%M:%S' "$CMD_LOG")"
        echo "\`\`\`"
        tail -$CMD_LOG_LINES "$CMD_LOG"
        echo "\`\`\`"
    fi
    echo ""

    # Bridge debug log
    BRIDGE_LOG="$MACOS_TEMP/claude-bridge-debug.log"
    if [[ -f "$BRIDGE_LOG" ]]; then
        log_info "Found bridge debug log"
        echo "### claude-bridge-debug.log"
        echo "**Size:** $(du -h "$BRIDGE_LOG" | cut -f1) | **Modified:** $(stat -f '%Sm' -t '%H:%M:%S' "$BRIDGE_LOG")"
        echo "\`\`\`"
        tail -$BRIDGE_LOG_LINES "$BRIDGE_LOG"
        echo "\`\`\`"
    fi
    echo ""

    # Section 3: IPC State (critical for hang diagnosis)
    echo "## 3. IPC State"
    echo ""
    IPC_DIR="$APP_SUPPORT_DIR/ipc"
    if [[ -d "$IPC_DIR" ]]; then
        PENDING=$(find "$IPC_DIR" -name "permission-request-*.json" 2>/dev/null | wc -l | tr -d ' ')
        RESPONSES=$(find "$IPC_DIR" -name "permission-response-*.json" 2>/dev/null | wc -l | tr -d ' ')
        echo "**Pending requests:** $PENDING | **Response files:** $RESPONSES"
        if [[ "$PENDING" -gt 0 ]]; then
            echo ""
            echo "### Pending Permission Requests (may indicate hang)"
            for f in $(find "$IPC_DIR" -name "permission-request-*.json" 2>/dev/null | head -3); do
                echo "\`\`\`json"
                cat "$f" 2>/dev/null | head -20
                echo "\`\`\`"
            done
        fi
    else
        echo "IPC directory not found"
    fi
    echo ""

    # Section 4: Recent Session (brief)
    echo "## 4. Recent Session Activity"
    echo ""
    if [[ -d "$CLAUDE_PROJECTS_DIR" ]]; then
        RECENT=$(find "$CLAUDE_PROJECTS_DIR" -name "*.jsonl" -type f -mmin -30 2>/dev/null | xargs ls -t 2>/dev/null | head -1)
        if [[ -n "$RECENT" && -f "$RECENT" ]]; then
            echo "**Most recent:** \`$(basename "$RECENT")\` (last $SESSION_LINES lines)"
            echo "\`\`\`json"
            tail -$SESSION_LINES "$RECENT"
            echo "\`\`\`"
        else
            echo "No recent session activity (last 30 min)"
        fi
    fi
    echo ""

    # Section 5: Quick diagnostics
    echo "## 5. Quick Checks"
    echo ""
    echo "| Check | Status |"
    echo "|-------|--------|"
    CLAUDIA_PID=$(pgrep -f "Claudia.app/Contents/MacOS/Claudia" | head -1)
    if [[ -n "$CLAUDIA_PID" ]]; then
        echo "| Claudia running | ✅ PID $CLAUDIA_PID |"
        OPEN_FILES=$(lsof -p "$CLAUDIA_PID" 2>/dev/null | wc -l | tr -d ' ')
        echo "| Open files | $OPEN_FILES |"
        PIPES=$(lsof -p "$CLAUDIA_PID" 2>/dev/null | grep -c "PIPE" || echo "0")
        echo "| Open pipes | $PIPES |"
    else
        echo "| Claudia running | ❌ Not running |"
    fi
    DEBUG_SET=$(ps eww -p "$CLAUDIA_PID" 2>/dev/null | grep -o "CLAUDIA_DEBUG=1" || echo "")
    [[ -n "$DEBUG_SET" ]] && echo "| Debug enabled | ✅ |" || echo "| Debug enabled | ❌ |"
    echo ""

    echo "---"
    echo "*Analyze the debug logs above for clues about the hang.*"

} > "$OUTPUT_FILE"

log_info "Debug logs collected to: $OUTPUT_FILE"
echo ""
echo "$OUTPUT_FILE"
