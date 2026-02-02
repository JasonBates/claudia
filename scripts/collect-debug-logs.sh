#!/bin/bash
#
# Claudia Debug Log Collector
#
# Collects relevant logs and state for troubleshooting hang issues.
# Output is formatted for LLM analysis.
#
# Usage: ./scripts/collect-debug-logs.sh [session_id]
#
# If session_id is provided, includes that session's conversation history.

set -uo pipefail
# Don't exit on SIGPIPE (exit code 141) which can happen with head/tail in pipes
trap '' PIPE

# Configuration
APP_SUPPORT_DIR="$HOME/Library/Application Support/com.jasonbates.claudia"
CLAUDE_PROJECTS_DIR="$HOME/.claude/projects"
CONFIG_DIR="$HOME/.config/claudia"
OUTPUT_FILE="${1:-/tmp/claudia-debug-$(date +%Y%m%d-%H%M%S).md}"
SESSION_ID="${2:-}"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Start building the output
{
    echo "# Claudia Debug Log Collection"
    echo ""
    echo "**Collected:** $(date '+%Y-%m-%d %H:%M:%S')"
    echo "**Machine:** $(hostname)"
    echo "**macOS:** $(sw_vers -productVersion)"
    echo ""

    # Section: Process Status
    echo "## 1. Claudia Process Status"
    echo ""
    echo "\`\`\`"
    if pgrep -f "Claudia" > /dev/null 2>&1; then
        echo "Claudia processes running:"
        ps aux | grep -i "[C]laudia" | head -20
        echo ""
        echo "Process tree:"
        pgrep -f "Claudia" | while read pid; do
            ps -o pid,ppid,state,%cpu,%mem,etime,command -p "$pid" 2>/dev/null || true
        done
    else
        echo "No Claudia processes found running."
    fi
    echo "\`\`\`"
    echo ""

    # Check for Claude CLI processes too
    echo "### Claude CLI Processes"
    echo ""
    echo "\`\`\`"
    if pgrep -f "claude" > /dev/null 2>&1; then
        ps aux | grep -E "[c]laude" | grep -v "collect-debug" | head -20 || echo "None found"
    else
        echo "No claude CLI processes found."
    fi
    echo "\`\`\`"
    echo ""

    # Section: Debug Logs
    echo "## 2. Backend Debug Logs"
    echo ""

    # macOS temp dir is in /var/folders, not /tmp
    MACOS_TEMP="${TMPDIR:-$(dirname $(mktemp -u))}"

    # Rust debug log
    RUST_DEBUG_LOG="$MACOS_TEMP/claude-rust-debug.log"
    if [[ -f "$RUST_DEBUG_LOG" ]]; then
        log_info "Found Rust debug log"
        echo "### claude-rust-debug.log (last 200 lines)"
        echo ""
        echo "**File:** \`$RUST_DEBUG_LOG\`"
        echo "**Size:** $(du -h "$RUST_DEBUG_LOG" | cut -f1)"
        echo "**Modified:** $(stat -f '%Sm' "$RUST_DEBUG_LOG")"
        echo ""
        echo "\`\`\`"
        tail -200 "$RUST_DEBUG_LOG"
        echo "\`\`\`"
    else
        log_warn "No Rust debug log found. Run Claudia with CLAUDIA_DEBUG=1 to enable."
        echo "**No debug log found at:** \`$RUST_DEBUG_LOG\`"
        echo ""
        echo "> To enable debug logging, run Claudia with:"
        echo "> \`\`\`"
        echo "> CLAUDIA_DEBUG=1 /Applications/Claudia.app/Contents/MacOS/Claudia"
        echo "> \`\`\`"
    fi
    echo ""

    # Command debug log
    CMD_DEBUG_LOG="$MACOS_TEMP/claude-commands-debug.log"
    if [[ -f "$CMD_DEBUG_LOG" ]]; then
        log_info "Found command debug log"
        echo "### claude-commands-debug.log (last 100 lines)"
        echo ""
        echo "**File:** \`$CMD_DEBUG_LOG\`"
        echo "**Size:** $(du -h "$CMD_DEBUG_LOG" | cut -f1)"
        echo "**Modified:** $(stat -f '%Sm' "$CMD_DEBUG_LOG")"
        echo ""
        echo "\`\`\`"
        tail -100 "$CMD_DEBUG_LOG"
        echo "\`\`\`"
    else
        echo "### claude-commands-debug.log"
        echo ""
        echo "**Not found.** This log is created when CLAUDIA_DEBUG=1 is set."
    fi
    echo ""

    # Bridge debug log
    BRIDGE_DEBUG_LOG="$MACOS_TEMP/claude-bridge-debug.log"
    if [[ -f "$BRIDGE_DEBUG_LOG" ]]; then
        log_info "Found bridge debug log"
        echo "### claude-bridge-debug.log (last 100 lines)"
        echo ""
        echo "**File:** \`$BRIDGE_DEBUG_LOG\`"
        echo "**Size:** $(du -h "$BRIDGE_DEBUG_LOG" | cut -f1)"
        echo "**Modified:** $(stat -f '%Sm' "$BRIDGE_DEBUG_LOG")"
        echo ""
        echo "\`\`\`"
        tail -100 "$BRIDGE_DEBUG_LOG"
        echo "\`\`\`"
    fi
    echo ""

    # Section: IPC State
    echo "## 3. IPC State (Permission Requests)"
    echo ""

    IPC_DIR="$APP_SUPPORT_DIR/ipc"
    if [[ -d "$IPC_DIR" ]]; then
        echo "**IPC Directory:** \`$IPC_DIR\`"
        echo ""

        # List pending permission requests
        REQUEST_FILES=$(find "$IPC_DIR" -name "permission-request-*.json" 2>/dev/null | head -10)
        if [[ -n "$REQUEST_FILES" ]]; then
            log_info "Found pending permission requests"
            echo "### Pending Permission Requests"
            echo ""
            echo "These files indicate permission prompts that may not have been responded to:"
            echo ""
            for f in $REQUEST_FILES; do
                echo "**File:** \`$(basename "$f")\`"
                echo "\`\`\`json"
                cat "$f" 2>/dev/null || echo "(unreadable)"
                echo "\`\`\`"
                echo ""
            done
        else
            echo "No pending permission requests found."
        fi

        # Check for orphaned response files
        RESPONSE_FILES=$(find "$IPC_DIR" -name "permission-response-*.json" 2>/dev/null | head -10)
        if [[ -n "$RESPONSE_FILES" ]]; then
            echo "### Permission Response Files"
            echo ""
            for f in $RESPONSE_FILES; do
                echo "**File:** \`$(basename "$f")\`"
                echo "\`\`\`json"
                cat "$f" 2>/dev/null || echo "(unreadable)"
                echo "\`\`\`"
                echo ""
            done
        fi
    else
        echo "IPC directory not found."
    fi
    echo ""

    # Section: Recent Sessions
    echo "## 4. Recent Session Activity"
    echo ""

    if [[ -d "$CLAUDE_PROJECTS_DIR" ]]; then
        echo "### Most Recently Modified Sessions"
        echo ""
        echo "\`\`\`"
        find "$CLAUDE_PROJECTS_DIR" -name "*.jsonl" -type f -mmin -60 2>/dev/null | \
            xargs ls -lt 2>/dev/null | head -10 || echo "No recent sessions found"
        echo "\`\`\`"
        echo ""

        # If session ID provided, get that session's log
        if [[ -n "$SESSION_ID" ]]; then
            echo "### Requested Session: $SESSION_ID"
            echo ""
            SESSION_FILE=$(find "$CLAUDE_PROJECTS_DIR" -name "${SESSION_ID}.jsonl" 2>/dev/null | head -1)
            if [[ -n "$SESSION_FILE" && -f "$SESSION_FILE" ]]; then
                echo "**File:** \`$SESSION_FILE\`"
                echo ""
                echo "Last 50 messages:"
                echo "\`\`\`json"
                tail -50 "$SESSION_FILE"
                echo "\`\`\`"
            else
                echo "Session file not found for ID: $SESSION_ID"
            fi
        else
            # Show the most recent session
            RECENT_SESSION=$(find "$CLAUDE_PROJECTS_DIR" -name "*.jsonl" -type f -mmin -60 2>/dev/null | \
                xargs ls -t 2>/dev/null | head -1)
            if [[ -n "$RECENT_SESSION" && -f "$RECENT_SESSION" ]]; then
                echo "### Most Recent Session (last 30 lines)"
                echo ""
                echo "**File:** \`$RECENT_SESSION\`"
                echo ""
                echo "\`\`\`json"
                tail -30 "$RECENT_SESSION"
                echo "\`\`\`"
            fi
        fi
    else
        echo "Claude projects directory not found."
    fi
    echo ""

    # Section: System Resources
    echo "## 5. System Resources"
    echo ""
    echo "### Memory Usage"
    echo ""
    echo "\`\`\`"
    vm_stat | head -15
    echo ""
    echo "Top memory consumers:"
    ps aux -m | head -6
    echo "\`\`\`"
    echo ""

    echo "### Open File Handles (Claudia)"
    echo ""
    echo "\`\`\`"
    CLAUDIA_PID=$(pgrep -f "Claudia.app" | head -1)
    if [[ -n "$CLAUDIA_PID" ]]; then
        lsof -p "$CLAUDIA_PID" 2>/dev/null | wc -l | xargs echo "Total open files:"
        lsof -p "$CLAUDIA_PID" 2>/dev/null | grep -E "(PIPE|socket|FIFO)" | head -20 || echo "No pipes/sockets found"
    else
        echo "Claudia not running"
    fi
    echo "\`\`\`"
    echo ""

    # Section: Configuration
    echo "## 6. Configuration"
    echo ""

    GLOBAL_CONFIG="$CONFIG_DIR/config.json"
    if [[ -f "$GLOBAL_CONFIG" ]]; then
        echo "### Global Config"
        echo ""
        echo "\`\`\`json"
        cat "$GLOBAL_CONFIG"
        echo "\`\`\`"
    else
        echo "No global config found at \`$GLOBAL_CONFIG\`"
    fi
    echo ""

    # Section: Environment
    echo "## 7. Relevant Environment Variables"
    echo ""
    echo "\`\`\`"
    echo "CLAUDIA_DEBUG=${CLAUDIA_DEBUG:-not set}"
    echo "CLAUDE_CODE_ENTRYPOINT=${CLAUDE_CODE_ENTRYPOINT:-not set}"
    echo "PATH entries with node/claude:"
    echo "$PATH" | tr ':' '\n' | grep -iE "(node|claude|npm)" || echo "  (none)"
    echo ""
    echo "Node.js version:"
    which node 2>/dev/null && node --version 2>/dev/null || echo "  node not found in PATH"
    echo ""
    echo "Claude CLI:"
    which claude 2>/dev/null || echo "  claude not found in PATH"
    echo "\`\`\`"
    echo ""

    # Section: Diagnosis Hints
    echo "## 8. Quick Diagnosis Checklist"
    echo ""
    echo "- [ ] **Debug logs present?** Check if CLAUDIA_DEBUG=1 was set"
    echo "- [ ] **Pending permission requests?** May indicate UI not showing prompts"
    echo "- [ ] **Process state?** Look for stuck/zombie processes"
    echo "- [ ] **Recent session activity?** Check if messages are being written"
    echo "- [ ] **High resource usage?** Memory or file handle leaks"
    echo "- [ ] **IPC files orphaned?** Stale request/response files"
    echo ""

    echo "---"
    echo ""
    echo "*End of debug collection*"

} > "$OUTPUT_FILE"

log_info "Debug logs collected to: $OUTPUT_FILE"
echo ""
echo "To analyze with an LLM, you can:"
echo "  1. Copy the contents: cat $OUTPUT_FILE | pbcopy"
echo "  2. Or share the file path with Claude"
echo ""

# Also output the file path for easy access
echo "$OUTPUT_FILE"
