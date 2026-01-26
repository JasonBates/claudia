import { createSignal, Accessor, onMount, Owner } from "solid-js";
import type { SessionEntry } from "../lib/types";
import { listSessions, deleteSession } from "../lib/tauri";

// ============================================================================
// Types
// ============================================================================

export interface UseSidebarOptions {
  /**
   * SolidJS owner for restoring reactive context in async callbacks.
   */
  owner: Owner | null;

  /**
   * Accessor for the current working directory.
   * Sessions are loaded for this directory.
   */
  workingDir: Accessor<string | null>;
}

export interface UseSidebarReturn {
  // Visibility state
  collapsed: Accessor<boolean>;
  toggleSidebar: () => void;

  // Session data
  sessions: Accessor<SessionEntry[]>;
  isLoading: Accessor<boolean>;
  error: Accessor<string | null>;

  // Actions
  loadSessions: () => Promise<void>;
  handleDeleteSession: (sessionId: string) => Promise<void>;
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = "claudia-sidebar-collapsed";

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Custom hook for managing the session sidebar.
 *
 * Handles:
 * - Sidebar visibility state (collapsed/expanded) with localStorage persistence
 * - Loading sessions from Claude Code's sessions-index.json
 * - Session deletion
 *
 * Sessions are filtered to exclude sidechains (agent sessions) and sorted
 * by modification date (newest first).
 */
export function useSidebar(options: UseSidebarOptions): UseSidebarReturn {
  // Load initial collapsed state from localStorage
  const loadCollapsedState = (): boolean => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === "true";
    } catch {
      return false; // Default to expanded
    }
  };

  // State signals
  const [collapsed, setCollapsed] = createSignal(loadCollapsedState());
  const [sessions, setSessions] = createSignal<SessionEntry[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  /**
   * Toggle sidebar visibility and persist to localStorage.
   */
  const toggleSidebar = (): void => {
    const newState = !collapsed();
    setCollapsed(newState);

    try {
      localStorage.setItem(STORAGE_KEY, String(newState));
    } catch {
      // localStorage might be unavailable
    }

    // Load sessions when expanding if not already loaded
    if (!newState && sessions().length === 0 && !isLoading()) {
      loadSessions();
    }
  };

  /**
   * Load sessions for the current working directory.
   */
  const loadSessions = async (): Promise<void> => {
    const dir = options.workingDir();
    if (!dir) {
      console.log("[SIDEBAR] No working directory, skipping session load");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log("[SIDEBAR] Loading sessions for:", dir);
      const result = await listSessions(dir);
      console.log("[SIDEBAR] Loaded", result.length, "sessions");
      setSessions(result);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error("[SIDEBAR] Failed to load sessions:", errorMsg);
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Delete a session and refresh the list.
   */
  const handleDeleteSession = async (sessionId: string): Promise<void> => {
    const dir = options.workingDir();
    if (!dir) return;

    try {
      console.log("[SIDEBAR] Deleting session:", sessionId);
      await deleteSession(sessionId, dir);

      // Remove from local state immediately for responsive UI
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error("[SIDEBAR] Failed to delete session:", errorMsg);
      setError(errorMsg);
    }
  };

  // Load sessions on mount if sidebar is expanded
  onMount(() => {
    if (!collapsed()) {
      // Small delay to ensure working directory is available
      setTimeout(() => {
        loadSessions();
      }, 100);
    }
  });

  return {
    // Visibility
    collapsed,
    toggleSidebar,

    // Session data
    sessions,
    isLoading,
    error,

    // Actions
    loadSessions,
    handleDeleteSession,
  };
}
