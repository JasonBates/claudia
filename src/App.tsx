import { createSignal, onMount, onCleanup, Show, getOwner, runWithOwner, batch } from "solid-js";
import MessageList, { Message, ToolUse, ContentBlock } from "./components/MessageList";
import CommandInput from "./components/CommandInput";
import TodoPanel from "./components/TodoPanel";
import QuestionPanel from "./components/QuestionPanel";
import PlanningBanner from "./components/PlanningBanner";
import PlanApprovalModal from "./components/PlanApprovalModal";
import PermissionDialog from "./components/PermissionDialog";
import { startSession, sendMessage, sendPermissionResponse, pollPermissionRequest, respondToPermission, ClaudeEvent, PermissionRequestFromHook } from "./lib/tauri";
import "./App.css";

interface Todo {
  content: string;
  status: "completed" | "in_progress" | "pending";
  activeForm?: string;
}

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

function App() {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [streamingContent, setStreamingContent] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [sessionActive, setSessionActive] = createSignal(false);
  const [sessionInfo, setSessionInfo] = createSignal<{
    model?: string;
    totalContext?: number;  // Total context used (all input tokens)
    outputTokens?: number;
  }>({});

  const CONTEXT_LIMIT = 200_000;

  let messageIdCounter = 0;
  const generateId = () => `msg-${++messageIdCounter}`;

  // Current tool uses being collected for the streaming message
  const [currentToolUses, setCurrentToolUses] = createSignal<ToolUse[]>([]);
  let currentToolInput = "";

  // Ordered content blocks for proper interleaving of text and tools
  const [streamingBlocks, setStreamingBlocks] = createSignal<ContentBlock[]>([]);
  let currentTextBlockIndex = -1;  // Index of current text block being streamed

  // TodoWrite tracking for real-time display
  const [currentTodos, setCurrentTodos] = createSignal<Todo[]>([]);
  const [showTodoPanel, setShowTodoPanel] = createSignal(false);
  const [todoPanelHiding, setTodoPanelHiding] = createSignal(false);
  let isCollectingTodoWrite = false;
  let todoWriteJson = "";

  // AskUserQuestion tracking
  const [pendingQuestions, setPendingQuestions] = createSignal<Question[]>([]);
  const [showQuestionPanel, setShowQuestionPanel] = createSignal(false);
  let isCollectingQuestion = false;
  let questionJson = "";

  // Planning mode tracking
  const [isPlanning, setIsPlanning] = createSignal(false);
  const [planFilePath, setPlanFilePath] = createSignal<string | null>(null);
  const [showPlanApproval, setShowPlanApproval] = createSignal(false);
  const [planContent, setPlanContent] = createSignal("");

  // Permission request tracking (control_request with can_use_tool)
  interface PermissionRequest {
    requestId: string;
    toolName: string;
    toolInput?: unknown;
    description: string;
  }
  const [pendingPermission, setPendingPermission] = createSignal<PermissionRequest | null>(null);

  // Mode switching (like Claude Code's Shift+Tab)
  type Mode = "normal" | "plan" | "auto-accept";
  const MODES: Mode[] = ["normal", "plan", "auto-accept"];
  const [currentMode, setCurrentMode] = createSignal<Mode>("normal");

  // Capture SolidJS owner for restoring reactive context in async callbacks
  // This is critical for Tauri channel callbacks, setTimeout, setInterval
  const owner = getOwner();

  const cycleMode = () => {
    const current = currentMode();
    const currentIndex = MODES.indexOf(current);
    const nextIndex = (currentIndex + 1) % MODES.length;
    setCurrentMode(MODES[nextIndex]);
  };

  // Poll for hook-based permission requests
  let permissionPollInterval: number | null = null;

  const startPermissionPolling = () => {
    permissionPollInterval = window.setInterval(async () => {
      try {
        const request = await pollPermissionRequest();
        if (request && !pendingPermission()) {
          console.log("[PERMISSION] Hook request received:", request);

          // In auto-accept mode, immediately approve
          if (currentMode() === "auto-accept") {
            console.log("[PERMISSION] Auto-accepting:", request.tool_name);
            await respondToPermission(true);
            return;
          }

          // Restore SolidJS context for state updates from setInterval
          runWithOwner(owner, () => {
            batch(() => {
              // Show permission dialog
              setPendingPermission({
                requestId: request.tool_use_id,
                toolName: request.tool_name,
                toolInput: request.tool_input,
                description: `Allow ${request.tool_name}?`,
              });
            });
          });
        }
      } catch (e) {
        // Ignore polling errors
      }
    }, 200); // Poll every 200ms
  };

  const stopPermissionPolling = () => {
    if (permissionPollInterval) {
      window.clearInterval(permissionPollInterval);
      permissionPollInterval = null;
    }
  };

  onMount(async () => {
    console.log("[MOUNT] Starting session...");
    try {
      await startSession();
      console.log("[MOUNT] Session started successfully");
      setSessionActive(true);
      startPermissionPolling();
    } catch (e) {
      console.error("[MOUNT] Failed to start session:", e);
      setError(`Failed to start session: ${e}`);
    }
  });

  onCleanup(() => {
    stopPermissionPolling();
  });

  const handleSubmit = async (text: string) => {
    if (isLoading()) return;

    setError(null);
    setIsLoading(true);
    setCurrentToolUses([]);
    currentToolInput = "";

    // Reset streaming blocks
    setStreamingBlocks([]);
    currentTextBlockIndex = -1;

    // Add user message
    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMessage]);

    // Reset streaming content
    setStreamingContent("");

    try {
      console.log("[SUBMIT] Calling sendMessage...");
      await sendMessage(text, handleEvent, owner);
      console.log("[SUBMIT] sendMessage returned");
    } catch (e) {
      console.error("[SUBMIT] Error:", e);
      setError(`Error: ${e}`);
      setIsLoading(false);
    }
  };

  const handleEvent = (event: ClaudeEvent) => {
    const ts = new Date().toISOString().split("T")[1];
    console.log(`[${ts}] Event received:`, event.type, event);

    switch (event.type) {
      case "status":
        // Bridge status - could show in UI
        break;

      case "ready":
        setSessionActive(true);
        setSessionInfo({ model: event.model });
        break;

      case "processing":
        // User message being processed
        break;

      case "text_delta":
        // Streaming text chunk - append to current content
        console.log(`  -> text_delta: "${event.text}"`);

        // If we're receiving text and there are loading tools, mark them as completed
        // (Text after tool_pending means the tool finished executing)
        setCurrentToolUses(prev => {
          const hasLoadingTool = prev.some(t => t.isLoading);
          if (hasLoadingTool) {
            return prev.map(t => ({ ...t, isLoading: false }));
          }
          return prev;
        });
        setStreamingBlocks(prev => {
          let updated = false;
          const blocks = prev.map(block => {
            if (block.type === "tool_use" && block.tool.isLoading) {
              updated = true;
              return { ...block, tool: { ...block.tool, isLoading: false } };
            }
            return block;
          });
          return updated ? blocks : prev;
        });

        // Update legacy streamingContent for backwards compatibility
        setStreamingContent((prev) => {
          const newContent = prev + (event.text || "");

          // Extract plan file path if present (from system-reminder)
          const planMatch = newContent.match(/plan file[^\/]*?(\/[^\s]+\.md)/i);
          if (planMatch && !planFilePath()) {
            setPlanFilePath(planMatch[1]);
          }

          return newContent;
        });

        // Update streamingBlocks with proper ordering
        setStreamingBlocks((prev) => {
          const blocks = [...prev];
          const text = event.text || "";

          // If last block is text, append to it
          if (blocks.length > 0 && blocks[blocks.length - 1].type === "text") {
            const lastBlock = blocks[blocks.length - 1] as { type: "text"; content: string };
            blocks[blocks.length - 1] = { type: "text", content: lastBlock.content + text };
          } else {
            // Create new text block
            blocks.push({ type: "text", content: text });
          }
          currentTextBlockIndex = blocks.length - 1;
          return blocks;
        });
        break;

      case "tool_start":
        // New tool invocation starting
        currentToolInput = "";

        // Special handling for TodoWrite
        if (event.name === "TodoWrite") {
          isCollectingTodoWrite = true;
          todoWriteJson = "";
          setShowTodoPanel(true);
          setTodoPanelHiding(false);
        } else if (event.name === "AskUserQuestion") {
          isCollectingQuestion = true;
          questionJson = "";
        } else if (event.name === "EnterPlanMode") {
          setIsPlanning(true);
          // Don't add to currentToolUses - shown in banner
        } else if (event.name === "ExitPlanMode") {
          // Show plan approval modal
          setShowPlanApproval(true);
          // Don't add to currentToolUses - shown in modal
        } else {
          const newTool: ToolUse = {
            id: event.id || "",
            name: event.name || "unknown",
            input: {},
            isLoading: true,
          };

          // Add to legacy currentToolUses
          setCurrentToolUses(prev => [...prev, newTool]);

          // Add to streamingBlocks for proper ordering
          setStreamingBlocks(prev => [...prev, { type: "tool_use", tool: newTool }]);
        }
        break;

      case "tool_input":
        // Accumulate tool input JSON
        if (isCollectingTodoWrite) {
          todoWriteJson += event.json || "";
          // Try to parse and update todos in real-time
          try {
            const parsed = JSON.parse(todoWriteJson);
            if (parsed.todos && Array.isArray(parsed.todos)) {
              setCurrentTodos(parsed.todos);
            }
          } catch {
            // Incomplete JSON, wait for more chunks
          }
        } else if (isCollectingQuestion) {
          questionJson += event.json || "";
          // Try to parse questions
          try {
            const parsed = JSON.parse(questionJson);
            if (parsed.questions && Array.isArray(parsed.questions)) {
              setPendingQuestions(parsed.questions);
              setShowQuestionPanel(true);
            }
          } catch {
            // Incomplete JSON, wait for more chunks
          }
        } else {
          currentToolInput += event.json || "";
        }
        break;

      case "permission_request":
        // Tool needs permission (control_request with can_use_tool)
        setPendingPermission({
          requestId: event.request_id || "",
          toolName: event.tool_name || "unknown",
          toolInput: event.tool_input,
          description: event.description || "",
        });
        break;

      case "tool_pending":
        // Tool about to execute - try to parse accumulated input
        if (isCollectingTodoWrite) {
          // Final parse for TodoWrite
          try {
            const parsed = JSON.parse(todoWriteJson);
            if (parsed.todos && Array.isArray(parsed.todos)) {
              setCurrentTodos(parsed.todos);
            }
          } catch {
            // Parsing failed
          }
        } else if (isCollectingQuestion) {
          // Final parse for AskUserQuestion
          try {
            const parsed = JSON.parse(questionJson);
            if (parsed.questions && Array.isArray(parsed.questions)) {
              setPendingQuestions(parsed.questions);
              setShowQuestionPanel(true);
            }
          } catch {
            // Parsing failed
          }
        } else if (currentToolUses().length > 0) {
          // Parse tool input - handle empty input gracefully
          let parsedInput: unknown = {};
          if (currentToolInput.trim()) {
            try {
              parsedInput = JSON.parse(currentToolInput);
            } catch {
              parsedInput = { raw: currentToolInput };
            }
          }

          // Update input in currentToolUses
          setCurrentToolUses(prev => {
            const updated = [...prev];
            const lastTool = updated[updated.length - 1];
            lastTool.input = parsedInput;
            return updated;
          });

          // Also update in streamingBlocks
          setStreamingBlocks(prev => {
            const blocks = [...prev];
            // Find last tool_use block
            for (let i = blocks.length - 1; i >= 0; i--) {
              if (blocks[i].type === "tool_use") {
                const toolBlock = blocks[i] as { type: "tool_use"; tool: ToolUse };
                toolBlock.tool.input = parsedInput;
                break;
              }
            }
            return blocks;
          });
        }
        break;

      case "tool_result":
        // Tool finished - update the last tool
        if (isCollectingTodoWrite) {
          isCollectingTodoWrite = false;
          // Don't add to currentToolUses - shown in panel instead
        } else if (isCollectingQuestion) {
          isCollectingQuestion = false;
          // Keep question panel visible until user answers
        } else if (currentToolUses().length > 0) {
          const resultData = {
            result: event.is_error ? `Error: ${event.stderr || event.stdout}` : (event.stdout || event.stderr || ""),
            isLoading: false,
          };

          // Update currentToolUses
          setCurrentToolUses(prev => {
            const updated = [...prev];
            const lastTool = updated[updated.length - 1];
            // Check if this is a Read tool result for the plan file
            if (lastTool.name === "Read" && planFilePath()) {
              const inputPath = (lastTool.input as any)?.file_path || "";
              if (inputPath === planFilePath()) {
                setPlanContent(event.stdout || "");
              }
            }
            lastTool.result = resultData.result;
            lastTool.isLoading = resultData.isLoading;
            return updated;
          });

          // Also update in streamingBlocks
          setStreamingBlocks(prev => {
            const blocks = [...prev];
            // Find last tool_use block
            for (let i = blocks.length - 1; i >= 0; i--) {
              if (blocks[i].type === "tool_use") {
                const toolBlock = blocks[i] as { type: "tool_use"; tool: ToolUse };
                toolBlock.tool.result = resultData.result;
                toolBlock.tool.isLoading = resultData.isLoading;
                break;
              }
            }
            return blocks;
          });
        }
        break;

      case "block_end":
        // Content block ended - nothing special needed
        break;

      case "result":
        console.log("[EVENT] *** RESULT EVENT RECEIVED ***", event);
        // Final result with metadata - track total context usage
        // Total context = input_tokens (which already includes cache_read + cache_creation from bridge)
        const turnContext = event.input_tokens || 0;
        setSessionInfo((prev) => ({
          ...prev,
          totalContext: turnContext, // This is the current context size, not cumulative
          outputTokens: (prev.outputTokens || 0) + (event.output_tokens || 0),
        }));
        console.log("[EVENT] Calling finishStreaming from result");
        finishStreaming();
        break;

      case "done":
        console.log("[EVENT] *** DONE EVENT RECEIVED ***");
        console.log("[EVENT] Calling finishStreaming from done");
        finishStreaming();
        break;

      case "closed":
        setSessionActive(false);
        setError(`Session closed (code ${event.code})`);
        break;

      case "error":
        setError(event.message || "Unknown error");
        finishStreaming();
        break;
    }
  };

  const handleQuestionAnswer = async (answers: Record<string, string>) => {
    // Hide the question panel
    setShowQuestionPanel(false);
    setPendingQuestions([]);

    // Format the answer and send as a follow-up message
    const answerText = Object.entries(answers)
      .map(([q, a]) => a)
      .join(", ");

    // Send the answer as the user's response
    await handleSubmit(answerText);
  };

  const handlePlanApprove = async () => {
    setShowPlanApproval(false);
    setIsPlanning(false);
    setPlanContent("");
    // Don't clear planFilePath yet - might be referenced
    await handleSubmit("I approve this plan. Proceed with implementation.");
  };

  const handlePlanRequestChanges = async (feedback: string) => {
    setShowPlanApproval(false);
    // Stay in planning mode
    await handleSubmit(feedback);
  };

  const handlePlanCancel = async () => {
    setShowPlanApproval(false);
    setIsPlanning(false);
    setPlanContent("");
    setPlanFilePath(null);
    await handleSubmit("Cancel this plan. Let's start over with a different approach.");
  };

  const handlePermissionAllow = async (remember: boolean) => {
    const permission = pendingPermission();
    if (!permission) return;
    setPendingPermission(null);
    // Use hook-based response (writes to file for hook to read)
    await respondToPermission(true);
    console.log("[PERMISSION] Allowed:", permission.toolName);
  };

  const handlePermissionDeny = async () => {
    const permission = pendingPermission();
    if (!permission) return;
    setPendingPermission(null);
    // Use hook-based response (writes to file for hook to read)
    await respondToPermission(false, "User denied permission");
    console.log("[PERMISSION] Denied:", permission.toolName);
  };

  const finishStreaming = () => {
    console.log("[FINISH] finishStreaming called");
    const content = streamingContent();
    const tools = [...currentToolUses()]; // Create copies to avoid reference issues
    const blocks = [...streamingBlocks()];

    console.log("[FINISH] content length:", content.length, "tools:", tools.length, "blocks:", blocks.length);

    // CRITICAL ORDER: Add message to array FIRST, then set isLoading false, then clear streaming
    // This prevents the UI from showing empty state between clearing streaming and showing messages

    // Step 1: Add the completed message to the messages array
    if (content || tools.length > 0 || blocks.length > 0) {
      console.log("[FINISH] Adding message to messages array");
      const newMessage = {
        id: generateId(),
        role: "assistant" as const,
        content: content,
        toolUses: tools.length > 0 ? tools : undefined,
        contentBlocks: blocks.length > 0 ? blocks : undefined,
      };

      const currentMessages = messages();
      const newMessages = [...currentMessages, newMessage];
      setMessages(newMessages);
      console.log("[FINISH] Message added, new count:", newMessages.length);
    }

    // Step 2: Set isLoading to false - this switches MessageList from streaming to messages
    // MessageList uses: isLoading() ? streamingContent() : undefined
    // When isLoading becomes false, it stops looking at streaming state entirely
    setIsLoading(false);
    console.log("[FINISH] isLoading set to false");

    // Step 3: NOW clear streaming state (safe because isLoading is false, so MessageList ignores these)
    setStreamingContent("");
    setCurrentToolUses([]);
    setStreamingBlocks([]);
    currentToolInput = "";
    currentTextBlockIndex = -1;
    console.log("[FINISH] Streaming state cleared, messages count:", messages().length);

    // Auto-hide todo panel after delay
    if (showTodoPanel()) {
      setTodoPanelHiding(true);
      setTimeout(() => {
        // Restore SolidJS context for setTimeout callback
        runWithOwner(owner, () => {
          batch(() => {
            setShowTodoPanel(false);
            setTodoPanelHiding(false);
          });
        });
      }, 2000);
    }
  };

  return (
    <div class="app">
      {/* Drag region for window */}
      <div class="drag-region" data-tauri-drag-region="true"></div>

      {/* Floating status indicator */}
      <div class="status-indicator" classList={{ connected: sessionActive(), disconnected: !sessionActive() }}>
        <Show when={sessionActive()} fallback={<span class="status-icon">⊘</span>}>
          <span class="status-icon">⚡</span>
        </Show>
        <Show when={sessionInfo().totalContext}>
          {(() => {
            const used = sessionInfo().totalContext || 0;
            const percent = Math.min((used / CONTEXT_LIMIT) * 100, 100);
            const usedK = (used / 1000).toFixed(0);
            return (
              <span class="context-mini" classList={{ warning: percent > 70, danger: percent > 90 }}>
                {usedK}k
              </span>
            );
          })()}
        </Show>
      </div>

      {/* Planning Mode Banner */}
      <Show when={isPlanning()}>
        <PlanningBanner planFile={planFilePath()} />
      </Show>

      <Show when={error()}>
        <div class="error-banner">
          {error()}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      </Show>

      <main class="app-main">
        <MessageList
          messages={messages()}
          streamingContent={isLoading() ? streamingContent() : undefined}
          streamingToolUses={isLoading() ? currentToolUses() : undefined}
          streamingBlocks={isLoading() ? streamingBlocks() : undefined}
        />
      </main>

      <footer class="app-footer">
        <CommandInput
          onSubmit={handleSubmit}
          disabled={isLoading() || !sessionActive()}
          placeholder={
            sessionActive()
              ? "Type a message... (Enter to send, Shift+Tab to change mode)"
              : "Starting session..."
          }
          mode={currentMode()}
          onModeChange={cycleMode}
        />
      </footer>

      {/* Floating Todo Panel */}
      <Show when={showTodoPanel() && currentTodos().length > 0}>
        <TodoPanel todos={currentTodos()} hiding={todoPanelHiding()} />
      </Show>

      {/* Question Panel Overlay */}
      <Show when={showQuestionPanel() && pendingQuestions().length > 0}>
        <div class="question-overlay">
          <QuestionPanel
            questions={pendingQuestions()}
            onAnswer={handleQuestionAnswer}
          />
        </div>
      </Show>

      {/* Plan Approval Modal */}
      <Show when={showPlanApproval()}>
        <PlanApprovalModal
          planContent={planContent()}
          planFile={planFilePath()}
          onApprove={handlePlanApprove}
          onRequestChanges={handlePlanRequestChanges}
          onCancel={handlePlanCancel}
        />
      </Show>

      {/* Inline Permission Dialog */}
      <Show when={pendingPermission()}>
        <div class="permission-container">
          <PermissionDialog
            toolName={pendingPermission()!.toolName}
            toolInput={pendingPermission()!.toolInput}
            description={pendingPermission()!.description}
            onAllow={handlePermissionAllow}
            onDeny={handlePermissionDeny}
          />
        </div>
      </Show>
    </div>
  );
}

export default App;
