#!/usr/bin/env python3
"""
Structured code review with actionable improvements.

Version 3: Uses JSON structured output for machine-parseable results
that can be directly implemented as improvements.
"""

import json
import os
import sys
import time
from pathlib import Path
from openai import OpenAI
from github import Github
import github

# Configuration
MAX_CONTENT_SIZE = 120_000
MODEL = os.getenv("OPENAI_MODEL", "gpt-5.2-codex-medium")
TIMEOUT = 420
MAX_RETRIES = 3

# File patterns
CORE_PATTERNS = [
    "src/*.tsx", "src/*.ts",
    "src/components/**/*.tsx", "src/components/**/*.ts",
    "src/stores/**/*.ts", "src/hooks/**/*.ts",
    "src/utils/**/*.ts", "src/types/**/*.ts",
    "src-tauri/src/**/*.rs",
    "src-tauri/*.mjs", "src-tauri/*.js",
]

SKIP_FILES = {"vite-env.d.ts", "auto-imports.d.ts", "components.d.ts"}
EXCLUDE_DIRS = {"node_modules", "target", "dist", "build", ".git"}

# Structured output schema
REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "improvements": {
            "type": "array",
            "description": "List of actionable improvements, ordered by priority",
            "items": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "Unique ID like SEC-001, PERF-002, QUAL-003"
                    },
                    "file": {
                        "type": "string",
                        "description": "File path relative to repo root"
                    },
                    "line_hint": {
                        "type": "string",
                        "description": "Approximate line range or function name"
                    },
                    "severity": {
                        "type": "string",
                        "enum": ["critical", "high", "medium", "low"]
                    },
                    "category": {
                        "type": "string",
                        "enum": ["security", "performance", "quality", "architecture", "maintainability"]
                    },
                    "title": {
                        "type": "string",
                        "description": "Short title (under 80 chars)"
                    },
                    "problem": {
                        "type": "string",
                        "description": "What's wrong and why it matters"
                    },
                    "solution": {
                        "type": "string",
                        "description": "How to fix it"
                    },
                    "effort": {
                        "type": "string",
                        "enum": ["trivial", "small", "medium", "large"],
                        "description": "Estimated implementation effort"
                    }
                },
                "required": ["id", "file", "severity", "category", "title", "problem", "solution", "effort"]
            }
        },
        "architecture_notes": {
            "type": "string",
            "description": "Brief assessment of overall architecture (2-3 sentences)"
        },
        "security_posture": {
            "type": "string",
            "description": "Overall security assessment (2-3 sentences)"
        },
        "top_priority": {
            "type": "string",
            "description": "The single most important thing to fix first and why"
        },
        "risk_score": {
            "type": "integer",
            "description": "Overall risk score 0-100 (0=no issues, 100=critical)",
            "minimum": 0,
            "maximum": 100
        }
    },
    "required": ["improvements", "architecture_notes", "security_posture", "top_priority", "risk_score"]
}

REVIEW_PROMPT = """You are an expert code reviewer. Analyze this codebase and provide actionable improvements.

**Project:** Claudia - a native macOS desktop wrapper around Claude Code CLI
- Frontend: SolidJS + TypeScript + Vite (src/)
- Backend: Rust/Tauri (src-tauri/src/)
- Bridge: Node.js SDK (src-tauri/*.mjs)

**Your task:**
1. Identify concrete improvements (security, performance, quality, architecture)
2. Prioritize by severity (critical > high > medium > low)
3. Provide specific file references and actionable solutions
4. Estimate effort for each fix

Focus on issues that matter for a desktop app handling sensitive CLI interactions.
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
- Each `<file>` contains `<metadata>` (path, language, component type, stats) and `<content>`
- Component types: backend-command, backend-core, bridge, frontend-component, frontend-hook, frontend-store, frontend-core

When referencing issues, use the file path from metadata.

{content}
"""


