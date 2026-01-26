import { Component, For, Show, onMount, onCleanup, createEffect, createSignal } from "solid-js";
import MessageContent from "./MessageContent";
import ToolResult from "./ToolResult";
import ThinkingPreview from "./ThinkingPreview";
import type { ToolUse, ContentBlock, Message } from "../lib/types";

// Re-export types for backward compatibility
export type { ToolUse, ContentBlock, Message } from "../lib/types";

interface MessageListProps {
  messages: Message[];
  streamingContent?: string;
  streamingToolUses?: ToolUse[];
  streamingBlocks?: ContentBlock[];  // New: ordered streaming blocks
  streamingThinking?: string;  // Current thinking content being streamed
  showThinking?: boolean;  // Whether to show thinking in expanded view (global toggle)
  forceScrollToBottom?: boolean;  // Force scroll on new user message
  header?: any;  // Optional header element (e.g., branding) that scrolls with content
}

const MessageList: Component<MessageListProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;

  // Track individually expanded thinking blocks by unique key (messageId:blockIndex)
  const [expandedThinking, setExpandedThinking] = createSignal<Set<string>>(new Set());

  // Smart scroll control: auto-scroll when at bottom, pause when user scrolls up
  const [shouldAutoScroll, setShouldAutoScroll] = createSignal(true);
  const SCROLL_THRESHOLD = 1; // must be exactly at bottom

  const handleScroll = () => {
    if (!containerRef) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
    setShouldAutoScroll(isAtBottom);
  };

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
    if (containerRef && shouldAutoScroll()) {
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
    const forceScroll = props.forceScrollToBottom;
    // Force SolidJS to track these dependencies
    void msgs;
    void streaming;
    void blocks;
    void thinking;

    // If forceScrollToBottom is set, re-enable auto-scroll
    if (forceScroll) {
      setShouldAutoScroll(true);
    }

    scrollToBottom();
  });

  onMount(() => {
    containerRef?.addEventListener('scroll', handleScroll);
    scrollToBottom();
  });

  onCleanup(() => {
    containerRef?.removeEventListener('scroll', handleScroll);
  });

  return (
    <div class="message-list" ref={containerRef}>
      {/* Optional header (branding) - scrolls with content */}
      {props.header}

      <For each={props.messages}>
        {(message) => (
          <div class={`message message-${message.role}${message.variant ? ` message-${message.variant}` : ''}${message.faded ? ' message-faded' : ''}`}>
            <Show when={message.role === "user"}>
              <div class="message-role-indicator">You</div>
            </Show>
            <Show when={message.role === "assistant"}>
              <div class="message-role-indicator">Claude</div>
            </Show>
            <Show when={message.role === "system" && !message.variant}>
              <div class="message-role-indicator">System</div>
            </Show>

            <div class="message-body">
              {/* Special rendering for compaction variant - looks like a tool block */}
              <Show when={message.variant === "compaction"}>
                <span class={`compaction-icon${message.content.endsWith('...') ? ' loading' : ''}`}>
                  {message.content.endsWith('...') ? '◐' : '⚡'}
                </span>
                <span class="compaction-label">
                  {message.content.endsWith('...') ? 'compacting' : 'compacted'}
                </span>
                <span class="compaction-tokens">{message.content}</span>
              </Show>

              {/* Special rendering for cleared variant - just shows "context cleared" */}
              <Show when={message.variant === "cleared"}>
                <span class="cleared-icon">○</span>
                <span class="cleared-label">context cleared</span>
              </Show>

              {/* Regular message content rendering */}
              <Show when={message.variant !== "compaction" && message.variant !== "cleared"}>
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
                              autoExpanded={tool.autoExpanded}
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
                  // Find last thinking block index for streaming indicator
                  const blocks = props.streamingBlocks || [];
                  const lastThinkingIndex = blocks.map((b, i) => b.type === "thinking" ? i : -1).filter(i => i >= 0).pop() ?? -1;

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
              {/* Single cursor AFTER all blocks - only shows when last block is text */}
              <Show when={props.streamingBlocks && props.streamingBlocks.length > 0 && props.streamingBlocks[props.streamingBlocks.length - 1].type === "text"}>
                <span class="cursor">|</span>
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default MessageList;
