#!/usr/bin/env python3
"""
Standalone code review script for use with Conductor or Claude Code.

Usage:
    cd /path/to/project
    OPENAI_API_KEY=your_key python review_standalone.py

    # Or with custom model:
    OPENAI_MODEL=gpt-5.2-codex-high python review_standalone.py

    # Output to file:
    python review_standalone.py > review.md

Outputs structured review as markdown (or JSON with --json flag).
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from openai import OpenAI

# Configuration
MAX_CONTENT_SIZE = 120_000
MODEL = os.getenv("OPENAI_MODEL", "gpt-5.2-codex-medium")
BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.laozhang.ai/v1")
TIMEOUT = 420
MAX_RETRIES = 3

# Default patterns (can be overridden)
DEFAULT_PATTERNS = [
    "src/**/*.tsx", "src/**/*.ts",
    "src-tauri/src/**/*.rs",
    "src-tauri/*.mjs", "src-tauri/*.js",
    "**/*.py",
]

SKIP_FILES = {"vite-env.d.ts", "auto-imports.d.ts", "components.d.ts", "__pycache__"}
EXCLUDE_DIRS = {"node_modules", "target", "dist", "build", ".git", "__pycache__", ".venv", "venv"}

REVIEW_PROMPT = """You are an expert code reviewer. Analyze this codebase and provide actionable improvements.

**Your task:**
1. Identify concrete improvements (security, performance, quality, architecture)
2. Prioritize by severity (critical > high > medium > low)
3. Provide specific file references and actionable solutions
4. Estimate effort for each fix

Be thorough but practical - every improvement should be implementable.

**IMPORTANT: Respond with valid JSON only, no markdown, no explanation. Use this exact structure:**

{{
  "improvements": [
    {{
      "id": "SEC-001",
      "file": "path/to/file.rs",
      "line_hint": "function_name or ~line 42",
      "severity": "critical|high|medium|low",
      "category": "security|performance|quality|architecture|maintainability",
      "title": "Short title under 80 chars",
      "problem": "What's wrong and why it matters",
      "solution": "How to fix it",
      "effort": "trivial|small|medium|large"
    }}
  ],
  "architecture_notes": "Brief assessment of overall architecture",
  "security_posture": "Overall security assessment",
  "top_priority": "The single most important thing to fix first and why",
  "risk_score": 65
}}

---

**Files to review:**

The files below are provided in structured XML format with metadata:
- `<file_manifest>` lists all files with index, path, language, and line count
- Each `<file>` contains `<metadata>` and `<content>`

