import { Component, createMemo, createResource, For, Show } from "solid-js";
import { highlightCode } from "../lib/highlight";

interface MessageContentProps {
  content: string;
}

interface ParsedBlock {
  type: "text" | "code";
  content: string;
  lang?: string;
}

const calloutIcons: Record<string, string> = {
  insight: "✎",
  note: "✎",
  tip: "💡",
  info: "ℹ",
  warning: "⚠",
  danger: "⚠",
  example: "→",
  quote: "❝",
  success: "✓",
  question: "?",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const ALLOWED_PROTOCOLS = [
  "http:",
  "https:",
  "mailto:",
  "obsidian:",
  "file:",
];

function sanitizeHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return "#";

  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("?")
  ) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    if (ALLOWED_PROTOCOLS.includes(url.protocol)) {
      return trimmed;
    }
  } catch {
    return "#";
  }

  return "#";
}

function renderInlineMarkdown(text: string): string {
  const tokenRegex =
    /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;

  let html = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    html += escapeHtml(text.slice(lastIndex, match.index));

    if (match[1] !== undefined && match[2] !== undefined) {
      const safeHref = escapeHtml(sanitizeHref(match[2]));
      html += `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${renderInlineMarkdown(match[1])}</a>`;
    } else if (match[3] !== undefined) {
      html += `<code class="inline-code">${escapeHtml(match[3])}</code>`;
    } else if (match[4] !== undefined) {
      html += `<strong>${renderInlineMarkdown(match[4])}</strong>`;
    } else if (match[5] !== undefined) {
      html += `<strong>${renderInlineMarkdown(match[5])}</strong>`;
    } else if (match[6] !== undefined) {
      html += `<del>${renderInlineMarkdown(match[6])}</del>`;
    } else if (match[7] !== undefined) {
      html += `<em>${renderInlineMarkdown(match[7])}</em>`;
    } else if (match[8] !== undefined) {
      html += `<em>${renderInlineMarkdown(match[8])}</em>`;
    }

    lastIndex = match.index + match[0].length;
  }

  html += escapeHtml(text.slice(lastIndex));
  return html;
}

function parseMarkdown(content: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index);
      if (text.trim()) {
        blocks.push({ type: "text", content: text });
      }
    }

    blocks.push({
      type: "code",
      lang: match[1] || "text",
      content: match[2],
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const text = content.slice(lastIndex);
    if (text.trim()) {
      blocks.push({ type: "text", content: text });
    }
  }

  return blocks.length > 0 ? blocks : [{ type: "text", content }];
}

const CodeBlock: Component<{ code: string; lang: string }> = (props) => {
  const [highlighted] = createResource(
    () => ({ code: props.code, lang: props.lang }),
    async ({ code, lang }) => highlightCode(code, lang)
  );

  return (
    <div class="code-block">
      <div class="code-header">
        <span class="code-lang">{props.lang}</span>
      </div>
      <Show when={highlighted()} fallback={<pre><code>{props.code}</code></pre>}>
        <div innerHTML={highlighted()} />
      </Show>
    </div>
  );
};

function renderCallout(
  type: string,
  title: string,
  lines: string[]
): string {
  const calloutType = calloutIcons[type] ? type : "note";
  const icon = calloutIcons[calloutType];
  const content = lines.map(renderInlineMarkdown).join("<br>");

  return (
    `<div class="callout callout-${calloutType}">` +
    `<div class="callout-header"><span class="callout-icon">${icon}</span><span class="callout-title">${renderInlineMarkdown(title)}</span></div>` +
    `<div class="callout-content">${content}</div>` +
    `</div>`
  );
}

