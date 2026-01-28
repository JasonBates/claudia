import { render, screen, cleanup } from "@solidjs/testing-library";
import { describe, it, expect, afterEach } from "vitest";
import TodoPanel from "../../components/TodoPanel";
import type { Todo } from "../../lib/types";

describe("TodoPanel", () => {
  afterEach(() => {
    cleanup();
  });

  // Sample todos for testing
  const sampleTodos: Todo[] = [
    { content: "First task", status: "completed" },
    { content: "Second task", status: "in_progress", activeForm: "Working on second task" },
    { content: "Third task", status: "pending" },
  ];

  // ============================================================================
  // Rendering
  // ============================================================================

  describe("rendering", () => {
    it("should render the Tasks header", () => {
      render(() => <TodoPanel todos={sampleTodos} />);
      expect(screen.getByText("Tasks")).toBeInTheDocument();
    });

    it("should render all todo items", () => {
      render(() => <TodoPanel todos={sampleTodos} />);
      expect(screen.getByText("First task")).toBeInTheDocument();
      // In progress shows activeForm - appears in both list and current section
      expect(screen.getAllByText("Working on second task").length).toBeGreaterThan(0);
      expect(screen.getByText("Third task")).toBeInTheDocument();
    });

    it("should render empty list when no todos", () => {
      render(() => <TodoPanel todos={[]} />);
      expect(screen.getByText("Tasks")).toBeInTheDocument();
      expect(screen.getByText("0/0")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Count Display
  // ============================================================================

  describe("count display", () => {
    it("should show correct completed/total count", () => {
      render(() => <TodoPanel todos={sampleTodos} />);
      // 1 completed out of 3 total
      expect(screen.getByText("1/3")).toBeInTheDocument();
    });

    it("should show 0/0 for empty todos", () => {
      render(() => <TodoPanel todos={[]} />);
      expect(screen.getByText("0/0")).toBeInTheDocument();
    });

    it("should show all completed when all done", () => {
      const allCompleted: Todo[] = [
        { content: "Task 1", status: "completed" },
        { content: "Task 2", status: "completed" },
      ];
      render(() => <TodoPanel todos={allCompleted} />);
      expect(screen.getByText("2/2")).toBeInTheDocument();
    });

    it("should show 0 completed when none done", () => {
      const noneCompleted: Todo[] = [
        { content: "Task 1", status: "pending" },
        { content: "Task 2", status: "in_progress" },
      ];
      render(() => <TodoPanel todos={noneCompleted} />);
      expect(screen.getByText("0/2")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Status Icons
  // ============================================================================

  describe("status icons", () => {
    it("should show checkmark for completed tasks", () => {
      const todos: Todo[] = [{ content: "Done task", status: "completed" }];
      render(() => <TodoPanel todos={todos} />);
      expect(screen.getByText("✓")).toBeInTheDocument();
    });

    it("should show half-circle for in-progress tasks", () => {
      const todos: Todo[] = [{ content: "Working", status: "in_progress" }];
      render(() => <TodoPanel todos={todos} />);
      expect(screen.getByText("◐")).toBeInTheDocument();
    });

    it("should show circle for pending tasks", () => {
      const todos: Todo[] = [{ content: "Waiting", status: "pending" }];
      render(() => <TodoPanel todos={todos} />);
      expect(screen.getByText("○")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Active Form Display
  // ============================================================================

  describe("active form display", () => {
    it("should show activeForm for in_progress tasks when available", () => {
      const todos: Todo[] = [
        { content: "Original content", status: "in_progress", activeForm: "Active form text" },
      ];
      render(() => <TodoPanel todos={todos} />);
      // activeForm appears in both list and current section
      expect(screen.getAllByText("Active form text").length).toBeGreaterThan(0);
    });

    it("should show content for in_progress tasks when no activeForm", () => {
      const todos: Todo[] = [
        { content: "My in progress task", status: "in_progress" },
      ];
      render(() => <TodoPanel todos={todos} />);
      // Content appears in both list and current section when no activeForm
      expect(screen.getAllByText("My in progress task").length).toBeGreaterThan(0);
    });

    it("should show content for completed tasks regardless of activeForm", () => {
      const todos: Todo[] = [
        { content: "Completed content", status: "completed", activeForm: "Should not show" },
      ];
      render(() => <TodoPanel todos={todos} />);
      expect(screen.getByText("Completed content")).toBeInTheDocument();
      expect(screen.queryByText("Should not show")).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Current Task Section
  // ============================================================================

  describe("current task section", () => {
    it("should show current task section when there is an in_progress task", () => {
      const todos: Todo[] = [
        { content: "In progress", status: "in_progress", activeForm: "Currently working" },
      ];
      render(() => <TodoPanel todos={todos} />);

      const currentSection = document.querySelector(".todo-panel-current");
      expect(currentSection).toBeInTheDocument();
      expect(currentSection?.textContent).toBe("Currently working");
    });

    it("should NOT show current task section when no in_progress tasks", () => {
      const todos: Todo[] = [
        { content: "Completed", status: "completed" },
        { content: "Pending", status: "pending" },
      ];
      render(() => <TodoPanel todos={todos} />);

      const currentSection = document.querySelector(".todo-panel-current");
      expect(currentSection).not.toBeInTheDocument();
    });

    it("should show first in_progress task as current", () => {
      const todos: Todo[] = [
        { content: "First active", status: "in_progress", activeForm: "First" },
        { content: "Second active", status: "in_progress", activeForm: "Second" },
      ];
      render(() => <TodoPanel todos={todos} />);

      const currentSection = document.querySelector(".todo-panel-current");
      expect(currentSection?.textContent).toBe("First");
    });
  });

  // ============================================================================
  // Hiding State
  // ============================================================================

  describe("hiding state", () => {
    it("should add hiding class when hiding prop is true", () => {
      render(() => <TodoPanel todos={sampleTodos} hiding={true} />);

      const panel = document.querySelector(".todo-panel");
      expect(panel).toHaveClass("hiding");
    });

    it("should NOT have hiding class when hiding prop is false", () => {
      render(() => <TodoPanel todos={sampleTodos} hiding={false} />);

      const panel = document.querySelector(".todo-panel");
      expect(panel).not.toHaveClass("hiding");
    });

    it("should NOT have hiding class when hiding prop is undefined", () => {
      render(() => <TodoPanel todos={sampleTodos} />);

      const panel = document.querySelector(".todo-panel");
      expect(panel).not.toHaveClass("hiding");
    });
  });

  // ============================================================================
  // CSS Classes
  // ============================================================================

  describe("css classes", () => {
    it("should apply correct status class to todo items", () => {
      render(() => <TodoPanel todos={sampleTodos} />);

      const items = document.querySelectorAll(".todo-panel-item");
      expect(items[0]).toHaveClass("todo-completed");
      expect(items[1]).toHaveClass("todo-in_progress");
      expect(items[2]).toHaveClass("todo-pending");
    });
  });
});
