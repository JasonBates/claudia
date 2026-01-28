import { Component, createResource, Show, For, createMemo } from "solid-js";
import { highlightCode } from "../lib/highlight";

interface MessageContentProps {
  content: string;
}

interface ParsedBlock {
  type: "text" | "code";
  content: string;
  lang?: string;
}

function parseMarkdown(content: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Text before code block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index);
      if (text.trim()) {
        blocks.push({ type: "text", content: text });
      }
    }

    // Code block
    blocks.push({
      type: "code",
      lang: match[1] || "text",
      content: match[2],
    });

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
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

// Callout icons for different types
const calloutIcons: Record<string, string> = {
  insight: '✎',
  note: '✎',
  tip: '💡',
  info: 'ℹ',
  warning: '⚠',
  danger: '⚠',
  example: '→',
  quote: '❝',
  success: '✓',
  question: '?',
};

// Transform ★ Insight blocks (backtick-bordered) into Obsidian callout format
function processInsightBlocks(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check for insight start: `★ Insight ───...`
    const insightStartMatch = line.match(/^`★\s*Insight\s*─+`$/);
    if (insightStartMatch) {
      // Collect content until the closing border line
      const contentLines: string[] = [];
      let j = i + 1;

      while (j < lines.length) {
        const nextLine = lines[j];
        // Check for closing border: `───...`
        if (nextLine.match(/^`─+`$/)) {
          j++; // Skip the closing border
          break;
        }
        contentLines.push(nextLine);
        j++;
      }

      // Convert to Obsidian callout format
      result.push('> [!insight] Insight');
      contentLines.forEach(cl => {
        result.push(`> ${cl}`);
      });

      i = j;
      continue;
    }

    result.push(line);
    i++;
  }

  return result.join('\n');
}

function processCallouts(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check for callout start: > [!type] or > [!type] Title
    const calloutMatch = line.match(/^>\s*\[!(\w+)\]\s*(.*)$/i);
    if (calloutMatch) {
      const calloutType = calloutMatch[1].toLowerCase();
      const calloutTitle = calloutMatch[2] || calloutType.charAt(0).toUpperCase() + calloutType.slice(1);
      const icon = calloutIcons[calloutType] || '✎';

      // Collect all callout content lines
      const contentLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        // Continue if line starts with > (callout continuation)
        if (nextLine.match(/^>\s?(.*)$/)) {
          const contentMatch = nextLine.match(/^>\s?(.*)$/);
          contentLines.push(contentMatch ? contentMatch[1] : '');
          j++;
        } else {
          break;
        }
      }

      // Build callout HTML
      const calloutContent = contentLines.join('<br>');
      result.push(
        `<div class="callout callout-${calloutType}">` +
        `<div class="callout-header"><span class="callout-icon">${icon}</span><span class="callout-title">${calloutTitle}</span></div>` +
        `<div class="callout-content">${calloutContent}</div>` +
        `</div>`
      );

      i = j;
      continue;
    }

    // Check for regular blockquote (not a callout): > text
    const blockquoteMatch = line.match(/^>\s?(.*)$/);
    if (blockquoteMatch) {
      // Collect all consecutive blockquote lines
      const quoteLines: string[] = [blockquoteMatch[1]];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        const nextMatch = nextLine.match(/^>\s?(.*)$/);
        if (nextMatch) {
          quoteLines.push(nextMatch[1]);
          j++;
        } else {
          break;
        }
      }

      // Build blockquote HTML
      const quoteContent = quoteLines.join('<br>');
      result.push(`<blockquote class="md-quote">${quoteContent}</blockquote>`);

      i = j;
      continue;
    }

    result.push(line);
    i++;
  }

  return result.join('\n');
}

function processMarkdownWithTables(content: string): string {
  // Transform ★ Insight blocks to Obsidian callout format first
  content = processInsightBlocks(content);
  // Then process callouts (including the transformed insight blocks)
  content = processCallouts(content);

  const lines = content.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check if this looks like the start of a table
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      // Look ahead to see if next line is a separator
      const nextLine = lines[i + 1]?.trim() || '';
      if (nextLine.startsWith('|') && /^[\|\-:\s]+$/.test(nextLine)) {
        // This is a table! Collect all table rows
        const tableLines: string[] = [line];
        let j = i + 1;
        while (j < lines.length && lines[j].trim().startsWith('|')) {
          tableLines.push(lines[j]);
          j++;
        }

        // Parse the table
        const parseRow = (row: string) =>
          row.split('|').map(c => c.trim()).filter(c => c !== '');

        const headerRow = parseRow(tableLines[0]);
        const dataRows = tableLines.slice(2).map(parseRow);

        let html = '<table class="md-table"><thead><tr>';
        headerRow.forEach(cell => { html += `<th>${cell}</th>`; });
        html += '</tr></thead><tbody>';
        dataRows.forEach(row => {
          html += '<tr>';
          row.forEach(cell => { html += `<td>${cell}</td>`; });
          html += '</tr>';
        });
        html += '</tbody></table>';

        result.push(html);
        i = j;
        continue;
      }
    }

    result.push(line);
    i++;
  }

  return result.join('\n');
}

const TextBlock: Component<{ content: string }> = (props) => {
  const formattedContent = createMemo(() => {
    // Process tables first (before other transformations)
    let text = processMarkdownWithTables(props.content);

    // Headers (must be at start of line)
    text = text.replace(/^# (.+)$/gm, '<h2 class="md-h1">$1</h2>');
    text = text.replace(/^## (.+)$/gm, '<h3 class="md-h2">$1</h3>');
    text = text.replace(/^### (.+)$/gm, '<h4 class="md-h3">$1</h4>');

    // Task lists
    text = text.replace(/^- \[x\] (.+)$/gim, '<div class="md-task md-task-done">✓ $1</div>');
    text = text.replace(/^- \[ \] (.+)$/gm, '<div class="md-task">○ $1</div>');

    // Lists (unordered)
    text = text.replace(/^- (.+)$/gm, '<div class="md-li">• $1</div>');
    text = text.replace(/^\* (.+)$/gm, '<div class="md-li">• $1</div>');

    // Lists (ordered)
    text = text.replace(/^(\d+)\. (.+)$/gm, '<div class="md-li">$1. $2</div>');

    // Horizontal rule
    text = text.replace(/^---$/gm, '<hr class="md-hr">');

    // Strikethrough
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Bold (** or __) - must come before italic
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");

    // Italic (* or _) - must come after bold
    text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    text = text.replace(/ _([^_]+)_ /g, " <em>$1</em> ");
    text = text.replace(/^_([^_]+)_$/gm, "<em>$1</em>");

    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Links
    text = text.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );

    // Paragraph breaks (double newline) - add visual separation
    text = text.replace(/\n\n+/g, '<div class="md-break"></div>');

    // Single line breaks
    text = text.replace(/\n/g, "<br>");

    // Clean up breaks after block elements
    text = text.replace(/(<\/(?:h[234]|div|blockquote|hr|table)>)(?:<br>|<div class="md-break"><\/div>)/g, '$1');

    return text;
  });

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
