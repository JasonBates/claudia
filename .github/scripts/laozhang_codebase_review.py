#!/usr/bin/env python3
"""
AI-powered full codebase review using LaoZhang API.

This script:
1. Scans the codebase for source files
2. Sends them to LaoZhang for analysis
3. Creates a GitHub issue with the review
"""

import os
import sys
import time
from pathlib import Path
from openai import OpenAI
from github import Github
import github

# Configuration
MAX_CONTENT_SIZE = 100_000  # Reduced for reliability
MODEL = os.getenv("OPENAI_MODEL", "gpt-5.2-codex-medium")
TIMEOUT = 180  # 3 minute timeout
MAX_RETRIES = 3

# File patterns to include
INCLUDE_PATTERNS = [
    "**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs",
    "**/*.rs",
    "**/*.json",
    "**/*.css", "**/*.scss",
]

# Directories to exclude
EXCLUDE_DIRS = {
    "node_modules", "target", "dist", "build", ".git",
    "__pycache__", ".venv", "venv", ".next", ".turbo",
}

REVIEW_PROMPT = """You are an expert code reviewer performing a full codebase audit for Claudia.

Claudia is a native macOS wrapper around Claude Code CLI, using:
- **Frontend**: SolidJS + TypeScript + Vite
- **Backend**: Rust (Tauri)
- **Bridge**: Node.js SDK bridge (sdk-bridge-v2.mjs)

Perform a comprehensive review covering:

## Architecture Assessment
Evaluate the overall structure, separation of concerns, and design patterns.

## Security Audit
Look for vulnerabilities: command injection, XSS, unsafe IPC, credential handling, etc.

## Code Quality Issues
Identify bugs, logic errors, type safety issues, and potential runtime failures.

## Performance Concerns
Spot inefficiencies, memory leaks, unnecessary re-renders, or blocking operations.

## Technical Debt
Note areas that need refactoring, outdated patterns, or missing error handling.

## Recommendations
Prioritized list of improvements, from critical to nice-to-have.

Be thorough but actionable. Focus on issues that matter for a desktop application handling sensitive CLI interactions.

---

**Codebase:**

{content}
"""


def should_include_path(path: Path) -> bool:
    """Check if path should be included in review."""
    parts = set(path.parts)
    return not bool(parts & EXCLUDE_DIRS)


def gather_source_files(root: Path) -> list[tuple[str, str]]:
    """Gather all source files matching patterns."""
    files = []

    for pattern in INCLUDE_PATTERNS:
        for file_path in root.glob(pattern):
            if file_path.is_file() and should_include_path(file_path):
                try:
                    content = file_path.read_text(encoding="utf-8")
                    rel_path = file_path.relative_to(root)
                    files.append((str(rel_path), content))
                except (UnicodeDecodeError, PermissionError):
                    continue

    return files


def format_codebase(files: list[tuple[str, str]], max_size: int) -> str:
    """Format files into a single string, respecting size limit."""
    parts = []
    current_size = 0

    # Sort by path for consistent ordering
    files.sort(key=lambda x: x[0])

    for path, content in files:
        file_block = f"### {path}\n```\n{content}\n```\n\n"
        block_size = len(file_block)

        if current_size + block_size > max_size:
            parts.append(f"\n... (truncated: {len(files) - len(parts)} more files)")
            break

        parts.append(file_block)
        current_size += block_size

    return "".join(parts)


def review_codebase(client: OpenAI, content: str) -> str:
    """Send the codebase to LaoZhang for review with retry logic."""
    prompt = REVIEW_PROMPT.format(content=content)

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"  Attempt {attempt}/{MAX_RETRIES}...")
            response = client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=4000,
                temperature=0.3,
                timeout=TIMEOUT,
            )
            return response.choices[0].message.content
        except Exception as e:
            print(f"  Attempt {attempt} failed: {type(e).__name__}: {e}")
            if attempt < MAX_RETRIES:
                wait_time = 2 ** attempt  # Exponential backoff: 2, 4, 8 seconds
                print(f"  Retrying in {wait_time}s...")
                time.sleep(wait_time)
            else:
                raise


def create_review_issue(gh: Github, repo_name: str, review_text: str):
    """Create a GitHub issue with the review."""
    repo = gh.get_repo(repo_name)

    title = "🔍 AI Codebase Review"
    body = f"""## Full Codebase Review

{review_text}

---
*Automated review powered by LaoZhang API ({MODEL})*
"""

    issue = repo.create_issue(title=title, body=body, labels=["review"])
    return issue


def main():
    # Validate environment
    required_vars = ["GITHUB_TOKEN", "OPENAI_API_KEY", "GITHUB_REPOSITORY"]
    missing = [v for v in required_vars if not os.getenv(v)]
    if missing:
        print(f"Error: Missing environment variables: {', '.join(missing)}")
        sys.exit(1)

    # Initialize clients
    gh = Github(auth=github.Auth.Token(os.environ["GITHUB_TOKEN"]))
    openai_client = OpenAI(
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=os.getenv("OPENAI_BASE_URL", "https://api.laozhang.ai/v1"),
        timeout=TIMEOUT,
    )

    repo_name = os.environ["GITHUB_REPOSITORY"]

    print(f"Scanning codebase for {repo_name}...")

    # Gather files
    root = Path(".")
    files = gather_source_files(root)
    print(f"Found {len(files)} source files")

    if not files:
        print("No source files found to review.")
        return

    # Format and truncate
    content = format_codebase(files, MAX_CONTENT_SIZE)
    print(f"Formatted content: {len(content)} characters")

    # Get AI review
    print(f"Sending to LaoZhang ({MODEL})...")
    review = review_codebase(openai_client, content)

    # Create issue
    print("Creating review issue...")
    issue = create_review_issue(gh, repo_name, review)

    print(f"Done! Issue created: {issue.html_url}")


if __name__ == "__main__":
    main()
