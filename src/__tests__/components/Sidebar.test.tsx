import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { describe, it, expect, vi, afterEach } from "vitest";
import Sidebar from "../../components/Sidebar";
import type { SessionEntry } from "../../lib/types";

describe("Sidebar", () => {
  afterEach(() => {
    cleanup();
  });

  // Sample sessions for testing
  const sampleSessions: SessionEntry[] = [
    {
      sessionId: "session-1",
      fullPath: "/path/to/session-1.jsonl",
      fileMtime: Date.now(),
      firstPrompt: "Help me with a bug fix",
      messageCount: 5,
      created: "2024-01-15T10:00:00Z",
      modified: "2024-01-15T11:00:00Z",
      gitBranch: "main",
      projectPath: "/project",
      isSidechain: false,
    },
    {
      sessionId: "session-2",
      fullPath: "/path/to/session-2.jsonl",
      fileMtime: Date.now() - 100000,
      firstPrompt: "Add a new feature",
      messageCount: 10,
      created: "2024-01-14T10:00:00Z",
      modified: "2024-01-14T12:00:00Z",
      gitBranch: "feature/new",
      projectPath: "/project",
      isSidechain: false,
    },
  ];

  const defaultProps = {
    collapsed: false,
    onToggle: vi.fn(),
    sessions: sampleSessions,
    currentSessionId: null,
    launchSessionId: null,
    isLoading: false,
    error: null,
    onResume: vi.fn(),
    onDelete: vi.fn(),
    onNewSession: vi.fn(),
    onReturnToOriginal: vi.fn(),
  };

  // ============================================================================
  // Rendering
  // ============================================================================

  describe("rendering", () => {
    it("should render the Sessions header", () => {
      render(() => <Sidebar {...defaultProps} />);
      expect(screen.getByText("Sessions")).toBeInTheDocument();
    });

    it("should render session count", () => {
      render(() => <Sidebar {...defaultProps} />);
      expect(screen.getByText("2")).toBeInTheDocument();
    });

    it("should render New Session button", () => {
      render(() => <Sidebar {...defaultProps} />);
      expect(screen.getByText("New Session")).toBeInTheDocument();
    });

    it("should apply collapsed class when collapsed=true", () => {
      render(() => <Sidebar {...defaultProps} collapsed={true} />);
      const sidebar = document.querySelector(".sidebar");
      expect(sidebar).toHaveClass("collapsed");
    });

    it("should NOT apply collapsed class when collapsed=false", () => {
      render(() => <Sidebar {...defaultProps} collapsed={false} />);
      const sidebar = document.querySelector(".sidebar");
      expect(sidebar).not.toHaveClass("collapsed");
    });
  });

  // ============================================================================
  // Loading State
  // ============================================================================

  describe("loading state", () => {
    it("should show loading spinner when isLoading=true", () => {
      render(() => <Sidebar {...defaultProps} isLoading={true} sessions={[]} />);
      expect(screen.getByText("Loading sessions...")).toBeInTheDocument();
    });

    it("should show loading spinner icon", () => {
      render(() => <Sidebar {...defaultProps} isLoading={true} sessions={[]} />);
      expect(screen.getByText("◌")).toBeInTheDocument();
    });

    it("should NOT show session list when loading", () => {
      render(() => <Sidebar {...defaultProps} isLoading={true} />);
      expect(screen.queryByText("Help me with a bug fix")).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Error State
  // ============================================================================

  describe("error state", () => {
    it("should show error message when error is set", () => {
      render(() => (
        <Sidebar {...defaultProps} error="Network error" sessions={[]} />
      ));
      expect(screen.getByText("Failed to load sessions")).toBeInTheDocument();
    });

    it("should show error details", () => {
      render(() => (
        <Sidebar {...defaultProps} error="Connection timeout" sessions={[]} />
      ));
      expect(screen.getByText("Connection timeout")).toBeInTheDocument();
    });

    it("should NOT show error when loading", () => {
      render(() => (
        <Sidebar {...defaultProps} isLoading={true} error="Some error" sessions={[]} />
      ));
      expect(screen.queryByText("Failed to load sessions")).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Empty State
  // ============================================================================

  describe("empty state", () => {
    it("should show empty state when no sessions", () => {
      render(() => <Sidebar {...defaultProps} sessions={[]} />);
      expect(screen.getByText("No previous sessions")).toBeInTheDocument();
    });

    it("should show empty state hint", () => {
      render(() => <Sidebar {...defaultProps} sessions={[]} />);
      expect(screen.getByText("Your conversations will appear here")).toBeInTheDocument();
    });

    it("should NOT show empty state when sessions exist", () => {
      render(() => <Sidebar {...defaultProps} />);
      expect(screen.queryByText("No previous sessions")).not.toBeInTheDocument();
    });

    it("should NOT show empty state when loading", () => {
      render(() => <Sidebar {...defaultProps} isLoading={true} sessions={[]} />);
      expect(screen.queryByText("No previous sessions")).not.toBeInTheDocument();
    });

    it("should NOT show empty state when error", () => {
      render(() => <Sidebar {...defaultProps} error="Error" sessions={[]} />);
      expect(screen.queryByText("No previous sessions")).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Session List
  // ============================================================================

  describe("session list", () => {
    it("should render session items", () => {
      render(() => <Sidebar {...defaultProps} />);
      // SessionItem component should render the firstPrompt
      expect(screen.getByText("Help me with a bug fix")).toBeInTheDocument();
      expect(screen.getByText("Add a new feature")).toBeInTheDocument();
    });

    it("should NOT render session list when loading", () => {
      render(() => <Sidebar {...defaultProps} isLoading={true} />);
      expect(screen.queryByText("Help me with a bug fix")).not.toBeInTheDocument();
    });

    it("should NOT render session list when error", () => {
      render(() => <Sidebar {...defaultProps} error="Error" />);
      expect(screen.queryByText("Help me with a bug fix")).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // New Session Button
  // ============================================================================

  describe("new session button", () => {
    it("should call onNewSession when clicked", () => {
      const onNewSession = vi.fn();
      render(() => <Sidebar {...defaultProps} onNewSession={onNewSession} />);

      fireEvent.click(screen.getByText("New Session"));

      expect(onNewSession).toHaveBeenCalledTimes(1);
    });

    it("should show + icon", () => {
      render(() => <Sidebar {...defaultProps} />);
      expect(screen.getByText("+")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Original Session Button
  // ============================================================================

  describe("original session button", () => {
    it("should NOT show when no launch session", () => {
      render(() => (
        <Sidebar {...defaultProps} launchSessionId={null} currentSessionId="session-1" />
      ));
      expect(screen.queryByText("Original Session")).not.toBeInTheDocument();
    });

    it("should NOT show when no current session", () => {
      render(() => (
        <Sidebar {...defaultProps} launchSessionId="session-1" currentSessionId={null} />
      ));
      expect(screen.queryByText("Original Session")).not.toBeInTheDocument();
    });

    it("should NOT show when current equals launch", () => {
      render(() => (
        <Sidebar {...defaultProps} launchSessionId="session-1" currentSessionId="session-1" />
      ));
      expect(screen.queryByText("Original Session")).not.toBeInTheDocument();
    });

    it("should show when current differs from launch", () => {
      render(() => (
        <Sidebar {...defaultProps} launchSessionId="session-1" currentSessionId="session-2" />
      ));
      expect(screen.getByText("Original Session")).toBeInTheDocument();
    });

    it("should call onReturnToOriginal when clicked", () => {
      const onReturnToOriginal = vi.fn();
      render(() => (
        <Sidebar
          {...defaultProps}
          launchSessionId="session-1"
          currentSessionId="session-2"
          onReturnToOriginal={onReturnToOriginal}
        />
      ));

      fireEvent.click(screen.getByText("Original Session"));

      expect(onReturnToOriginal).toHaveBeenCalledTimes(1);
    });

    it("should show home icon", () => {
      render(() => (
        <Sidebar {...defaultProps} launchSessionId="session-1" currentSessionId="session-2" />
      ));
      expect(screen.getByText("⌂")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Session Sorting
  // ============================================================================

  describe("session sorting", () => {
    it("should mark current session as active", () => {
      render(() => (
        <Sidebar {...defaultProps} currentSessionId="session-2" />
      ));

      // Sessions are sorted by modified date (newest first), not by current status
      // Verify that the current session has the active class
      const sessionItems = document.querySelectorAll(".session-item");
      const activeItems = document.querySelectorAll(".session-item.active");
      expect(activeItems.length).toBe(1);
      expect(sessionItems.length).toBe(2);
    });
  });

  // ============================================================================
  // Session Item Interactions
  // ============================================================================

  describe("session item interactions", () => {
    it("should call onResume when session is clicked", () => {
      const onResume = vi.fn();
      render(() => <Sidebar {...defaultProps} onResume={onResume} />);

      // Click on the session item (via its text)
      fireEvent.click(screen.getByText("Help me with a bug fix"));

      expect(onResume).toHaveBeenCalledWith("session-1");
    });
  });

  // ============================================================================
  // Session Count Display
  // ============================================================================

  describe("session count", () => {
    it("should show 0 when no sessions", () => {
      render(() => <Sidebar {...defaultProps} sessions={[]} />);
      expect(screen.getByText("0")).toBeInTheDocument();
    });

    it("should show correct count", () => {
      const threeSessions = [...sampleSessions, {
        ...sampleSessions[0],
        sessionId: "session-3",
        firstPrompt: "Third session",
      }];
      render(() => <Sidebar {...defaultProps} sessions={threeSessions} />);
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });
});
