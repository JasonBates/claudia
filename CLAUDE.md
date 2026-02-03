# Claudia - Project Instructions

## Tech Stack
- **Frontend:** SolidJS + TypeScript (strict mode)
- **Desktop:** Tauri v2 (Rust backend in `src-tauri/`)
- **SDK:** @anthropic-ai/claude-agent-sdk

## Build Commands
- `./scripts/run.sh --dev` - Start dev server (auto-finds available port)
- `./scripts/run.sh --build` - Build production app
- `./scripts/run.sh --install` - Build and install to /Applications
- `npm run test` - Run JS tests (Vitest)
- `npm run test:rust` - Run Rust tests
- `npm run test:all` - Run all tests

## Debug Mode (Extensive Logging)
Enable with `CLAUDIA_DEBUG=1` environment variable.

**Quick start:**
```bash
./scripts/run-claudia-debug.sh
```

**Log locations (when debug enabled):**
- `/tmp/claude-rust-debug.log` - Rust/Tauri logs
- `/tmp/claude-bridge-debug.log` - SDK bridge logs
- `/tmp/claude-commands-debug.log` - Command execution logs

**Troubleshooting workflow:**
1. Launch with debug: `./scripts/run-claudia-debug.sh`
2. Reproduce the issue
3. Run `./scripts/bugtime.sh` - collects logs and copies analysis prompt to clipboard
4. Paste into a new conversation for analysis

**Manual log collection:**
```bash
./scripts/collect-debug-logs.sh [output_file]
```

## Project Structure
- `src/` - SolidJS frontend
- `src-tauri/` - Rust backend
- `sdk-bridge-v2.mjs` - Claude SDK bridge (handles CLAUDIA_DEBUG)
- `scripts/` - Build and debug scripts

## Releasing
See [RELEASING.md](RELEASING.md) for instructions on creating new releases.
Releases are triggered by pushing version tags (e.g., `v0.2.0`) to GitHub.

## Worktree Setup
Uses shared Cargo target: `~/.cargo/target/claude-terminal`

## Launch Directory
Claudia uses a "launch directory" to find configuration files (`.claudia/config.json`), API keys (`.env`), and other per-project settings.

**Resolution order (production):**
1. `--directory` CLI argument
2. `CLAUDIA_LAUNCH_DIR` environment variable
3. User's home directory (`~`)
4. Current working directory (last resort)

**In dev mode**, the dev launcher sets `CLAUDIA_LAUNCH_DIR` to the current working directory by default (so you test from where you run). Override it to use a different directory:
```bash
# Default: uses current working directory
./scripts/run.sh --dev

# Test with a specific directory's hooks/config:
CLAUDIA_LAUNCH_DIR=~/Obsidian/VAULTS/Trinity/000\ Daily\ Notes ./scripts/run.sh --dev

# Or export it:
export CLAUDIA_LAUNCH_DIR="/path/to/test/directory"
./scripts/run.sh --dev
```

**When to override:**
- Testing `.env` API keys in a specific project
- Testing `.claudia/config.json` settings
- Testing Claude Code hooks in a specific directory

## Common Mistakes to Avoid
<!-- Add entries here when Claude makes mistakes -->

## Displaying Images
To display an image inline, use the **Read tool** on the image file.

## File Links
MCP servers should output file references as markdown links with full paths:
```markdown
[daily-note.md](/Users/name/Obsidian/vault/daily-note.md)
```
