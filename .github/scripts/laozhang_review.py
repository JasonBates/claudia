#!/usr/bin/env python3
"""
AI-powered code review using LaoZhang API (OpenAI-compatible).

This script:
1. Fetches the PR diff from GitHub
2. Sends it to LaoZhang for analysis
3. Posts a review comment back to the PR
"""

import os
import sys
from openai import OpenAI
from github import Github

# Configuration
MAX_DIFF_SIZE = 100_000  # Truncate diffs larger than this
MODEL = os.getenv("OPENAI_MODEL", "gpt-5.2-codex-medium")

REVIEW_PROMPT = """You are an expert code reviewer for a Tauri + SolidJS desktop application called Claudia.

Claudia is a native macOS wrapper around Claude Code CLI, using:
- **Frontend**: SolidJS + TypeScript + Vite
- **Backend**: Rust (Tauri)
- **Bridge**: Node.js SDK bridge (sdk-bridge-v2.mjs)

Review this Pull Request diff and provide:

## Summary
A brief 2-3 sentence summary of what this PR changes.

## Issues Found
List any bugs, security concerns, or design problems. Be specific with file:line references where possible.
If none found, say "No significant issues found."

## Suggestions
Optional improvements for code quality, performance, or maintainability.
Only include if genuinely helpful - don't nitpick.

## Verdict
One of:
- **LGTM** - Ready to merge
- **Minor Changes** - Approve with suggestions
- **Needs Work** - Blocking issues to address

Be constructive and focused. This is a developer tool, so prioritize:
- Correctness over style
- Security in IPC and process handling
- TypeScript type safety
- Rust memory safety

---

**Diff:**
```diff
{diff}
```
"""


def get_pr_diff(gh: Github, repo_name: str, pr_number: int) -> str:
    """Fetch the PR diff from GitHub."""
    repo = gh.get_repo(repo_name)
    pr = repo.get_pull(pr_number)

    # Get diff via the files API (more reliable than .diff())
    files = pr.get_files()

    diff_parts = []
    for file in files:
        header = f"--- a/{file.filename}\n+++ b/{file.filename}\n"
        patch = file.patch or "(binary or empty file)"
        diff_parts.append(header + patch)

    full_diff = "\n\n".join(diff_parts)

    # Truncate if too large
    if len(full_diff) > MAX_DIFF_SIZE:
        full_diff = full_diff[:MAX_DIFF_SIZE] + "\n\n... (diff truncated due to size)"

    return full_diff


def review_diff(client: OpenAI, diff: str) -> str:
    """Send the diff to LaoZhang for review."""
    prompt = REVIEW_PROMPT.format(diff=diff)

    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2000,
        temperature=0.3,  # Lower temperature for more consistent reviews
    )

    return response.choices[0].message.content


def post_review_comment(gh: Github, repo_name: str, pr_number: int, review_text: str):
    """Post the review as a PR comment."""
    repo = gh.get_repo(repo_name)
    pr = repo.get_pull(pr_number)

    # Add a header to identify this as an AI review
    comment = f"## AI Code Review\n\n{review_text}\n\n---\n*Powered by LaoZhang API*"

    pr.create_issue_comment(comment)


def main():
    # Validate environment
    required_vars = ["GITHUB_TOKEN", "OPENAI_API_KEY", "GITHUB_REPOSITORY", "PR_NUMBER"]
    missing = [v for v in required_vars if not os.getenv(v)]
    if missing:
        print(f"Error: Missing environment variables: {', '.join(missing)}")
        sys.exit(1)

    # Initialize clients
    gh = Github(os.environ["GITHUB_TOKEN"])
    openai_client = OpenAI(
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=os.getenv("OPENAI_BASE_URL", "https://api.laozhang.ai/v1"),
    )

    repo_name = os.environ["GITHUB_REPOSITORY"]
    pr_number = int(os.environ["PR_NUMBER"])

    print(f"Reviewing PR #{pr_number} in {repo_name}...")

    # Fetch diff
    diff = get_pr_diff(gh, repo_name, pr_number)
    if not diff.strip():
        print("No changes to review.")
        return

    print(f"Diff size: {len(diff)} characters")

    # Get AI review
    print(f"Sending to LaoZhang ({MODEL})...")
    review = review_diff(openai_client, diff)

    # Post comment
    print("Posting review comment...")
    post_review_comment(gh, repo_name, pr_number, review)

    print("Done!")


if __name__ == "__main__":
    main()
