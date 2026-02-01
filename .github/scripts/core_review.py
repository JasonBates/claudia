#!/usr/bin/env python3
"""
Focused code review of core app files using LaoZhang API.

This is a scaled-up test that reviews the main application files
(not the full codebase) to validate the API integration.
"""

import os
import sys
import time
from pathlib import Path
from openai import OpenAI
from github import Github
import github

# Configuration
MAX_CONTENT_SIZE = 120_000  # Larger limit for full important files
MODEL = os.getenv("OPENAI_MODEL", "gpt-5.2-codex-medium")
TIMEOUT = 420  # 7 minutes for larger content
MAX_RETRIES = 3

# Full codebase of important files
CORE_PATTERNS = [
    # Frontend - SolidJS/TypeScript
    "src/*.tsx",
    "src/*.ts",
    "src/components/**/*.tsx",
    "src/components/**/*.ts",
    "src/stores/**/*.ts",
    "src/hooks/**/*.ts",
    "src/utils/**/*.ts",
    "src/types/**/*.ts",
    # Backend - Rust/Tauri
    "src-tauri/src/**/*.rs",
    # Bridge - Node.js
    "src-tauri/*.mjs",
    "src-tauri/*.js",
]

# Files to skip even if they match patterns
SKIP_FILES = {
    "vite-env.d.ts",
    "auto-imports.d.ts",
    "components.d.ts",
}

# Explicitly exclude
EXCLUDE_PATTERNS = {
    "node_modules", "target", "dist", "build", ".git",
    "__pycache__", ".venv", "venv", ".next", ".turbo",
}

REVIEW_PROMPT = """You are an expert code reviewer performing a comprehensive audit of Claudia.

Claudia is a native macOS desktop wrapper around Claude Code CLI:
- **Frontend**: SolidJS + TypeScript + Vite (src/)
- **Backend**: Rust/Tauri (src-tauri/src/)
- **Bridge**: Node.js SDK bridge (src-tauri/*.mjs)

Perform a thorough review covering:

## 1. Architecture Assessment
- Overall structure and separation of concerns
- State management and data flow
- Frontend-backend IPC patterns
- Process lifecycle management

## 2. Security Audit
- Command injection vulnerabilities
- Path traversal risks
- IPC/Tauri command security
- Credential and token handling
- Input validation

## 3. Code Quality
- Type safety issues
- Error handling gaps
- Potential runtime bugs
- Memory/resource leaks
- Race conditions

## 4. Performance Concerns
- Blocking operations
- Unnecessary re-renders
- Resource usage

## 5. Top 5 Recommendations
Prioritized, actionable improvements with file references.

Be thorough and cite specific files. This is a desktop app handling sensitive CLI interactions.

---

**Application Files:**

{content}
"""


def should_include_path(path: Path) -> bool:
    """Check if path should be included."""
    parts = set(path.parts)
    return not bool(parts & EXCLUDE_PATTERNS)


def gather_core_files(root: Path) -> list[tuple[str, str]]:
    """Gather core application files."""
    files = []
    seen = set()  # Avoid duplicates from overlapping patterns

    for pattern in CORE_PATTERNS:
        for file_path in root.glob(pattern):
            if file_path.is_file() and should_include_path(file_path):
                if file_path.name in SKIP_FILES:
                    continue
                rel_path = str(file_path.relative_to(root))
                if rel_path in seen:
                    continue
                seen.add(rel_path)
                try:
                    content = file_path.read_text(encoding="utf-8")
                    files.append((rel_path, content))
                except (UnicodeDecodeError, PermissionError):
                    continue

    return files


def format_files(files: list[tuple[str, str]], max_size: int) -> str:
    """Format files into a single string."""
    parts = []
    current_size = 0

    files.sort(key=lambda x: x[0])

    for path, content in files:
        # Use language hints for syntax highlighting
        ext = Path(path).suffix
        lang = {"ts": "typescript", "tsx": "tsx", "rs": "rust"}.get(ext.lstrip("."), "")

        file_block = f"### {path}\n```{lang}\n{content}\n```\n\n"
        block_size = len(file_block)

        if current_size + block_size > max_size:
            remaining = len(files) - len(parts)
            parts.append(f"\n... (truncated: {remaining} more files)")
            break

        parts.append(file_block)
        current_size += block_size

    return "".join(parts)


def review_code(client: OpenAI, content: str) -> str:
    """Send code for review with retry logic."""
    prompt = REVIEW_PROMPT.format(content=content)

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"  Attempt {attempt}/{MAX_RETRIES}...")
            start = time.time()

            response = client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=8000,
                temperature=0.3,
            )

            elapsed = time.time() - start
            print(f"  ✓ Success in {elapsed:.1f}s")

            usage = response.usage
            print(f"  Tokens: {usage.prompt_tokens} in / {usage.completion_tokens} out")

            return response.choices[0].message.content

        except Exception as e:
            elapsed = time.time() - start if 'start' in locals() else 0
            print(f"  ✗ Failed after {elapsed:.1f}s: {type(e).__name__}: {e}")

            if attempt < MAX_RETRIES:
                wait_time = 2 ** attempt
                print(f"  Retrying in {wait_time}s...")
                time.sleep(wait_time)
            else:
                raise


def create_issue(gh: Github, repo_name: str, review_text: str, file_count: int, char_count: int):
    """Create a GitHub issue with the review."""
    repo = gh.get_repo(repo_name)

    title = "🔍 Full Codebase Review"
    body = f"""## Comprehensive Application Review

**Scope:** {file_count} files ({char_count:,} characters)
**Model:** {MODEL}

---

{review_text}

---
*Automated review powered by LaoZhang API ({MODEL})*
"""

    issue = repo.create_issue(title=title, body=body, labels=["review"])
    return issue


def main():
    required_vars = ["GITHUB_TOKEN", "OPENAI_API_KEY", "GITHUB_REPOSITORY"]
    missing = [v for v in required_vars if not os.getenv(v)]
    if missing:
        print(f"Error: Missing environment variables: {', '.join(missing)}")
        sys.exit(1)

    gh = Github(auth=github.Auth.Token(os.environ["GITHUB_TOKEN"]))
    openai_client = OpenAI(
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=os.getenv("OPENAI_BASE_URL", "https://api.laozhang.ai/v1"),
        timeout=TIMEOUT,
    )

    repo_name = os.environ["GITHUB_REPOSITORY"]
    print(f"Core files review for {repo_name}")
    print(f"Model: {MODEL}")
    print()

    # Gather files
    root = Path(".")
    files = gather_core_files(root)
    print(f"Found {len(files)} core files:")
    for path, _ in files:
        print(f"  - {path}")
    print()

    if not files:
        print("No core files found.")
        return

    # Format
    content = format_files(files, MAX_CONTENT_SIZE)
    print(f"Total content: {len(content):,} characters (~{len(content)//4:,} tokens)")
    print()

    # Review
    print(f"Sending to LaoZhang ({MODEL})...")
    review = review_code(openai_client, content)

    # Create issue
    print()
    print("Creating issue...")
    issue = create_issue(gh, repo_name, review, len(files), len(content))

    print(f"✓ Done! Issue: {issue.html_url}")


if __name__ == "__main__":
    main()
