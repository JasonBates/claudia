# Claudia E2E Test Plan

## About Claudia

Claudia is a native macOS desktop app that wraps the Claude Code CLI in a visual
interface. It provides streaming responses, tool tracking, permission dialogs,
session management, and theming — while preserving all of Claude Code's power.

## Setup — READ THIS FIRST

### Prerequisites

The E2E testing stack uses `tauri-webdriver` (Choochmeque) — NOT `tauri-driver` (which is Linux-only).

**Architecture:**
```
MCP tools (launch_app, click_element, etc.)
  → W3C WebDriver HTTP on port 4444
    → tauri-webdriver CLI (proxies to the app's embedded plugin)
      → Claudia DEBUG binary (has tauri-plugin-webdriver embedded)
        → Real Claude API calls
```

### Required: tauri-webdriver server running on port 4444

Before using any MCP tools, `tauri-webdriver` must be running:
```bash
# Check if it's already running:
pgrep -f "tauri-webdriver" && echo "Running" || echo "Not running"

# If not running, start it:
cd /Users/jasonbates/conductor/workspaces/claudia/davis
./scripts/run-e2e.sh
# This builds the debug binary and starts tauri-webdriver on port 4444
```

### IMPORTANT: Use the DEBUG binary, not the release binary

- **CORRECT**: `/Users/jasonbates/conductor/workspaces/claudia/davis/src-tauri/target/debug/claudia`
- **WRONG**: `/Applications/Claudia.app/Contents/MacOS/claudia` (release build, no WebDriver plugin)

The debug binary has `tauri-plugin-webdriver` embedded. The release binary does NOT.
The MCP server's `TAURI_APP_PATH` env var should already point to the debug binary.

### IMPORTANT: Do NOT install `tauri-driver`

