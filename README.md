# Claudia

[![Download for macOS](https://img.shields.io/badge/Download-v0.4.0-black?logo=apple)](https://github.com/JasonBates/claudia/releases/download/v0.4.0/Claudia_0.4.0_universal.dmg)
[![Test](https://github.com/JasonBates/claudia/actions/workflows/test.yml/badge.svg)](https://github.com/JasonBates/claudia/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Claude Code, but pretty

Claude Code is powerful. The terminal is not where you want to live. Claudia wraps the CLI in a native macOS app so you keep everything—MCPs, CLAUDE.md files, hooks, session persistence—and gain a visual interface that doesn't hurt to look at.

> *Why rebuild the agent runtime when you can wrap it?*

<p align="center">
  <a href="https://github.com/JasonBates/claudia/releases/latest/download/Claudia_universal.dmg">
    <img src="https://img.shields.io/badge/⬇_Download_Claudia_for_macOS-black?style=for-the-badge&logo=apple&logoColor=white" alt="Download Claudia" height="80" />
  </a>
</p>
<p align="center"><em>Requires macOS 12+ and <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code CLI</a> installed</em></p>

## Screenshots

<p align="center">
  <img src="docs/images/subagents.png" width="600" alt="Subagent visualization with parallel tasks" />
</p>
<p align="center"><em>Parallel subagents running with real-time status tracking</em></p>

<p align="center">
  <img src="docs/images/plan-mode.png" width="800" alt="Plan mode with task tracking" />
</p>
<p align="center"><em>Plan mode with task panel and detailed plan view</em></p>

<p align="center">
  <img src="docs/images/interactive-question.png" width="500" alt="Interactive question dialog" />
</p>
<p align="center"><em>Interactive questions with multiple choice options</em></p>

## Why Claudia?

Claude Code CLI is powerful but terminal-focused. Claudia gives you:

- **Proportional fonts and styling** — Who wants to stare at monospaced text all day
- **Visual tool tracking** — See what Claude is doing with collapsible, syntax-highlighted tool blocks
- **Real-time streaming** — Text and results appear as they're generated
- **Desktop integration** — Native macOS app, multi-window support, project-aware launching
- **All of Claude Code's power** — MCPs, skills, hooks, CLAUDE.md, session persistence, prompt caching

## Why Claudia instead of Cowork?

Cowork is Anthropic's managed desktop experience—great for users who want zero-config simplicity. Claudia is for developers who already use Claude Code and want more control:

- **Fully customizable** — UI, workflows, features, and memory are yours to modify
- **Per-project configuration** — different context, tools, and MCPs for each project directory
- **Your setup just works** — existing CLAUDE.md files, hooks, and MCP configs carry over
- **Direct file system access** — no sandboxed VM sitting between you and your files
- **Custom visualizations** — build data renderers directly into your MCPs

Cowork wraps a sandboxed environment. Claudia wraps Claude Code itself—so you keep everything you've already built.

## Features

- **Native macOS app** — Built with Tauri + SolidJS for fast, lightweight performance
- **Rich markdown rendering** — Full GitHub-flavored markdown with syntax-highlighted code blocks
- **Inline image display** — Images from Read tool results display inline, click to view full-size
- **Visual tool tracking** — Collapsible, syntax-highlighted tool blocks with JSON formatting
- **Real-time streaming** — Text and results appear as they're generated
- **CLI launcher** — Run `claudia` from any directory to use project-specific configs
- **Multi-instance support** — Multiple windows, each in different project directories
- **Type-ahead input** — Keep typing while waiting for responses
- **Smart permissions** — Auto-approve, plan mode, or per-tool dialogs
- **Extended thinking** — Expandable thinking blocks when enabled
- **Subagent visualization** — Track nested Task agents and their progress
- **Session resume** — Continue previous conversations with full context

## Installation

### Download (Recommended)

Download the latest release and drag Claudia.app to your Applications folder:

**[⬇ Download Claudia for macOS](https://github.com/JasonBates/claudia/releases/latest/download/Claudia_universal.dmg)**

Requires macOS 12+ and [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed.

### Build from Source

If you prefer to build from source, you'll need:

- Node.js 18+
- Rust toolchain
- Claude Code CLI (`claude` command available)

```bash
git clone https://github.com/JasonBates/claudia.git
cd claudia
npm install
npm run tauri build
cp -R src-tauri/target/release/bundle/macos/Claudia.app /Applications/
```

### CLI Launcher

Install the `claudia` CLI launcher to open the app from any directory:

```bash
./install.sh
```

Or manually:

```bash
cp claudia ~/.local/bin/
chmod +x ~/.local/bin/claudia
```

Then from any project directory:

```bash
cd ~/Code/repos/my-project
claudia
```

This opens Claudia with that directory as the working directory, picking up project-specific `.claude/` configs.

## Usage

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Escape** | Interrupt current response |
| **⌘ ,** | Open settings |
| **⌘ ⇧ [** | Toggle session sidebar |
| **⌥ T** | Toggle thinking display |
| **⌥ L** | Focus message input |
| **⌥ Q** | Quit application |

### Commands

| Command | Description |
|---------|-------------|
| `/clear` | Clear conversation history (restarts Claude process) |
| `/resume` | Open sidebar to resume a previous session |
| `/settings` | Open appearance settings |
| `/thinking` | Toggle extended thinking display |
| `/sidebar` | Toggle session sidebar |
| `/exit` `/quit` `/q` `/x` | Close the application |
| `! <command>` | Execute bash command directly (e.g., `! ls -la`, `! git status`) |

### Resuming Sessions

1. **Via sidebar**: Press `⌘ ⇧ [` or type `/resume` to open the session sidebar
2. **Via CLI**: Launch with `claudia --resume <session-id>`
3. **Browse history**: The sidebar shows recent sessions with timestamps and previews

### Custom Color Schemes

Claudia includes 6 bundled color schemes (Solarized Dark/Light, Dracula, Nord, One Dark, Gruvbox Dark). You can add more by installing iTerm2 color scheme files.

**To install new color schemes:**

1. Create the colors directory if it doesn't exist:
   ```bash
   mkdir -p ~/.config/iterm2/colors
   ```

2. Copy `.itermcolors` files into the directory:
   ```bash
   cp "My Theme.itermcolors" ~/.config/iterm2/colors/
   ```

3. Open Settings (`⌘ ,`) — your new schemes appear under "From iTerm2"

**Where to find color schemes:**

- [iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes) — 250+ schemes in the `schemes/` directory
- Any `.itermcolors` file from the web will work

Note: iTerm2 does not need to be installed. Claudia reads the `.itermcolors` plist format directly.

### Advanced Runtime Config

You can override model and runtime binaries in `~/.config/claudia/config.json` (or per-project at `.claudia/config.json`):

```json
{
  "claude_model": "opus",
  "claude_binary_path": "/opt/homebrew/bin/claude",
  "node_binary_path": "/opt/homebrew/bin/node",
  "legacy_permission_hook_polling": false
}
```

- `claude_model`: Passed to Claude CLI as `--model`
- `claude_binary_path`: Optional explicit path to Claude CLI
- `node_binary_path`: Optional explicit Node path used to launch the bridge
- `legacy_permission_hook_polling`: Enables legacy file-based permission flow (off by default)

## Architecture

Claudia wraps the Claude Code CLI to leverage its built-in features (MCPs, skills, hooks, session management, prompt caching) while providing a custom native UI.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Claudia.app (Tauri)                        │
│              Custom UI + Desktop Integration                    │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (SolidJS)          │  Backend (Rust)                  │
│  └─ Reactive UI components   │  └─ Process management, IPC      │
├─────────────────────────────────────────────────────────────────┤
│                     sdk-bridge-v2.mjs (Node.js)                 │
│                     └─ Thin event translation layer             │
├─────────────────────────────────────────────────────────────────┤
│                     Claude Code CLI                             │
│         └─ Full agent runtime: MCPs, skills, hooks,             │
│            sessions, compaction, prompt caching                 │
└─────────────────────────────────────────────────────────────────┘
```

For detailed architecture, data flow, event types, and implementation details, see [docs/architecture.md](docs/architecture.md).

## Development

```bash
# Development mode
npm run tauri dev

# Run all tests (608 tests: 113 Rust + 495 TypeScript)
npm run test:all

# TypeScript tests only
npm run test:run

# Rust tests only
npm run test:rust
```

## Documentation

| Document | Description |
|----------|-------------|
| **[docs/architecture.md](docs/architecture.md)** | Data flow, event types, state management, testing, design decisions |
| **[docs/streaming.md](docs/streaming.md)** | Streaming command runner pattern |
| **[docs/troubleshooting.md](docs/troubleshooting.md)** | Common issues, debugging techniques, lessons learned |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | How to contribute to Claudia |
| **[CHANGELOG.md](CHANGELOG.md)** | Version history and release notes |

## License

MIT
