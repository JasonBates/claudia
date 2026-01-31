# Contributing to Claudia

Thanks for your interest in contributing to Claudia!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/claudia.git`
3. Install dependencies: `npm install`
4. Run in development mode: `npm run tauri dev`

## Development

### Prerequisites

- Node.js 18+
- Rust toolchain (install via [rustup](https://rustup.rs))
- Claude Code CLI (`claude` command available)

### Running Tests

```bash
# All tests (608 total: 495 TypeScript + 113 Rust)
npm run test:all

# TypeScript tests only
npm run test:run

# Rust tests only
npm run test:rust

# Watch mode for TypeScript
npm run test
```

### Code Style

- TypeScript: Run `npx tsc --noEmit` to check types
- Rust: Run `cargo fmt` and `cargo clippy` before committing
- Keep commits focused and atomic

## Pull Requests

1. Create a feature branch from `main`
2. Make your changes
3. Ensure all tests pass: `npm run test:all`
4. Submit a PR with a clear description of the changes

## Architecture

See [docs/architecture.md](docs/architecture.md) for details on the codebase structure, data flow, and design decisions.

## Questions?

Open an issue for bugs, feature requests, or questions.
