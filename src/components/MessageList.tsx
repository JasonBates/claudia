import { Component, For, Show, onMount, createEffect } from "solid-js";
import MessageContent from "./MessageContent";
import ToolResult from "./ToolResult";

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
  | { type: "tool_use"; tool: ToolUse };

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
}

const MessageList: Component<MessageListProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;

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
    // Force SolidJS to track these dependencies
    void msgs;
    void streaming;
    void blocks;
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
                <For each={message.contentBlocks}>
                  {(block) => (
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
                  )}
                </For>
              </Show>
            </div>
          </div>
        )}
      </For>

      {/* Streaming message indicator */}
      <Show when={props.streamingContent || (props.streamingToolUses && props.streamingToolUses.length > 0) || (props.streamingBlocks && props.streamingBlocks.length > 0)}>
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
              <For each={props.streamingBlocks}>
                {(block, index) => (
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
                    {/* Show cursor after last text block */}
                    <Show when={index() === props.streamingBlocks!.length - 1 && block.type === "text"}>
                      <span class="cursor">|</span>
                    </Show>
                  </Show>
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default MessageList;
