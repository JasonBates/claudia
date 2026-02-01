#!/usr/bin/env python3
"""
Proof of concept: Test LaoZhang API with a small file.

Usage:
    export OPENAI_API_KEY=your_laozhang_key
    python test_laozhang_api.py
"""

import os
import sys
import time
from openai import OpenAI

# Configuration - same as main script
MODEL = os.getenv("OPENAI_MODEL", "gpt-5.2-codex-medium")
BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.laozhang.ai/v1")
TIMEOUT = 180
MAX_RETRIES = 3

# Small test file content
TEST_FILE = """
### src/example.ts
```typescript
interface User {
  id: string;
  name: string;
  email: string;
}

function greetUser(user: User): string {
  return `Hello, ${user.name}!`;
}

// TODO: Add validation
function createUser(name: string, email: string): User {
  return {
    id: crypto.randomUUID(),
    name,
    email,
  };
}
```
"""

SIMPLE_PROMPT = """Review this small code snippet. Identify any issues or improvements.

{content}

Keep your response brief (2-3 bullet points max)."""


def test_api():
    """Test the LaoZhang API with minimal content."""

    if not os.getenv("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY not set")
        print("  export OPENAI_API_KEY=your_laozhang_key")
        sys.exit(1)

    print(f"Configuration:")
    print(f"  Model:    {MODEL}")
    print(f"  Base URL: {BASE_URL}")
    print(f"  Timeout:  {TIMEOUT}s")
    print(f"  Retries:  {MAX_RETRIES}")
    print()

    client = OpenAI(
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=BASE_URL,
        timeout=TIMEOUT,
    )

    prompt = SIMPLE_PROMPT.format(content=TEST_FILE)
    print(f"Prompt size: {len(prompt)} chars (~{len(prompt)//4} tokens)")
    print()

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"Attempt {attempt}/{MAX_RETRIES}...")
            start = time.time()

            response = client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=500,
                temperature=0.3,
            )

            elapsed = time.time() - start
            print(f"✓ Success in {elapsed:.1f}s")
            print()
            print("Response:")
            print("-" * 40)
            print(response.choices[0].message.content)
            print("-" * 40)
            print()
            print(f"Usage: {response.usage.prompt_tokens} in / {response.usage.completion_tokens} out")
            return True

        except Exception as e:
            elapsed = time.time() - start
            print(f"✗ Failed after {elapsed:.1f}s: {type(e).__name__}: {e}")

            if attempt < MAX_RETRIES:
                wait = 2 ** attempt
                print(f"  Retrying in {wait}s...")
                time.sleep(wait)
            else:
                print()
                print("All retries exhausted.")
                return False


if __name__ == "__main__":
    success = test_api()
    sys.exit(0 if success else 1)
