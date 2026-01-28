import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { describe, it, expect, vi, afterEach } from "vitest";
import PermissionDialog from "../../components/PermissionDialog";

describe("PermissionDialog", () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    toolName: "TestTool",
    description: "Test description",
    onAllow: vi.fn(),
    onDeny: vi.fn(),
  };

  // ============================================================================
  // Rendering
  // ============================================================================

  describe("rendering", () => {
    it("should render tool name", () => {
      render(() => <PermissionDialog {...defaultProps} />);
      expect(screen.getByText("TestTool")).toBeInTheDocument();
    });

    it("should render Allow button", () => {
      render(() => <PermissionDialog {...defaultProps} />);
      expect(screen.getByText("Allow")).toBeInTheDocument();
    });

    it("should render Always button", () => {
      render(() => <PermissionDialog {...defaultProps} />);
      expect(screen.getByText("Always")).toBeInTheDocument();
    });

    it("should render Deny button", () => {
      render(() => <PermissionDialog {...defaultProps} />);
      expect(screen.getByText("Deny")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Tool Icons
  // ============================================================================

  describe("tool icons", () => {
    it("should show > icon for Bash tool", () => {
      render(() => <PermissionDialog {...defaultProps} toolName="Bash" />);
      expect(screen.getByText(">")).toBeInTheDocument();
    });

    it("should show > icon for shell tool", () => {
      render(() => <PermissionDialog {...defaultProps} toolName="shell_execute" />);
      expect(screen.getByText(">")).toBeInTheDocument();
    });

    it("should show R icon for Read tool", () => {
      render(() => <PermissionDialog {...defaultProps} toolName="Read" />);
      expect(screen.getByText("R")).toBeInTheDocument();
    });

    it("should show W icon for Write tool", () => {
      render(() => <PermissionDialog {...defaultProps} toolName="Write" />);
      expect(screen.getByText("W")).toBeInTheDocument();
    });

    it("should show W icon for Edit tool", () => {
      render(() => <PermissionDialog {...defaultProps} toolName="Edit" />);
      expect(screen.getByText("W")).toBeInTheDocument();
    });

    it("should show ? icon for Glob tool", () => {
      render(() => <PermissionDialog {...defaultProps} toolName="Glob" />);
      expect(screen.getByText("?")).toBeInTheDocument();
    });

    it("should show ? icon for Grep tool", () => {
      render(() => <PermissionDialog {...defaultProps} toolName="Grep" />);
      expect(screen.getByText("?")).toBeInTheDocument();
    });

    it("should show * icon for unknown tools", () => {
      render(() => <PermissionDialog {...defaultProps} toolName="UnknownTool" />);
      expect(screen.getByText("*")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Tool Input Display
  // ============================================================================

  describe("tool input display", () => {
    it("should display command from tool input", () => {
      render(() => (
        <PermissionDialog
          {...defaultProps}
          toolInput={{ command: "ls -la" }}
        />
      ));
      expect(screen.getByText("ls -la")).toBeInTheDocument();
    });

    it("should display file_path from tool input", () => {
      render(() => (
        <PermissionDialog
          {...defaultProps}
          toolInput={{ file_path: "/path/to/file.txt" }}
        />
      ));
      expect(screen.getByText("/path/to/file.txt")).toBeInTheDocument();
    });

    it("should display path from tool input", () => {
      render(() => (
        <PermissionDialog
          {...defaultProps}
          toolInput={{ path: "/some/path" }}
        />
      ));
      expect(screen.getByText("/some/path")).toBeInTheDocument();
    });

    it("should display pattern from tool input", () => {
      render(() => (
        <PermissionDialog
          {...defaultProps}
          toolInput={{ pattern: "**/*.ts" }}
        />
      ));
      expect(screen.getByText("**/*.ts")).toBeInTheDocument();
    });

    it("should display string input directly", () => {
      render(() => (
        <PermissionDialog
          {...defaultProps}
          toolInput="raw string input"
        />
      ));
      expect(screen.getByText("raw string input")).toBeInTheDocument();
    });

    it("should NOT display input section when toolInput is undefined", () => {
      render(() => <PermissionDialog {...defaultProps} toolInput={undefined} />);
      // Should only have the tool name, not an input section
      const permissionContent = document.querySelector(".permission-content");
      expect(permissionContent?.children.length).toBe(1); // Only tool name
    });
  });

  // ============================================================================
  // Button Actions
  // ============================================================================

  describe("button actions", () => {
    it("should call onAllow with false when Allow is clicked", () => {
      const onAllow = vi.fn();
      render(() => <PermissionDialog {...defaultProps} onAllow={onAllow} />);

      fireEvent.click(screen.getByText("Allow"));

      expect(onAllow).toHaveBeenCalledWith(false);
      expect(onAllow).toHaveBeenCalledTimes(1);
    });

    it("should call onAllow with true when Always is clicked", () => {
      const onAllow = vi.fn();
      render(() => <PermissionDialog {...defaultProps} onAllow={onAllow} />);

      fireEvent.click(screen.getByText("Always"));

      expect(onAllow).toHaveBeenCalledWith(true);
      expect(onAllow).toHaveBeenCalledTimes(1);
    });

    it("should call onDeny when Deny is clicked", () => {
      const onDeny = vi.fn();
      render(() => <PermissionDialog {...defaultProps} onDeny={onDeny} />);

      fireEvent.click(screen.getByText("Deny"));

      expect(onDeny).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("edge cases", () => {
    it("should handle null toolInput gracefully", () => {
      // Should not throw
      render(() => <PermissionDialog {...defaultProps} toolInput={null} />);
      expect(screen.getByText("TestTool")).toBeInTheDocument();
    });

    it("should handle empty object toolInput", () => {
      render(() => <PermissionDialog {...defaultProps} toolInput={{}} />);
      // Should render without crashing
      expect(screen.getByText("TestTool")).toBeInTheDocument();
    });

    it("should truncate very long JSON input", () => {
      const longInput = { data: "x".repeat(300) };
      render(() => <PermissionDialog {...defaultProps} toolInput={longInput} />);
      // The component truncates to 200 chars, so the full string shouldn't be there
      expect(screen.queryByText("x".repeat(300))).not.toBeInTheDocument();
    });
  });
});