{content}
"""


def gather_files(root: Path, patterns: list[str]) -> list[tuple[str, str]]:
    """Gather source files matching patterns."""
    files = []
    seen = set()

    for pattern in patterns:
        for fp in root.glob(pattern):
            if not fp.is_file():
                continue
            if set(fp.parts) & EXCLUDE_DIRS:
                continue
            if fp.name in SKIP_FILES:
                continue
            rel = str(fp.relative_to(root))
            if rel in seen:
                continue
            seen.add(rel)
            try:
                files.append((rel, fp.read_text(encoding="utf-8")))
            except (UnicodeDecodeError, PermissionError):
                pass

    return sorted(files, key=lambda x: x[0])


def format_files(files: list[tuple[str, str]], max_size: int) -> str:
    """Format files with structured XML-like delimiters."""
    parts = []
    size = 0
    total = len(files)

    # Manifest
    manifest = ["<file_manifest>"]
    for idx, (path, content) in enumerate(files, 1):
        ext = Path(path).suffix.lstrip(".")
        lang = {"ts": "typescript", "tsx": "tsx", "rs": "rust", "mjs": "javascript", "js": "javascript", "py": "python"}.get(ext, ext)
        lines = len(content.splitlines())
        manifest.append(f'  <file index="{idx}" path="{path}" lang="{lang}" lines="{lines}" />')
    manifest.append("</file_manifest>\n")
    manifest_str = "\n".join(manifest)
    parts.append(manifest_str)
    size += len(manifest_str)

    # Files
    for idx, (path, content) in enumerate(files, 1):
        ext = Path(path).suffix.lstrip(".")
        lang = {"ts": "typescript", "tsx": "tsx", "rs": "rust", "mjs": "javascript", "js": "javascript", "py": "python"}.get(ext, ext)
        lines = len(content.splitlines())
        chars = len(content)

        block = f'''
<file index="{idx}" total="{total}">
  <metadata>
    <path>{path}</path>
    <language>{lang}</language>
    <lines>{lines}</lines>
    <characters>{chars}</characters>
  </metadata>
  <content>
{content}
  </content>
</file>
'''
        if size + len(block) > max_size:
            parts.append(f"\n... truncated ({total - idx + 1} files remaining)")
            break
        parts.append(block)
        size += len(block)

    return "".join(parts)


def review_code(client: OpenAI, content: str) -> dict:
    """Get structured review from API."""
    prompt = REVIEW_PROMPT.format(content=content)

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"Attempt {attempt}/{MAX_RETRIES}...", file=sys.stderr)
            start = time.time()

            response = client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=8000,
                temperature=0.3,
            )

            elapsed = time.time() - start
            usage = response.usage
            print(f"✓ Success in {elapsed:.1f}s ({usage.prompt_tokens} in / {usage.completion_tokens} out)", file=sys.stderr)

            # Extract JSON
            raw = response.choices[0].message.content
            text = re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL).strip()

            # Handle code blocks
            if "```json" in text:
                start_idx = text.find("```json") + 7
                end_idx = text.find("```", start_idx)
                if end_idx > start_idx:
                    text = text[start_idx:end_idx].strip()
            elif "```" in text:
                start_idx = text.find("```") + 3
                end_idx = text.find("```", start_idx)
                if end_idx > start_idx:
                    text = text[start_idx:end_idx].strip()

            # Find JSON boundaries
            if not text.startswith("{"):
                json_start = text.find("{")
                if json_start != -1:
                    text = text[json_start:]

            if text.startswith("{"):
                depth = 0
                for i, c in enumerate(text):
                    if c == "{": depth += 1
                    elif c == "}":
                        depth -= 1
                        if depth == 0:
                            text = text[:i+1]
                            break

            return json.loads(text)

        except json.JSONDecodeError as e:
            print(f"✗ JSON parse error: {e}", file=sys.stderr)
            if attempt < MAX_RETRIES:
                print(f"Retrying in {2**attempt}s...", file=sys.stderr)
                time.sleep(2 ** attempt)
            else:
                raise
        except Exception as e:
            print(f"✗ Error: {e}", file=sys.stderr)
            if attempt < MAX_RETRIES:
                print(f"Retrying in {2**attempt}s...", file=sys.stderr)
                time.sleep(2 ** attempt)
            else:
                raise


def format_markdown(review: dict) -> str:
    """Format review as markdown."""
    lines = [
        "# Code Review",
        "",
        f"**Risk Score:** {review['risk_score']}/100",
        "",
        "## Summary",
        "",
        f"**Top Priority:** {review['top_priority']}",
        "",
        "### Architecture",
        review["architecture_notes"],
        "",
        "### Security Posture",
        review["security_posture"],
        "",
        "## Improvements",
        "",
    ]

    severity_icons = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}
    effort_labels = {"trivial": "~1h", "small": "~4h", "medium": "~1d", "large": "~1w"}

    by_severity = {"critical": [], "high": [], "medium": [], "low": []}
    for item in review["improvements"]:
        by_severity[item["severity"]].append(item)

    for severity in ["critical", "high", "medium", "low"]:
        items = by_severity[severity]
        if not items:
            continue
        lines.append(f"### {severity_icons[severity]} {severity.title()} ({len(items)})")
        lines.append("")
        for item in items:
            effort = effort_labels.get(item["effort"], item["effort"])
            lines.append(f"- [ ] **{item['id']}**: {item['title']}")
            lines.append(f"  - File: `{item['file']}` ({item.get('line_hint', '')})")
            lines.append(f"  - Category: {item['category']} | Effort: {effort}")
            lines.append(f"  - **Problem:** {item['problem']}")
            lines.append(f"  - **Solution:** {item['solution']}")
            lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Standalone code review")
    parser.add_argument("--json", action="store_true", help="Output raw JSON instead of markdown")
    parser.add_argument("--patterns", nargs="+", help="File patterns to include (default: src/**/*.ts, etc.)")
    parser.add_argument("--dir", default=".", help="Directory to review (default: current)")
    args = parser.parse_args()

    if not os.getenv("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    root = Path(args.dir).resolve()
    patterns = args.patterns or DEFAULT_PATTERNS

    print(f"Reviewing: {root}", file=sys.stderr)
    print(f"Model: {MODEL}", file=sys.stderr)
    print(f"Patterns: {patterns}", file=sys.stderr)
    print("", file=sys.stderr)

    # Gather files
    files = gather_files(root, patterns)
    print(f"Found {len(files)} files", file=sys.stderr)

    if not files:
        print("No files found.", file=sys.stderr)
        sys.exit(1)

    # Format
    content = format_files(files, MAX_CONTENT_SIZE)
    print(f"Content: {len(content):,} chars (~{len(content)//4:,} tokens)", file=sys.stderr)
    print("", file=sys.stderr)

    # Review
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"], base_url=BASE_URL, timeout=TIMEOUT)
    review = review_code(client, content)

    # Output
    if args.json:
        print(json.dumps(review, indent=2))
    else:
        print(format_markdown(review))


if __name__ == "__main__":
    main()
