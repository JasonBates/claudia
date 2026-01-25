import { Component, For, Show, onMount, createEffect, createSignal } from "solid-js";
import MessageContent from "./MessageContent";
import ToolResult from "./ToolResult";
import ThinkingPreview from "./ThinkingPreview";

export interface ToolUse {
  id: string;
  name: string;
  input?: unknown;
  result?: string;
  isLoading?: boolean;
}

// Content blocks allow interleaving text and tool uses in order
export type ContentBlock =
  | { type: "text"; content: string }
  | { type: "tool_use"; tool: ToolUse }
  | { type: "thinking"; content: string };

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;  // Legacy: plain text content
  toolUses?: ToolUse[];  // Legacy: tool uses at end
  contentBlocks?: ContentBlock[];  // New: ordered blocks
}

interface MessageListProps {
  messages: Message[];
  streamingContent?: string;
  streamingToolUses?: ToolUse[];
  streamingBlocks?: ContentBlock[];  // New: ordered streaming blocks
  streamingThinking?: string;  // Current thinking content being streamed
  showThinking?: boolean;  // Whether to show thinking in expanded view (global toggle)
}

const MessageList: Component<MessageListProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;

  // Track individually expanded thinking blocks by unique key (messageId:blockIndex)
  const [expandedThinking, setExpandedThinking] = createSignal<Set<string>>(new Set());

  const isThinkingExpanded = (blockKey: string) => {
    return props.showThinking || expandedThinking().has(blockKey);
  };

  const toggleThinking = (blockKey: string) => {
    setExpandedThinking(prev => {
      const next = new Set(prev);
      if (next.has(blockKey)) {
        next.delete(blockKey);
      } else {
        next.add(blockKey);
      }
      return next;
    });
  };

  const scrollToBottom = () => {
    if (containerRef) {
      containerRef.scrollTop = containerRef.scrollHeight;
    }
  };

  // Scroll to bottom when messages change or streaming content updates
  // Track full array references, not just .length, for proper reactivity
  createEffect(() => {
    // Access the full array to track reference changes
    const msgs = props.messages;
    const streaming = props.streamingContent;
    const blocks = props.streamingBlocks;
    const thinking = props.streamingThinking;
    // Force SolidJS to track these dependencies
    void msgs;
    void streaming;
    void blocks;
    void thinking;
    scrollToBottom();
  });

  onMount(() => {
    scrollToBottom();
  });

  return (
    <div class="message-list" ref={containerRef}>
      <For each={props.messages}>
        {(message) => (
          <div class={`message message-${message.role}`}>
            <Show when={message.role === "user"}>
              <div class="message-role-indicator">You</div>
            </Show>
            <Show when={message.role === "assistant"}>
              <div class="message-role-indicator">Claude</div>
            </Show>
            <Show when={message.role === "system"}>
              <div class="message-role-indicator">System</div>
            </Show>

            <div class="message-body">
              {/* Render ordered content blocks if present */}
              <Show when={message.contentBlocks && message.contentBlocks.length > 0} fallback={
                <>
                  <MessageContent content={message.content} />
                  <Show when={message.toolUses && message.toolUses.length > 0}>
                    <div class="tool-uses">
                      <For each={message.toolUses}>
                        {(tool) => (
                          <ToolResult
                            name={tool.name}
                            input={tool.input}
                            result={tool.result}
                            isLoading={tool.isLoading}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                </>
              }>
                  {/* Render ALL blocks in natural order (thinking, text, tool_use) */}
                <For each={message.contentBlocks}>
                  {(block, index) => (
                    <Show when={block.type === "thinking"} fallback={
                      <Show when={block.type === "text"} fallback={
                        <div class="tool-uses">
                          <ToolResult
                            name={(block as { type: "tool_use"; tool: ToolUse }).tool.name}
                            input={(block as { type: "tool_use"; tool: ToolUse }).tool.input}
                            result={(block as { type: "tool_use"; tool: ToolUse }).tool.result}
                            isLoading={(block as { type: "tool_use"; tool: ToolUse }).tool.isLoading}
                          />
                        </div>
                      }>
                        <MessageContent content={(block as { type: "text"; content: string }).content} />
                      </Show>
                    }>
                      <ThinkingPreview
                        content={(block as { type: "thinking"; content: string }).content}
                        expanded={isThinkingExpanded(`${message.id}:${index()}`)}
                        isStreaming={false}
                        onToggle={() => toggleThinking(`${message.id}:${index()}`)}
                      />
                    </Show>
                  )}
                </For>
              </Show>
            </div>
          </div>
        )}
      </For>

      {/* Streaming message indicator */}
      <Show when={props.streamingContent || props.streamingThinking || (props.streamingToolUses && props.streamingToolUses.length > 0) || (props.streamingBlocks && props.streamingBlocks.length > 0)}>
        <div class="message message-assistant streaming">
          <div class="message-role-indicator">Claude</div>
          <div class="message-body">
            {/* Use streamingBlocks if provided for proper ordering */}
            <Show when={props.streamingBlocks && props.streamingBlocks.length > 0} fallback={
              <>
                <Show when={props.streamingToolUses && props.streamingToolUses.length > 0}>
                  <div class="tool-uses">
                    <For each={props.streamingToolUses}>
                      {(tool) => (
                        <ToolResult
                          name={tool.name}
                          input={tool.input}
                          result={tool.result}
                          isLoading={tool.isLoading}
                        />
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={props.streamingContent}>
                  <MessageContent content={props.streamingContent!} />
                  <span class="cursor">|</span>
                </Show>
              </>
            }>
              {/* Render ALL blocks in natural order (thinking, text, tool_use) */}
              <For each={props.streamingBlocks}>
                {(block, index) => {
                  // Find indices for cursor/streaming state logic
                  const blocks = props.streamingBlocks || [];
                  const lastThinkingIndex = blocks.map((b, i) => b.type === "thinking" ? i : -1).filter(i => i >= 0).pop() ?? -1;
                  // Only show cursor if the very last block is text (meaning text is actively streaming)
                  const isTextStreamingAtEnd = blocks.length > 0 && blocks[blocks.length - 1].type === "text";

                  return (
                    <Show when={block.type === "thinking"} fallback={
                      <Show when={block.type === "text"} fallback={
                        <div class="tool-uses">
                          <ToolResult
                            name={(block as { type: "tool_use"; tool: ToolUse }).tool.name}
                            input={(block as { type: "tool_use"; tool: ToolUse }).tool.input}
                            result={(block as { type: "tool_use"; tool: ToolUse }).tool.result}
                            isLoading={(block as { type: "tool_use"; tool: ToolUse }).tool.isLoading}
                          />
                        </div>
                      }>
                        <MessageContent content={(block as { type: "text"; content: string }).content} />
                        {/* Show cursor only when this is the last block AND it's text (actively streaming) */}
                        <Show when={isTextStreamingAtEnd && index() === blocks.length - 1}>
                          <span class="cursor">|</span>
                        </Show>
                      </Show>
                    }>
                      <ThinkingPreview
                        content={(block as { type: "thinking"; content: string }).content}
                        expanded={isThinkingExpanded(`streaming:${index()}`)}
                        isStreaming={index() === lastThinkingIndex && !!props.streamingThinking}
                        onToggle={() => toggleThinking(`streaming:${index()}`)}
                      />
                    </Show>
                  );
                }}
              </For>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default MessageList;
