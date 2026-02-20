import { Component, For, Show, Index, onMount, onCleanup, createEffect, createSignal, createMemo } from "solid-js";
import MessageContent from "./MessageContent";
import ToolResult from "./ToolResult";
import ThinkingPreview from "./ThinkingPreview";
import type { ToolUse, ContentBlock, Message } from "../lib/types";

// Re-export types for backward compatibility
export type { ToolUse, ContentBlock, Message } from "../lib/types";

// Grouped block type - consecutive Task tools are grouped together
type GroupedBlock =
  | { type: "single"; block: ContentBlock; startIndex: number }
  | { type: "tool_group"; tools: Array<{ type: "tool_use"; tool: ToolUse }>; startIndex: number };

// Group consecutive Task tools together for unified rendering
// Always groups consecutive Task tools (including single Task) so the
// streaming DOM shape stays stable as more background tasks are launched.
// Non-Task blocks (thinking, text) break the grouping
function groupBlocks(blocks: ContentBlock[]): GroupedBlock[] {
  const result: GroupedBlock[] = [];
  let currentToolGroup: Array<{ type: "tool_use"; tool: ToolUse }> = [];
  let currentToolGroupStart = -1;

  const flushToolGroup = () => {
    if (currentToolGroup.length > 0) {
      // 1+ consecutive Task tools -> grouped container (stable structure)
      result.push({
        type: "tool_group",
        tools: [...currentToolGroup],
        startIndex: currentToolGroupStart,
      });
    }
    currentToolGroup = [];
    currentToolGroupStart = -1;
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    // Check if this is a Task tool by NAME (subagent data may arrive later)
    if (block.type === "tool_use") {
      const toolBlock = block as { type: "tool_use"; tool: ToolUse };
      if (toolBlock.tool.name === "Task") {
        // This is a Task tool - add to current group
        if (currentToolGroup.length === 0) {
          currentToolGroupStart = i;
        }
        currentToolGroup.push(toolBlock);
        continue;
      }
    }

    // Not a Task tool - flush any pending group and add as single block
    flushToolGroup();
    result.push({ type: "single", block, startIndex: i });
  }

  // Don't forget to flush any remaining tools
  flushToolGroup();

  return result;
}

function isBackgroundTaskVariant(variant?: Message["variant"]): boolean {
  return variant === "background_task_running" || variant === "background_task_complete";
}

interface PlanningState {
  nestedTools: { name: string; input?: string }[];
  isReady: boolean;
}

interface MessageListProps {
  messages: Message[];
  streamingContent?: string;
  streamingToolUses?: ToolUse[];
  streamingBlocks?: ContentBlock[];  // New: ordered streaming blocks
  streamingThinking?: string;  // Current thinking content being streamed
  showThinking?: boolean;  // Whether to show thinking in expanded view (global toggle)
  forceScrollToBottom?: boolean;  // Force scroll on new user message
  header?: any;  // Optional header element (e.g., branding) that scrolls with content
  planning?: PlanningState;  // Planning state for inline plan display
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

  // Handle forceScrollToBottom prop - re-enables auto-scroll when user sends a message
  createEffect(() => {
    if (props.forceScrollToBottom) {
      setShouldAutoScroll(true);
      scrollToBottom();
    }
  });

  onMount(() => {
    containerRef?.addEventListener('scroll', handleScroll);
    scrollToBottom();

    // Use MutationObserver to scroll when DOM content changes
    // This automatically handles all content changes (messages, tools, subagent progress, etc.)
    // without needing to track specific state paths
    // Debounced via requestAnimationFrame to avoid excessive scroll updates
    // during rapid streaming (100+ mutations/second → 1 scroll/frame)
    if (containerRef) {
      let scrollPending = false;
      const debouncedScroll = () => {
        if (!scrollPending) {
          scrollPending = true;
          requestAnimationFrame(() => {
            scrollToBottom();
            scrollPending = false;
          });
        }
      };

      const mutationObserver = new MutationObserver(debouncedScroll);
      mutationObserver.observe(containerRef, {
        childList: true,    // Watch for added/removed child nodes
        subtree: true,      // Watch all descendants, not just direct children
        characterData: true // Watch for text content changes (streaming)
      });

      onCleanup(() => {
        mutationObserver.disconnect();
      });
    }
  });

  onCleanup(() => {
    containerRef?.removeEventListener('scroll', handleScroll);
  });

  // Memoize grouped streaming blocks so <Index> persists across updates
  // (avoids the IIFE pattern which recreated <Index> on every streaming event)
  const streamingGrouped = createMemo(() =>
    groupBlocks(props.streamingBlocks || [])
  );
  const lastStreamingThinkingIndex = createMemo(() => {
    const blocks = props.streamingBlocks || [];
    return blocks.map((b, i) => b.type === "thinking" ? i : -1).filter(i => i >= 0).pop() ?? -1;
  });

