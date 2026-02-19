import { describe, it, expect } from "vitest";
import { normalizeClaudeEvent } from "../lib/claude-event-normalizer";
import type { ClaudeEvent } from "../lib/tauri";

describe("normalizeClaudeEvent", () => {
  // ==========================================================================
  // Status Events
  // ==========================================================================
  describe("status events", () => {
    it("should normalize snake_case compaction fields", () => {
      const raw: ClaudeEvent = {
        type: "status",
        message: "Compaction complete",
        is_compaction: true,
        pre_tokens: 150000,
        post_tokens: 35000,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "status",
        message: "Compaction complete",
        isCompaction: true,
        preTokens: 150000,
        postTokens: 35000,
      });
    });

    it("should normalize camelCase compaction fields", () => {
      const raw: ClaudeEvent = {
        type: "status",
        message: "Compaction complete",
        isCompaction: true,
        preTokens: 150000,
        postTokens: 35000,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "status",
        message: "Compaction complete",
        isCompaction: true,
        preTokens: 150000,
        postTokens: 35000,
      });
    });

    it("should prefer snake_case when both variants present", () => {
      const raw: ClaudeEvent = {
        type: "status",
        message: "test",
        is_compaction: true,
        isCompaction: false, // Should be ignored
        pre_tokens: 100,
        preTokens: 200, // Should be ignored
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("status");
      if (normalized.type === "status") {
        expect(normalized.isCompaction).toBe(true);
        expect(normalized.preTokens).toBe(100);
      }
    });

    it("should apply defaults for missing fields", () => {
      const raw: ClaudeEvent = {
        type: "status",
        message: "Processing...",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "status",
        message: "Processing...",
        isCompaction: false,
        preTokens: 0,
        postTokens: 0,
      });
    });

    it("should default empty message", () => {
      const raw: ClaudeEvent = {
        type: "status",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("status");
      if (normalized.type === "status") {
        expect(normalized.message).toBe("");
      }
    });
  });

  // ==========================================================================
  // Ready Events
  // ==========================================================================
  describe("ready events", () => {
    it("should normalize session_id to sessionId", () => {
      const raw: ClaudeEvent = {
        type: "ready",
        session_id: "sess-123",
        model: "opus",
        tools: 50,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "ready",
        sessionId: "sess-123",
        model: "opus",
        tools: 50,
      });
    });

    it("should accept camelCase sessionId", () => {
      const raw: ClaudeEvent = {
        type: "ready",
        sessionId: "sess-456",
        model: "sonnet",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("ready");
      if (normalized.type === "ready") {
        expect(normalized.sessionId).toBe("sess-456");
      }
    });

    it("should prefer snake_case session_id", () => {
      const raw: ClaudeEvent = {
        type: "ready",
        session_id: "snake",
        sessionId: "camel",
        model: "opus",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("ready");
      if (normalized.type === "ready") {
        expect(normalized.sessionId).toBe("snake");
      }
    });

    it("should default tools to 0", () => {
      const raw: ClaudeEvent = {
        type: "ready",
        model: "opus",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("ready");
      if (normalized.type === "ready") {
        expect(normalized.tools).toBe(0);
      }
    });
  });

  // ==========================================================================
  // Permission Request Events
  // ==========================================================================
  describe("permission_request events", () => {
    it("should normalize all snake_case fields", () => {
      const raw: ClaudeEvent = {
        type: "permission_request",
        request_id: "req-123",
        tool_name: "Bash",
        tool_input: { command: "ls -la" },
        description: "Run command",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "permission_request",
        requestId: "req-123",
        toolName: "Bash",
        toolInput: { command: "ls -la" },
        description: "Run command",
      });
    });

    it("should normalize all camelCase fields", () => {
      const raw: ClaudeEvent = {
        type: "permission_request",
        requestId: "req-456",
        toolName: "Write",
        toolInput: { file_path: "/test.txt" },
        description: "Write file",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "permission_request",
        requestId: "req-456",
        toolName: "Write",
        toolInput: { file_path: "/test.txt" },
        description: "Write file",
      });
    });

    it("should prefer snake_case for all dual fields", () => {
      const raw: ClaudeEvent = {
        type: "permission_request",
        request_id: "snake-req",
        requestId: "camel-req",
        tool_name: "SnakeTool",
        toolName: "CamelTool",
        tool_input: { snake: true },
        toolInput: { camel: true },
        description: "test",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("permission_request");
      if (normalized.type === "permission_request") {
        expect(normalized.requestId).toBe("snake-req");
        expect(normalized.toolName).toBe("SnakeTool");
        expect(normalized.toolInput).toEqual({ snake: true });
      }
    });

    it("should apply defaults for missing fields", () => {
      const raw: ClaudeEvent = {
        type: "permission_request",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "permission_request",
        requestId: "",
        toolName: "unknown",
        toolInput: undefined,
        description: "",
      });
    });
  });

  // ==========================================================================
  // Tool Result Events
  // ==========================================================================
  describe("tool_result events", () => {
    it("should normalize is_error to isError", () => {
      const raw: ClaudeEvent = {
        type: "tool_result",
        tool_use_id: "tool-123",
        stdout: "",
        stderr: "Command failed",
        is_error: true,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "tool_result",
        toolUseId: "tool-123",
        stdout: "",
        stderr: "Command failed",
        isError: true,
      });
    });

    it("should accept camelCase isError", () => {
      const raw: ClaudeEvent = {
        type: "tool_result",
        tool_use_id: "tool-456",
        stdout: "success",
        isError: false,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("tool_result");
      if (normalized.type === "tool_result") {
        expect(normalized.isError).toBe(false);
      }
    });

    it("should prefer snake_case is_error", () => {
      const raw: ClaudeEvent = {
        type: "tool_result",
        tool_use_id: "tool-789",
        is_error: true,
        isError: false, // Should be ignored
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("tool_result");
      if (normalized.type === "tool_result") {
        expect(normalized.isError).toBe(true);
      }
    });

    it("should apply defaults for missing fields", () => {
      const raw: ClaudeEvent = {
        type: "tool_result",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "tool_result",
        toolUseId: undefined,
        stdout: "",
        stderr: "",
        isError: false,
      });
    });
  });

  // ==========================================================================
  // Context Update Events
  // ==========================================================================
  describe("context_update events", () => {
    it("should normalize all snake_case token fields", () => {
      const raw: ClaudeEvent = {
        type: "context_update",
        input_tokens: 50000,
        raw_input_tokens: 30000,
        cache_read: 20000,
        cache_write: 5000,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "context_update",
        inputTokens: 50000,
        rawInputTokens: 30000,
        cacheRead: 20000,
        cacheWrite: 5000,
      });
    });

    it("should normalize all camelCase token fields", () => {
      const raw: ClaudeEvent = {
        type: "context_update",
        inputTokens: 60000,
        rawInputTokens: 35000,
        cacheRead: 25000,
        cacheWrite: 6000,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "context_update",
        inputTokens: 60000,
        rawInputTokens: 35000,
        cacheRead: 25000,
        cacheWrite: 6000,
      });
    });

    it("should prefer snake_case for all fields", () => {
      const raw: ClaudeEvent = {
        type: "context_update",
        input_tokens: 100,
        inputTokens: 200,
        cache_read: 10,
        cacheRead: 20,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("context_update");
      if (normalized.type === "context_update") {
        expect(normalized.inputTokens).toBe(100);
        expect(normalized.cacheRead).toBe(10);
      }
    });

    it("should apply defaults for missing fields", () => {
      const raw: ClaudeEvent = {
        type: "context_update",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "context_update",
        inputTokens: 0,
        rawInputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
      });
    });
  });

  // ==========================================================================
  // Result Events
  // ==========================================================================
  describe("result events", () => {
    it("should normalize output_tokens to outputTokens", () => {
      const raw: ClaudeEvent = {
        type: "result",
        output_tokens: 500,
        input_tokens: 50000,
        cache_read: 20000,
        cache_write: 5000,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("result");
      if (normalized.type === "result") {
        expect(normalized.outputTokens).toBe(500);
        expect(normalized.inputTokens).toBe(50000);
        expect(normalized.cacheRead).toBe(20000);
        expect(normalized.cacheWrite).toBe(5000);
      }
    });

    it("should accept camelCase outputTokens", () => {
      const raw: ClaudeEvent = {
        type: "result",
        outputTokens: 600,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("result");
      if (normalized.type === "result") {
        expect(normalized.outputTokens).toBe(600);
      }
    });

    it("should prefer snake_case output_tokens", () => {
      const raw: ClaudeEvent = {
        type: "result",
        output_tokens: 100,
        outputTokens: 200,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("result");
      if (normalized.type === "result") {
        expect(normalized.outputTokens).toBe(100);
      }
    });

    it("should preserve optional fields", () => {
      const raw: ClaudeEvent = {
        type: "result",
        content: "Response content",
        cost: 0.05,
        duration: 1500,
        turns: 3,
        output_tokens: 500,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("result");
      if (normalized.type === "result") {
        expect(normalized.content).toBe("Response content");
        expect(normalized.cost).toBe(0.05);
        expect(normalized.duration).toBe(1500);
        expect(normalized.turns).toBe(3);
      }
    });
  });

  // ==========================================================================
  // Subagent Events
  // ==========================================================================
  describe("subagent events", () => {
    describe("subagent_start", () => {
      it("should normalize agent_type to agentType", () => {
        const raw: ClaudeEvent = {
          type: "subagent_start",
          id: "task-123",
          agent_type: "Explore",
          description: "Exploring codebase",
        };

        const normalized = normalizeClaudeEvent(raw);

        expect(normalized).toEqual({
          type: "subagent_start",
          id: "task-123",
          agentType: "Explore",
          description: "Exploring codebase",
        });
      });

      it("should apply defaults", () => {
        const raw: ClaudeEvent = {
          type: "subagent_start",
        };

        const normalized = normalizeClaudeEvent(raw);

        expect(normalized).toEqual({
          type: "subagent_start",
          id: "",
          agentType: "unknown",
          description: "",
        });
      });
    });

    describe("subagent_progress", () => {
      it("should normalize all fields", () => {
        const raw: ClaudeEvent = {
          type: "subagent_progress",
          subagent_id: "task-123",
          tool_name: "Grep",
          tool_detail: "searching for pattern",
          tool_count: 5,
        };

        const normalized = normalizeClaudeEvent(raw);

        expect(normalized).toEqual({
          type: "subagent_progress",
          subagentId: "task-123",
          toolName: "Grep",
          toolDetail: "searching for pattern",
          toolCount: 5,
        });
      });

      it("should prefer snake_case tool_name", () => {
        const raw: ClaudeEvent = {
          type: "subagent_progress",
          subagent_id: "task-456",
          tool_name: "SnakeTool",
          toolName: "CamelTool",
        };

        const normalized = normalizeClaudeEvent(raw);

        expect(normalized.type).toBe("subagent_progress");
        if (normalized.type === "subagent_progress") {
          expect(normalized.toolName).toBe("SnakeTool");
        }
      });
    });

    describe("subagent_end", () => {
      it("should normalize all fields", () => {
        const raw: ClaudeEvent = {
          type: "subagent_end",
          id: "task-123",
          agent_type: "Explore",
          duration: 5000,
          tool_count: 10,
          result: "Found 5 files",
        };

        const normalized = normalizeClaudeEvent(raw);

        expect(normalized).toEqual({
          type: "subagent_end",
          id: "task-123",
          agentType: "Explore",
          duration: 5000,
          toolCount: 10,
          result: "Found 5 files",
        });
      });
    });
  });

  // ==========================================================================
  // Background Task Events
  // ==========================================================================
  describe("bg_task events", () => {
    it("should normalize bg_task_registered", () => {
      const raw: ClaudeEvent = {
        type: "bg_task_registered",
        task_id: "task-123",
        tool_use_id: "tool-123",
        agent_type: "Explore",
        description: "Investigate bug",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "bg_task_registered",
        taskId: "task-123",
        toolUseId: "tool-123",
        agentType: "Explore",
        description: "Investigate bug",
      });
    });

    it("should normalize bg_task_completed", () => {
      const raw: ClaudeEvent = {
        type: "bg_task_completed",
        taskId: "task-123",
        toolUseId: "tool-123",
        agent_type: "Plan",
        duration: 4200,
        tool_count: 7,
        summary: "Summary text",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "bg_task_completed",
        taskId: "task-123",
        toolUseId: "tool-123",
        agentType: "Plan",
        duration: 4200,
        toolCount: 7,
        summary: "Summary text",
      });
    });

    it("should normalize bg_task_result with defaults", () => {
      const raw: ClaudeEvent = {
        type: "bg_task_result",
        taskId: "task-abc",
        result: "Final output",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "bg_task_result",
        taskId: "task-abc",
        toolUseId: undefined,
        result: "Final output",
        status: "completed",
        agentType: "unknown",
        duration: 0,
        toolCount: 0,
      });
    });
  });

  // ==========================================================================
  // Simple Events (no dual fields)
  // ==========================================================================
  describe("simple events", () => {
    it("should normalize text_delta", () => {
      const raw: ClaudeEvent = {
        type: "text_delta",
        text: "Hello, world!",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "text_delta",
        text: "Hello, world!",
      });
    });

    it("should normalize thinking_delta", () => {
      const raw: ClaudeEvent = {
        type: "thinking_delta",
        thinking: "Let me think...",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "thinking_delta",
        thinking: "Let me think...",
      });
    });

    it("should normalize tool_start", () => {
      const raw: ClaudeEvent = {
        type: "tool_start",
        id: "tool-123",
        name: "Read",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "tool_start",
        id: "tool-123",
        name: "Read",
      });
    });

    it("should normalize tool_input", () => {
      const raw: ClaudeEvent = {
        type: "tool_input",
        json: '{"file_path":"/test.txt"}',
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "tool_input",
        json: '{"file_path":"/test.txt"}',
      });
    });

    it("should normalize tool_pending", () => {
      const raw: ClaudeEvent = {
        type: "tool_pending",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "tool_pending",
      });
    });

    it("should normalize block_end", () => {
      const raw: ClaudeEvent = {
        type: "block_end",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "block_end",
      });
    });

    it("should normalize done", () => {
      const raw: ClaudeEvent = {
        type: "done",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "done",
      });
    });

    it("should normalize closed", () => {
      const raw: ClaudeEvent = {
        type: "closed",
        code: 1,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "closed",
        code: 1,
      });
    });

    it("should normalize error", () => {
      const raw: ClaudeEvent = {
        type: "error",
        message: "Connection failed",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "error",
        message: "Connection failed",
      });
    });

    it("should default error message", () => {
      const raw: ClaudeEvent = {
        type: "error",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "error",
        message: "Unknown error",
      });
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe("edge cases", () => {
    it("should handle empty strings", () => {
      const raw: ClaudeEvent = {
        type: "text_delta",
        text: "",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "text_delta",
        text: "",
      });
    });

    it("should handle undefined values by applying defaults", () => {
      const raw: ClaudeEvent = {
        type: "context_update",
        input_tokens: undefined,
        cache_read: undefined,
      } as unknown as ClaudeEvent;

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("context_update");
      if (normalized.type === "context_update") {
        expect(normalized.inputTokens).toBe(0);
        expect(normalized.cacheRead).toBe(0);
      }
    });

    it("should handle zero values correctly (not falsy)", () => {
      const raw: ClaudeEvent = {
        type: "context_update",
        input_tokens: 0,
        cache_read: 0,
        cache_write: 0,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("context_update");
      if (normalized.type === "context_update") {
        expect(normalized.inputTokens).toBe(0);
        expect(normalized.cacheRead).toBe(0);
        expect(normalized.cacheWrite).toBe(0);
      }
    });

    it("should handle false boolean values correctly (not falsy)", () => {
      const raw: ClaudeEvent = {
        type: "status",
        message: "test",
        is_compaction: false,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized.type).toBe("status");
      if (normalized.type === "status") {
        expect(normalized.isCompaction).toBe(false);
      }
    });

    it("should handle processing events", () => {
      const raw: ClaudeEvent = {
        type: "processing",
        prompt: "Hello Claude",
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "processing",
        prompt: "Hello Claude",
      });
    });

    it("should handle thinking_start events", () => {
      const raw: ClaudeEvent = {
        type: "thinking_start",
        index: 0,
      };

      const normalized = normalizeClaudeEvent(raw);

      expect(normalized).toEqual({
        type: "thinking_start",
        index: 0,
      });
    });
  });
});
