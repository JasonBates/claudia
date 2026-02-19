import { render, screen, cleanup } from "@solidjs/testing-library";
import { describe, it, expect, afterEach } from "vitest";
import ToolResult from "../../components/ToolResult";
import type { SubagentInfo } from "../../lib/types";

describe("ToolResult", () => {
  afterEach(() => {
    cleanup();
  });

  const completeSubagent: SubagentInfo = {
    agentType: "Explore",
    description: "Search codebase",
    status: "complete",
    startTime: Date.now() - 5000,
    duration: 5000,
    nestedTools: [],
    toolCount: 2,
  };

  it("prefers subagent completion text over async launch placeholder", () => {
    render(() => (
      <ToolResult
        name="Task"
        result={"Async agent launched successfully.\nagentId: abc123"}
        subagent={{ ...completeSubagent, result: "Background task completed with findings." }}
      />
    ));

    expect(screen.getByText("Background task completed with findings.")).toBeInTheDocument();
    expect(screen.queryByText(/Async agent launched successfully/)).not.toBeInTheDocument();
  });

  it("keeps full tool result when it is not an async launch placeholder", () => {
    render(() => (
      <ToolResult
        name="Task"
        result={"Detailed final output from task."}
        subagent={{ ...completeSubagent, result: "Short summary" }}
      />
    ));

    expect(screen.getByText("Detailed final output from task.")).toBeInTheDocument();
    expect(screen.queryByText("Short summary")).not.toBeInTheDocument();
  });
});