`tauri-driver` (Tauri team's official crate) is Linux-only and does NOT work on macOS.
The correct tool is `tauri-webdriver` (Choochmeque's crate), already installed at `~/.cargo/bin/tauri-webdriver`.

### Note: Project picker on first launch

When launched without `--directory`, Claudia shows a project picker modal. Click "Skip" to bypass
it and stay in the default directory. Do NOT click a project name — that triggers `reopenInDirectory`
which kills the process and breaks the WebDriver session.

### Sending messages (Enter key)

The `type_text` MCP tool types characters but does NOT submit. After typing into `.command-input`,
you must dispatch an Enter keydown event via `execute_script` to send the message:
```javascript
const input = document.querySelector('.command-input');
const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
input.dispatchEvent(event);
```

## Before Testing

Read these files to understand the app's features and expected behavior:
- `src/App.tsx` — main component, all features orchestrated here
- `src/components/CommandInput.tsx` — message input behavior
- `src/components/MessageList.tsx` — how messages render
- `src/components/PermissionDialog.tsx` — permission handling
- `README.md` — feature overview

## Critical Path Scenarios

Test these in order. Each must work correctly.

### 1. App Startup
- Launch the app and wait for the window to appear
- **Project picker modal appears first** — click "Skip" (by text) to dismiss it
- After dismissal, verify:
  - App window has dark background
  - Message input area (`.command-input`) is visible with "Type a message..." placeholder
  - Working directory indicator (`.dir-indicator`) shows in the header (e.g. "jasonbates")
  - Mode indicator (`.mode-indicator`) visible near input, showing current mode (e.g. "»VIBE")
  - No error messages or blank screens
  - No JS console errors: `return JSON.stringify(window.__errors || [])`

### 2. Send a Message
- Click `.command-input`, then `type_text` "What is 2+2?"
- Dispatch Enter key via `execute_script` (see "Sending messages" above)
- User message appears in `.message-list` under a "YOU" label
- Response streams in under a "CLAUDE" label
- Final response contains "4"
- Token count appears in `.token-indicator` in the header (e.g. "◈31k")

### 3. Interrupt Streaming
- Type and send a longer prompt: "Write a 500 word essay about the ocean"
- Use `wait_for_element` with selector `.streaming-content` to confirm streaming started
- **Immediately** dispatch Escape key (do NOT use a fixed sleep — the model streams fast):
  ```javascript
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  ```
- Verify: `.streaming-content` is gone, `.command-input` is not disabled, placeholder is "Type a message..."
- **Tip**: If the model completes before Escape fires, the test is still valid as long as the input
  is re-enabled and no errors occurred. For a more reliable interrupt test, use a prompt that
  triggers multi-step tool use (which is inherently slower than pure text generation).

### 4. Permission Dialog
- **To see the permission dialog UI, first switch out of VIBE mode** by clicking `.mode-indicator`
  once (switches to "ask" / request mode — class becomes `mode-request`)
- Then send: "What files are in the current directory?"
- Wait for `.permission-container` to appear
- Verify:
  - Dialog shows tool name and description
  - `.permission-allow-btn` ("Allow") and deny button are visible
  - Click `.permission-allow-btn`
  - Tool result appears in the conversation
- **Note**: If the mode is VIBE (auto), tools execute automatically with no dialog. The test plan
  should explicitly set the mode to "ask" before this test to guarantee the dialog appears.

### 5. Mode Switching
- Click the `.mode-indicator` button (left side of the input area)
- Mode cycles through **4 modes** (not 3):

| Click | CSS Class | Display Text | Description |
|-------|-----------|-------------|-------------|
| — | `mode-auto` | `»VIBE` | Auto-approve all tool calls |
| 1st | `mode-request` | `?ask` | Ask permission for each tool |
| 2nd | `mode-plan` | `◇Plan` | Plan mode |
| 3rd | `mode-bot` | `🤖BotGuard` | Bot guard mode |
| 4th | `mode-auto` | `»VIBE` | Wraps back to auto |

- Verify: both CSS class and text content update on each click
- After testing, click back to VIBE mode for subsequent tests (or set to "ask" for Test 4)

### 6. Sidebar & Sessions
- **There is no visible sidebar toggle button.** Open the sidebar with `Cmd+Shift+[`:
  ```javascript
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: '[', code: 'BracketLeft', keyCode: 219,
    metaKey: true, shiftKey: true, bubbles: true
  }));
  ```
- Verify `.sidebar` loses the `collapsed` class and has `width > 0` (default: 280px)
- Sidebar has a "Sessions" header (`.sidebar-header`)
- Session list is populated (`.session-item` elements)
- Current session has the `active` class
- A "+New Session" button (`.new-session-button`) is visible
- Close the sidebar by clicking `.sidebar-close-button` (the `×`)
- Verify `.sidebar` has `collapsed` class and `width: 0px`

### 7. Settings
- Open settings by clicking `.top-bar-btn[title="Settings (Cmd+,)"]` (the ⚙ button)
- Settings modal appears with:
  - Version display (e.g. "Claudia 0.5.8")
  - "Check for Updates" button
  - Context Window slider
  - Font Family dropdown
  - Font Size control
  - Color Scheme grid (`.color-scheme-grid`) with 6 themes:
    Solarized Dark, Solarized Light, Dracula, Nord, One Dark, Gruvbox Dark
  - Currently selected theme has `.color-scheme-option.selected` class
- Change color scheme: click a different `.color-scheme-option` (e.g. click "Dracula" by text)
- Verify: `.color-scheme-option.selected` text changes AND UI colors update immediately
- Close settings: click `.settings-close-btn` (the `×`)

## Exploratory Testing

After critical paths pass, explore freely. Look for:

### Visual Quality
- Text alignment and readability
- Color contrast and consistency
- No overlapping elements
- Proper scrolling in long conversations
- Responsive to window resizing

### Edge Cases
- Submit an empty message (should be ignored or handled gracefully)
- Very long single-line message
- Rapid message submission (send multiple before first completes)
- Window resize during streaming

### Error Handling
- Check browser console for JS errors (use execute_script)
- Look for error states in the UI
- Check debug logs at /tmp/claude-bridge-debug.log

### Interaction During Streaming
- Try clicking buttons while a response is streaming
- Try opening settings during streaming
- Try switching modes during streaming

## Key CSS Selectors

| Element | Selector | Purpose |
|---------|----------|---------|
| Message input | `.command-input` | Type messages |
| Message list | `.message-list` | Read conversation |
| Mode button | `.mode-indicator` | Switch permission modes |
| Mode class (auto) | `.mode-indicator.mode-auto` | Detect VIBE/auto mode |
| Mode class (ask) | `.mode-indicator.mode-request` | Detect ask/request mode |
| Mode class (plan) | `.mode-indicator.mode-plan` | Detect plan mode |
| Mode class (bot) | `.mode-indicator.mode-bot` | Detect BotGuard mode |
| Permission dialog | `.permission-container` | Detect permission requests |
| Permission allow | `.permission-allow-btn` | Approve tool use |
| Settings button | `.top-bar-btn[title="Settings (Cmd+,)"]` | Open settings |
| Settings close | `.settings-close-btn` | Close settings modal |
| Color scheme grid | `.color-scheme-grid` | Theme options container |
| Color scheme item | `.color-scheme-option` | Individual theme button |
| Selected theme | `.color-scheme-option.selected` | Currently active theme |
| Sidebar | `.sidebar` | Session history panel |
| Sidebar (collapsed) | `.sidebar.collapsed` | Sidebar is hidden (width: 0) |
| Sidebar close | `.sidebar-close-button` | Close sidebar |
| Session item | `.session-item` | Individual session in list |
| Active session | `.session-item.active` | Currently loaded session |
| New session | `.new-session-button` | Start new session |
| Token count | `.token-indicator` | Token usage in header |
| Directory | `.dir-indicator` | Working directory in header |
| Connection | `.connection-icon.connected` | Active session indicator |
| Streaming content | `.streaming-content` | Detect active streaming |
| New Window button | `.top-bar-btn[title="New Window (Cmd+N)"]` | Open new window |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message (must dispatch via KeyboardEvent on `.command-input`) |
| `Escape` | Interrupt streaming (dispatch on `document`) |
| `Cmd+Shift+[` | Toggle sidebar |
| `Cmd+,` | Open settings |
| `Cmd+N` | New window |
| `Shift+Tab` | Cycle permission mode (same as clicking `.mode-indicator`) |

## Reporting Issues

For each issue found, capture:
1. Screenshot showing the problem (`capture_screenshot` with `returnBase64: false` for file path)
2. Steps to reproduce
3. Expected vs actual behavior
4. Console errors if any (via `execute_script`: `return JSON.stringify(window.__errors || [])`)