function renderTextBlock(content: string): string {
  const lines = content.split("\n");
  const parts: string[] = [];

  const flushParagraph = (paragraphLines: string[]) => {
    if (paragraphLines.length === 0) return;
    parts.push(`<p>${paragraphLines.map(renderInlineMarkdown).join("<br>")}</p>`);
    paragraphLines.length = 0;
  };

  const isTableSeparator = (line: string) =>
    line.startsWith("|") && /^[\|\-:\s]+$/.test(line);

  const parseTableRow = (row: string) => {
    const cells = row.split("|").map((cell) => cell.trim());
    if (cells[0] === "") cells.shift();
    if (cells[cells.length - 1] === "") cells.pop();
    return cells;
  };

  const paragraphLines: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph(paragraphLines);
      continue;
    }

    if (/^`★\s*Insight\s*─+`$/.test(trimmed)) {
      flushParagraph(paragraphLines);
      const insightLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^`─+`$/.test(lines[i].trim())) {
        insightLines.push(lines[i]);
        i += 1;
      }
      parts.push(renderCallout("insight", "Insight", insightLines));
      continue;
    }

    const calloutMatch = line.match(/^>\s*\[!(\w+)\]\s*(.*)$/i);
    if (calloutMatch) {
      flushParagraph(paragraphLines);
      const calloutLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const match = lines[j].match(/^>\s?(.*)$/);
        if (!match) break;
        calloutLines.push(match[1]);
        j += 1;
      }

      const title =
        calloutMatch[2] ||
        `${calloutMatch[1].charAt(0).toUpperCase()}${calloutMatch[1].slice(1)}`;
      parts.push(renderCallout(calloutMatch[1].toLowerCase(), title, calloutLines));
      i = j - 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph(paragraphLines);
      const quoteLines: string[] = [trimmed.replace(/^>\s?/, "")];
      let j = i + 1;
      while (j < lines.length) {
        const match = lines[j].trim().match(/^>\s?(.*)$/);
        if (!match) break;
        quoteLines.push(match[1]);
        j += 1;
      }
      parts.push(
        `<blockquote class="md-quote">${quoteLines
          .map(renderInlineMarkdown)
          .join("<br>")}</blockquote>`
      );
      i = j - 1;
      continue;
    }

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const nextLine = lines[i + 1]?.trim() || "";
      if (isTableSeparator(nextLine)) {
        flushParagraph(paragraphLines);
        const tableLines = [trimmed];
        let j = i + 2;
        while (j < lines.length) {
          const tableLine = lines[j].trim();
          if (!(tableLine.startsWith("|") && tableLine.endsWith("|"))) break;
          tableLines.push(tableLine);
          j += 1;
        }

        const header = parseTableRow(tableLines[0]);
        const rows = tableLines.slice(1).map(parseTableRow);

        const html =
          `<table class="md-table"><thead><tr>${header
            .map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`)
            .join("")}</tr></thead><tbody>${rows
            .map(
              (row) =>
                `<tr>${row
                  .map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`)
                  .join("")}</tr>`
            )
            .join("")}</tbody></table>`;
        parts.push(html);
        i = j - 1;
        continue;
      }
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph(paragraphLines);
      const headingHtml = renderInlineMarkdown(headingMatch[2]);
      if (headingMatch[1].length === 1) {
        parts.push(`<h2 class="md-h1">${headingHtml}</h2>`);
      } else if (headingMatch[1].length === 2) {
        parts.push(`<h3 class="md-h2">${headingHtml}</h3>`);
      } else {
        parts.push(`<h4 class="md-h3">${headingHtml}</h4>`);
      }
      continue;
    }

    if (trimmed === "---") {
      flushParagraph(paragraphLines);
      parts.push('<hr class="md-hr">');
      continue;
    }

    const taskMatch = line.match(/^- \[([ xX])\] (.+)$/);
    if (taskMatch) {
      flushParagraph(paragraphLines);
      const done = taskMatch[1].toLowerCase() === "x";
      parts.push(
        `<div class="md-task${done ? " md-task-done" : ""}">${
          done ? "✓" : "○"
        } ${renderInlineMarkdown(taskMatch[2])}</div>`
      );
      continue;
    }

    const orderedMatch = line.match(/^(\d+)\. (.+)$/);
    if (orderedMatch) {
      flushParagraph(paragraphLines);
      parts.push(
        `<div class="md-li">${escapeHtml(orderedMatch[1])}. ${renderInlineMarkdown(
          orderedMatch[2]
        )}</div>`
      );
      continue;
    }

    const unorderedMatch = line.match(/^[-*] (.+)$/);
    if (unorderedMatch) {
      flushParagraph(paragraphLines);
      parts.push(`<div class="md-li">• ${renderInlineMarkdown(unorderedMatch[1])}</div>`);
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph(paragraphLines);
  return parts.join("");
}

const TextBlock: Component<{ content: string }> = (props) => {
  const formattedContent = createMemo(() => renderTextBlock(props.content));
  return <div class="text-block" innerHTML={formattedContent()} />;
};

const MessageContent: Component<MessageContentProps> = (props) => {
  const blocks = createMemo(() => parseMarkdown(props.content));

  return (
    <div class="message-content">
      <For each={blocks()}>
        {(block) => (
          <Show
            when={block.type === "code"}
            fallback={<TextBlock content={block.content} />}
          >
            <CodeBlock code={block.content} lang={block.lang || "text"} />
          </Show>
        )}
      </For>
    </div>
  );
};

export default MessageContent;