def gather_files(root: Path) -> list[tuple[str, str]]:
    """Gather source files."""
    files = []
    seen = set()

    for pattern in CORE_PATTERNS:
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
    """Format files with structured XML-like delimiters and rich metadata."""
    parts = []
    size = 0
    total_files = len(files)

    # File manifest header
    manifest_lines = ["<file_manifest>"]
    for idx, (path, content) in enumerate(files, 1):
        ext = Path(path).suffix.lstrip(".")
        lang = {"ts": "typescript", "tsx": "tsx", "rs": "rust", "mjs": "javascript", "js": "javascript"}.get(ext, ext)
        lines = len(content.splitlines())
        manifest_lines.append(f'  <file index="{idx}" path="{path}" lang="{lang}" lines="{lines}" />')
    manifest_lines.append("</file_manifest>\n")
    manifest = "\n".join(manifest_lines)
    parts.append(manifest)
    size += len(manifest)

    # Individual files with structured delimiters
    for idx, (path, content) in enumerate(files, 1):
        ext = Path(path).suffix.lstrip(".")
        lang = {"ts": "typescript", "tsx": "tsx", "rs": "rust", "mjs": "javascript", "js": "javascript"}.get(ext, ext)
        lines = len(content.splitlines())
        chars = len(content)

        # Determine component type from path
        if "commands" in path:
            component = "backend-command"
        elif "src-tauri" in path and path.endswith(".rs"):
            component = "backend-core"
        elif "src-tauri" in path and (path.endswith(".mjs") or path.endswith(".js")):
            component = "bridge"
        elif "components" in path:
            component = "frontend-component"
        elif "hooks" in path:
            component = "frontend-hook"
        elif "stores" in path:
            component = "frontend-store"
        else:
            component = "frontend-core"

        block = f'''
<file index="{idx}" total="{total_files}">
  <metadata>
    <path>{path}</path>
    <language>{lang}</language>
    <component>{component}</component>
    <lines>{lines}</lines>
    <characters>{chars}</characters>
  </metadata>
  <content>
{content}
  </content>
</file>
'''
        if size + len(block) > max_size:
            parts.append(f"\n... truncated ({len(files) - len(parts)} files remaining)")
            break

        parts.append(block)
        size += len(block)

    return "".join(parts)


def review_code(client: OpenAI, content: str) -> dict:
    """Get structured review from API."""
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
                # Note: Using prompt-based JSON instead of response_format
                # as LaoZhang proxy doesn't support json_schema mode
            )

            elapsed = time.time() - start
            print(f"  ✓ Success in {elapsed:.1f}s")

            usage = response.usage
            print(f"  Tokens: {usage.prompt_tokens} in / {usage.completion_tokens} out")

            # Extract JSON from response (may have think blocks, markdown, etc.)
            raw = response.choices[0].message.content

            # Remove <think>...</think> blocks (reasoning tokens)
            import re
            content = re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL).strip()

            # Try to extract JSON from code blocks if present
            if "```json" in content:
                start = content.find("```json") + 7
                end = content.find("```", start)
                if end > start:
                    content = content[start:end].strip()
            elif "```" in content:
                start = content.find("```") + 3
                end = content.find("```", start)
                if end > start:
                    content = content[start:end].strip()

            # Find JSON object boundaries
            if not content.startswith("{"):
                json_start = content.find("{")
                if json_start != -1:
                    content = content[json_start:]

            # Find matching closing brace
            if content.startswith("{"):
                depth = 0
                end_pos = 0
                for i, c in enumerate(content):
                    if c == "{":
                        depth += 1
                    elif c == "}":
                        depth -= 1
                        if depth == 0:
                            end_pos = i + 1
                            break
                if end_pos > 0:
                    content = content[:end_pos]

            return json.loads(content)

        except Exception as e:
            print(f"  ✗ Failed: {type(e).__name__}: {e}")
            if attempt < MAX_RETRIES:
                wait = 2 ** attempt
                print(f"  Retrying in {wait}s...")
                time.sleep(wait)
            else:
                raise


