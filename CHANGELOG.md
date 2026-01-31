# Changelog

All notable changes to Claudia will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Native macOS desktop app with Tauri + SolidJS
- Real-time streaming of Claude responses
- Tool visualization with collapsible blocks and syntax highlighting
- Permission system with auto-approve and plan modes
- Context window tracking with cache-aware token counting
- Multi-instance support via CLI launcher
- Session management with sidebar
- Local commands: `/clear`, `/sync`, `/thinking`, `/sidebar`, `/resume`, `/exit`
- Keyboard shortcuts: `Alt+T` (toggle thinking), `Alt+Q` (exit), `Cmd+Shift+[` (sidebar)
- Todo panel for task tracking
- Question panel for `AskUserQuestion` responses
- Planning mode with approval workflow
- Streaming command runner for external tools
- Comprehensive test suite (608 tests: 495 TypeScript + 113 Rust)

### Architecture
- SolidJS frontend with custom hooks pattern
- Rust backend with Tauri 2.x
- Node.js bridge translating Claude CLI JSON to app events
- Stream-based permission protocol

### Documentation
- Architecture documentation with data flow diagrams
- Troubleshooting guide with common issues
- Streaming pattern documentation (reusable)

---

## Version History

This project started on 2026-01-24 and is under active development.
