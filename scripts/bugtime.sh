#!/bin/bash
#
# bugtime - Quick debug log collection for Claudia troubleshooting
#
# Collects logs, copies a ready-to-paste prompt to clipboard, and opens Claudia.
#
# Usage: bugtime
#

set -uo pipefail
trap '' PIPE

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COLLECT_SCRIPT="$SCRIPT_DIR/collect-debug-logs.sh"
OUTPUT_FILE="/tmp/claudia-debug-$(date +%Y%m%d-%H%M%S).md"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}🐛 bugtime - Collecting Claudia debug logs...${NC}"
echo ""

# Run the collection script
if [[ -x "$COLLECT_SCRIPT" ]]; then
    "$COLLECT_SCRIPT" "$OUTPUT_FILE" 2>&1 | grep -v "^\[" || true
else
    echo "Error: collect-debug-logs.sh not found at $COLLECT_SCRIPT"
    exit 1
fi

# Create the prompt with the log content
PROMPT="I'm experiencing an intermittent hang issue with Claudia. Here are the debug logs I collected when the issue occurred. Please analyze them and help identify the root cause.

---

$(cat "$OUTPUT_FILE")
"

# Copy prompt to clipboard
echo "$PROMPT" | pbcopy

echo ""
echo -e "${GREEN}✓ Debug logs collected to: $OUTPUT_FILE${NC}"
echo -e "${GREEN}✓ Analysis prompt copied to clipboard${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Open a new Claudia conversation"
echo "  2. Paste (Cmd+V) to send the logs for analysis"
echo ""

# Ask if user wants to open Claudia
read -p "Open Claudia now? (Y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    # Open Claudia
    if [[ -d "/Applications/Claudia.app" ]]; then
        open -a "Claudia"
    elif [[ -d "$HOME/Applications/Claudia.app" ]]; then
        open -a "$HOME/Applications/Claudia.app"
    else
        echo "Claudia.app not found in Applications"
    fi
fi
