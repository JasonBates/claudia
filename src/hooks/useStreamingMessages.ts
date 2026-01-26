import { createSignal, Accessor, Setter } from "solid-js";
import type { Message, ToolUse, ContentBlock } from "../lib/types";

export interface UseStreamingMessagesReturn {
  // Message signals
  messages: Accessor<Message[]>;
  setMessages: Setter<Message[]>;
  streamingContent: Accessor<string>;
  setStreamingContent: Setter<string>;
  isLoading: Accessor<boolean>;
  setIsLoading: Setter<boolean>;
  error: Accessor<string | null>;
  setError: Setter<string | null>;

  // Tool state
  currentToolUses: Accessor<ToolUse[]>;
  setCurrentToolUses: Setter<ToolUse[]>;

  // Block state (for interleaved text and tools)
  streamingBlocks: Accessor<ContentBlock[]>;
  setStreamingBlocks: Setter<ContentBlock[]>;

  // Thinking state
  streamingThinking: Accessor<string>;
  setStreamingThinking: Setter<string>;
  showThinking: Accessor<boolean>;
  setShowThinking: Setter<boolean>;

  // Mutable refs (for event handler JSON accumulation)
  toolInputRef: { current: string };
  todoJsonRef: { current: string };
  questionJsonRef: { current: string };
  isCollectingTodoRef: { current: boolean };
  isCollectingQuestionRef: { current: boolean };
  pendingResultsRef: { current: Map<string, { result: string; isError: boolean }> };

  // Actions
  generateId: () => string;
  finishStreaming: () => void;
  resetStreamingState: () => void;
}

export interface UseStreamingMessagesOptions {
  /**
   * Called after finishStreaming completes.
   * Use this for side effects like hiding the todo panel.
   */
  onFinish?: () => void;
}

/**
 * Custom hook for managing message streaming state.
 *
 * Handles:
 * - Message list management
 * - Streaming content accumulation
 * - Tool use tracking with proper interleaving
 * - Thinking mode display
 * - JSON accumulation refs for event handlers
 *
 * Note: Event handling is still done externally - this hook
 * provides the state and refs that event handlers need.
 */
export function useStreamingMessages(
  options: UseStreamingMessagesOptions = {}
): UseStreamingMessagesReturn {
  // Message state
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [streamingContent, setStreamingContent] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Tool state - tools being collected for the streaming message
  const [currentToolUses, setCurrentToolUses] = createSignal<ToolUse[]>([]);

  // Ordered content blocks for proper interleaving of text and tools
  const [streamingBlocks, setStreamingBlocks] = createSignal<ContentBlock[]>([]);

  // Thinking mode tracking
  const [streamingThinking, setStreamingThinking] = createSignal("");
  const [showThinking, setShowThinking] = createSignal(false);

  // Message ID counter
  let messageIdCounter = 0;
  const generateId = () => `msg-${++messageIdCounter}`;

  // Mutable refs for JSON accumulation (passed to event handlers)
  // These need to be mutable objects so event handlers can modify them
  const toolInputRef = { current: "" };
  const todoJsonRef = { current: "" };
  const questionJsonRef = { current: "" };
  const isCollectingTodoRef = { current: false };
  const isCollectingQuestionRef = { current: false };

  // Pending results for race condition handling (tool_result before tool_start)
  const pendingResultsRef = { current: new Map<string, { result: string; isError: boolean }>() };

  /**
   * Finalize the current streaming message and add it to the messages array.
   *
   * CRITICAL ORDER:
   * 1. Add message to array FIRST
   * 2. Set isLoading to false
   * 3. Clear streaming state
   *
   * This prevents the UI from showing empty state between
   * clearing streaming and showing messages.
   */
  const finishStreaming = () => {
    console.log("[useStreamingMessages] finishStreaming called");
    const content = streamingContent();
    const tools = [...currentToolUses()]; // Create copies to avoid reference issues
    const blocks = [...streamingBlocks()];

    console.log(
      "[useStreamingMessages] content length:",
      content.length,
      "tools:",
      tools.length,
      "blocks:",
      blocks.length
    );

    // Step 1: Add the completed message to the messages array
    if (content || tools.length > 0 || blocks.length > 0) {
      console.log("[useStreamingMessages] Adding message to messages array");
      const newMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: content,
        toolUses: tools.length > 0 ? tools : undefined,
        contentBlocks: blocks.length > 0 ? blocks : undefined,
      };

      const currentMessages = messages();
      const newMessages = [...currentMessages, newMessage];
      setMessages(newMessages);
      console.log("[useStreamingMessages] Message added, new count:", newMessages.length);
    }

    // Step 2: Set isLoading to false - this switches MessageList from streaming to messages
    setIsLoading(false);
    console.log("[useStreamingMessages] isLoading set to false");

    // Step 3: Clear streaming state (safe because isLoading is false now)
    setStreamingContent("");
    setStreamingThinking("");
    setCurrentToolUses([]);
    setStreamingBlocks([]);
    toolInputRef.current = "";
    console.log("[useStreamingMessages] Streaming state cleared, messages count:", messages().length);

    // Call the onFinish callback if provided
    options.onFinish?.();
  };

  /**
   * Reset streaming state for a new message submission.
   * Called at the start of handleSubmit.
   */
  const resetStreamingState = () => {
    setError(null);
    setIsLoading(true);
    setCurrentToolUses([]);
    setStreamingBlocks([]);
    setStreamingContent("");
    toolInputRef.current = "";
  };

  return {
    // Message signals
    messages,
    setMessages,
    streamingContent,
    setStreamingContent,
    isLoading,
    setIsLoading,
    error,
    setError,

    // Tool state
    currentToolUses,
    setCurrentToolUses,

    // Block state
    streamingBlocks,
    setStreamingBlocks,

    // Thinking state
    streamingThinking,
    setStreamingThinking,
    showThinking,
    setShowThinking,

    // Mutable refs
    toolInputRef,
    todoJsonRef,
    questionJsonRef,
    isCollectingTodoRef,
    isCollectingQuestionRef,
    pendingResultsRef,

    // Actions
    generateId,
    finishStreaming,
    resetStreamingState,
  };
}
