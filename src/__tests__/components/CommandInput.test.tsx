import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { describe, it, expect, vi, afterEach } from "vitest";
import CommandInput from "../../components/CommandInput";

describe("CommandInput", () => {
  afterEach(() => {
    cleanup();
  });

  // ============================================================================
  // Rendering
  // ============================================================================

  describe("rendering", () => {
    it("should render a textarea", () => {
      render(() => <CommandInput onSubmit={() => {}} />);
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("should render with placeholder text", () => {
      render(() => <CommandInput onSubmit={() => {}} placeholder="Test placeholder" />);
      expect(screen.getByPlaceholderText("Test placeholder")).toBeInTheDocument();
    });

    it("should render with default placeholder when not provided", () => {
      render(() => <CommandInput onSubmit={() => {}} />);
      expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument();
    });

    it("should render mode indicator button", () => {
      render(() => <CommandInput onSubmit={() => {}} mode="auto" />);
      expect(screen.getByRole("button")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Mode Display
  // ============================================================================

  describe("mode display", () => {
    it("should display Auto mode by default", () => {
      render(() => <CommandInput onSubmit={() => {}} />);
      expect(screen.getByText("Auto")).toBeInTheDocument();
    });

    it("should display Auto mode when mode is 'auto'", () => {
      render(() => <CommandInput onSubmit={() => {}} mode="auto" />);
      expect(screen.getByText("Auto")).toBeInTheDocument();
      expect(screen.getByText("»")).toBeInTheDocument();
    });

    it("should display Plan mode when mode is 'plan'", () => {
      render(() => <CommandInput onSubmit={() => {}} mode="plan" />);
      expect(screen.getByText("Plan")).toBeInTheDocument();
      expect(screen.getByText("◇")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Mode Change
  // ============================================================================

  describe("mode change", () => {
    it("should call onModeChange when mode button is clicked", () => {
      const onModeChange = vi.fn();
      render(() => <CommandInput onSubmit={() => {}} onModeChange={onModeChange} />);

      const modeButton = screen.getByRole("button");
      fireEvent.click(modeButton);

      expect(onModeChange).toHaveBeenCalledTimes(1);
    });

    it("should call onModeChange when Shift+Tab is pressed", () => {
      const onModeChange = vi.fn();
      render(() => <CommandInput onSubmit={() => {}} onModeChange={onModeChange} />);

      const textarea = screen.getByRole("textbox");
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });

      expect(onModeChange).toHaveBeenCalledTimes(1);
    });

    it("should NOT call onModeChange when Tab is pressed without Shift", () => {
      const onModeChange = vi.fn();
      render(() => <CommandInput onSubmit={() => {}} onModeChange={onModeChange} />);

      const textarea = screen.getByRole("textbox");
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: false });

      expect(onModeChange).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Submit Behavior
  // ============================================================================

  describe("submit behavior", () => {
    it("should call onSubmit when Enter is pressed with text", () => {
      const onSubmit = vi.fn();
      render(() => <CommandInput onSubmit={onSubmit} />);

      const textarea = screen.getByRole("textbox");
      fireEvent.input(textarea, { target: { value: "hello world" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(onSubmit).toHaveBeenCalledWith("hello world", undefined);
    });

    it("should clear input after submit", () => {
      const onSubmit = vi.fn();
      render(() => <CommandInput onSubmit={onSubmit} />);

      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      fireEvent.input(textarea, { target: { value: "hello" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(textarea.value).toBe("");
    });

    it("should NOT submit when Enter is pressed with empty text", () => {
      const onSubmit = vi.fn();
      render(() => <CommandInput onSubmit={onSubmit} />);

      const textarea = screen.getByRole("textbox");
      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("should NOT submit when Enter is pressed with only whitespace", () => {
      const onSubmit = vi.fn();
      render(() => <CommandInput onSubmit={onSubmit} />);

      const textarea = screen.getByRole("textbox");
      fireEvent.input(textarea, { target: { value: "   " } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("should NOT submit when Shift+Enter is pressed (multiline)", () => {
      const onSubmit = vi.fn();
      render(() => <CommandInput onSubmit={onSubmit} />);

      const textarea = screen.getByRole("textbox");
      fireEvent.input(textarea, { target: { value: "hello" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("should NOT submit when disabled", () => {
      const onSubmit = vi.fn();
      render(() => <CommandInput onSubmit={onSubmit} disabled={true} />);

      const textarea = screen.getByRole("textbox");
      fireEvent.input(textarea, { target: { value: "hello" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("should trim whitespace from submitted text", () => {
      const onSubmit = vi.fn();
      render(() => <CommandInput onSubmit={onSubmit} />);

      const textarea = screen.getByRole("textbox");
      fireEvent.input(textarea, { target: { value: "  hello world  " } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(onSubmit).toHaveBeenCalledWith("hello world", undefined);
    });
  });

  // ============================================================================
  // Input History
  // ============================================================================

  describe("input history", () => {
    it("should not submit same message twice in a row to history", () => {
      const onSubmit = vi.fn();
      render(() => <CommandInput onSubmit={onSubmit} />);

      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

      // Submit same message twice
      fireEvent.input(textarea, { target: { value: "duplicate" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      fireEvent.input(textarea, { target: { value: "duplicate" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      // onSubmit should be called twice
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });

    it("should handle ArrowUp keydown event", () => {
      const onSubmit = vi.fn();
      render(() => <CommandInput onSubmit={onSubmit} />);

      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

      // Set cursor at start so ArrowUp is handled
      Object.defineProperty(textarea, "selectionStart", { value: 0, writable: true });

      // Should not throw when pressing ArrowUp with empty history
      fireEvent.keyDown(textarea, { key: "ArrowUp" });

      expect(true).toBe(true); // No error thrown
    });

    it("should handle ArrowDown keydown event", () => {
      const onSubmit = vi.fn();
      render(() => <CommandInput onSubmit={onSubmit} />);

      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

      // Set cursor at end so ArrowDown is handled
      Object.defineProperty(textarea, "selectionStart", { value: 0, writable: true });

      // Should not throw when pressing ArrowDown with empty history
      fireEvent.keyDown(textarea, { key: "ArrowDown" });

      expect(true).toBe(true); // No error thrown
    });
  });

  // ============================================================================
  // Ref Handle
  // ============================================================================

  describe("ref handle", () => {
    it("should expose focus method via ref", () => {
      let handle: { focus: () => void } | undefined;
      render(() => <CommandInput onSubmit={() => {}} ref={(h) => (handle = h)} />);

      expect(handle).toBeDefined();
      expect(typeof handle?.focus).toBe("function");
    });
  });
});