def format_issue_body(review: dict, file_count: int, char_count: int) -> str:
    """Format structured review as GitHub issue markdown."""

    # Count by severity
    by_severity = {"critical": [], "high": [], "medium": [], "low": []}
    for item in review["improvements"]:
        by_severity[item["severity"]].append(item)

    counts = {s: len(items) for s, items in by_severity.items()}

    # Build markdown
    lines = [
        "## 🔍 Structured Codebase Review",
        "",
        f"**Scope:** {file_count} files ({char_count:,} characters)",
        f"**Model:** {MODEL}",
        f"**Risk Score:** {review['risk_score']}/100",
        "",
        "---",
        "",
        "### 📊 Summary",
        "",
        f"| Critical | High | Medium | Low |",
        f"|:--------:|:----:|:------:|:---:|",
        f"| {counts['critical']} | {counts['high']} | {counts['medium']} | {counts['low']} |",
        "",
        f"**Top Priority:** {review['top_priority']}",
        "",
        "---",
        "",
        "### 🏗️ Architecture",
        "",
        review["architecture_notes"],
        "",
        "### 🔒 Security Posture",
        "",
        review["security_posture"],
        "",
        "---",
        "",
        "### 📋 Improvements",
        "",
    ]

    # Group improvements by severity
    severity_icons = {
        "critical": "🔴",
        "high": "🟠",
        "medium": "🟡",
        "low": "🟢"
    }

    category_icons = {
        "security": "🔒",
        "performance": "⚡",
        "quality": "✨",
        "architecture": "🏗️",
        "maintainability": "🔧"
    }

    effort_labels = {
        "trivial": "~1h",
        "small": "~4h",
        "medium": "~1d",
        "large": "~1w"
    }

    for severity in ["critical", "high", "medium", "low"]:
        items = by_severity[severity]
        if not items:
            continue

        lines.append(f"#### {severity_icons[severity]} {severity.title()} ({len(items)})")
        lines.append("")

        for item in items:
            cat_icon = category_icons.get(item["category"], "📌")
            effort = effort_labels.get(item["effort"], item["effort"])

            lines.append(f"- [ ] **`{item['id']}`** {item['title']}")
            lines.append(f"  - {cat_icon} {item['category'].title()} · `{item['file']}` · {effort}")
            lines.append(f"  - **Problem:** {item['problem']}")
            lines.append(f"  - **Solution:** {item['solution']}")
            lines.append("")

    lines.extend([
        "---",
        "",
        f"*Automated review powered by LaoZhang API ({MODEL}) with structured output*"
    ])

    return "\n".join(lines)


def create_issue(gh: Github, repo_name: str, review: dict, file_count: int, char_count: int):
    """Create GitHub issue with structured review."""
    repo = gh.get_repo(repo_name)

    # Count improvements
    total = len(review["improvements"])
    critical = sum(1 for i in review["improvements"] if i["severity"] == "critical")
    high = sum(1 for i in review["improvements"] if i["severity"] == "high")

    # Dynamic title
    if critical > 0:
        title = f"🔴 Code Review: {critical} critical, {high} high priority issues"
    elif high > 0:
        title = f"🟠 Code Review: {high} high priority issues found"
    else:
        title = f"🟢 Code Review: {total} improvements identified"

    body = format_issue_body(review, file_count, char_count)

    issue = repo.create_issue(title=title, body=body, labels=["review"])
    return issue


def main():
    required = ["GITHUB_TOKEN", "OPENAI_API_KEY", "GITHUB_REPOSITORY"]
    missing = [v for v in required if not os.getenv(v)]
    if missing:
        print(f"Error: Missing: {', '.join(missing)}")
        sys.exit(1)

    gh = Github(auth=github.Auth.Token(os.environ["GITHUB_TOKEN"]))
    client = OpenAI(
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=os.getenv("OPENAI_BASE_URL", "https://api.laozhang.ai/v1"),
        timeout=TIMEOUT,
    )

    repo_name = os.environ["GITHUB_REPOSITORY"]
    print(f"Structured review for {repo_name}")
    print(f"Model: {MODEL}")
    print()

    # Gather files
    files = gather_files(Path("."))
    print(f"Found {len(files)} files:")
    for path, _ in files[:10]:
        print(f"  - {path}")
    if len(files) > 10:
        print(f"  ... and {len(files) - 10} more")
    print()

    if not files:
        print("No files found.")
        return

    # Format
    content = format_files(files, MAX_CONTENT_SIZE)
    print(f"Content: {len(content):,} chars (~{len(content)//4:,} tokens)")
    print()

    # Review
    print(f"Getting structured review...")
    review = review_code(client, content)

    print()
    print(f"Found {len(review['improvements'])} improvements")
    print(f"Risk score: {review['risk_score']}/100")
    print()

    # Create issue
    print("Creating issue...")
    issue = create_issue(gh, repo_name, review, len(files), len(content))

    print(f"✓ Done! {issue.html_url}")


if __name__ == "__main__":
    main()