  return (
    <div class="message-list" ref={containerRef}>
      {/* Optional header (branding) - scrolls with content */}
      {props.header}

      <For each={props.messages}>
        {(message) => (
          <div class={`message message-${message.role}${message.variant ? ` message-${message.variant}` : ''}${message.faded ? ' message-faded' : ''}${message.interrupted ? ' message-interrupted' : ''}`}>
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

              {/* Background task progress/result message rendered as a tool block */}
              <Show when={isBackgroundTaskVariant(message.variant)}>
                <div class="tool-uses">
                  <ToolResult
                    name="Task Output"
                    result={message.content}
                    isLoading={message.variant === "background_task_running"}
                    autoExpanded={true}
                  />
                </div>
              </Show>

              {/* Regular message content rendering */}
              <Show when={!isBackgroundTaskVariant(message.variant) && message.variant !== "compaction" && message.variant !== "cleared"}>
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
                              subagent={tool.subagent}
                              startedAt={tool.startedAt}
                              completedAt={tool.completedAt}
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
                              autoExpanded={(block as { type: "tool_use"; tool: ToolUse }).tool.autoExpanded}
                              subagent={(block as { type: "tool_use"; tool: ToolUse }).tool.subagent}
                              startedAt={(block as { type: "tool_use"; tool: ToolUse }).tool.startedAt}
                              completedAt={(block as { type: "tool_use"; tool: ToolUse }).tool.completedAt}
                              planning={(block as { type: "tool_use"; tool: ToolUse }).tool.name === "Planning" ? props.planning : undefined}
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
                          autoExpanded={tool.autoExpanded}
                          subagent={tool.subagent}
                          startedAt={tool.startedAt}
                          completedAt={tool.completedAt}
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
              {/* Render ALL blocks in natural order, grouping consecutive Task tools */}
              {/* Uses memoized grouping + <Show> for stable DOM (prevents spinner animation restarts) */}
              <Index each={streamingGrouped()}>
                {(group) => {
                  // Reactive helpers for tool_group rendering
                  // Only called inside <Show>'s truthy branch where group().type === "tool_group"
                  const tools = () => (group() as GroupedBlock & { type: "tool_group" }).tools;
                  const anyLoading = () => tools().some(t =>
                    t.tool.isLoading || (t.tool.subagent && t.tool.subagent.status !== "complete")
                  );

                  return (
                    <Show when={group().type === "tool_group"} fallback={
                      // Single block fallback (thinking, text, non-Task tool_use)
                      // These don't have long-running spinner animations, so DOM recreation is fine
                      (() => {
                        const g = group() as GroupedBlock & { type: "single" };
                        const block = g.block;
                        const currentIndex = g.startIndex;

                        if (block.type === "thinking") {
                          return (
                            <ThinkingPreview
                              content={(block as { type: "thinking"; content: string }).content}
                              expanded={isThinkingExpanded(`streaming:${currentIndex}`)}
                              isStreaming={currentIndex === lastStreamingThinkingIndex() && !!props.streamingThinking}
                              onToggle={() => toggleThinking(`streaming:${currentIndex}`)}
                            />
                          );
                        }

                        if (block.type === "text") {
                          return <MessageContent content={(block as { type: "text"; content: string }).content} />;
                        }

                        // tool_use block
                        const toolBlock = block as { type: "tool_use"; tool: ToolUse };

                        if (toolBlock.tool.name === "Task") {
                          return (
                            <ToolResult
                              name={toolBlock.tool.name}
                              input={toolBlock.tool.input}
                              result={toolBlock.tool.result}
                              isLoading={toolBlock.tool.isLoading}
                              autoExpanded={toolBlock.tool.autoExpanded}
                              subagent={toolBlock.tool.subagent}
                              startedAt={toolBlock.tool.startedAt}
                              completedAt={toolBlock.tool.completedAt}
                              grouped={true}
                            />
                          );
                        }

                        // Regular tool_use (not Task)
                        return (
                          <div class="tool-uses">
                            <ToolResult
                              name={toolBlock.tool.name}
                              input={toolBlock.tool.input}
                              result={toolBlock.tool.result}
                              isLoading={toolBlock.tool.isLoading}
                              autoExpanded={toolBlock.tool.autoExpanded}
                              subagent={toolBlock.tool.subagent}
                              startedAt={toolBlock.tool.startedAt}
                              completedAt={toolBlock.tool.completedAt}
                              planning={toolBlock.tool.name === "Planning" ? props.planning : undefined}
                            />
                          </div>
                        );
                      })()
                    }>
                      {/* Tool group - <Show> keeps this DOM alive while type stays "tool_group" */}
                      {/* Spinner CSS animation continues without restart */}
                      <div class="tool-uses">
                        <div class="tool-result tool-group-container" classList={{ loading: anyLoading() }}>
                          <div class="tool-header">
                            <span class="tool-icon" classList={{ complete: !anyLoading(), spinning: anyLoading() }}>
                              {anyLoading() ? "" : "✓"}
                            </span>
                            <span class="tool-name">TASKS</span>
                            <span class="tool-input-preview">
                              {tools().length} {tools().length === 1 ? "agent" : "parallel agents"}
                            </span>
                          </div>
                          <div class="tool-group-items">
                            <Index each={tools()}>
                              {(toolBlock) => (
                                <ToolResult
                                  name={toolBlock().tool.name}
                                  input={toolBlock().tool.input}
                                  result={toolBlock().tool.result}
                                  isLoading={toolBlock().tool.isLoading}
                                  autoExpanded={toolBlock().tool.autoExpanded}
                                  subagent={toolBlock().tool.subagent}
                                  startedAt={toolBlock().tool.startedAt}
                                  completedAt={toolBlock().tool.completedAt}
                                  grouped={true}
                                />
                              )}
                            </Index>
                          </div>
                        </div>
                      </div>
                    </Show>
                  );
                }}
              </Index>
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
