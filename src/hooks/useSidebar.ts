import { createSignal, Accessor, Owner } from "solid-js";
import type { SessionEntry } from "../lib/types";
import { listSessions, deleteSession, getSessionNames, setSessionName, deleteSessionName } from "../lib/tauri";

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
  openSidebar: () => void;

  // Session data
  sessions: Accessor<SessionEntry[]>;
  sessionNames: Accessor<Record<string, string>>;
  isLoading: Accessor<boolean>;
  error: Accessor<string | null>;

  // Actions
  loadSessions: () => Promise<void>;
  handleDeleteSession: (sessionId: string) => Promise<void>;
  handleRenameSession: (sessionId: string, name: string) => Promise<void>;
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
 * - Custom session names (stored separately in Claudia's config)
 *
 * Sessions are filtered to exclude sidechains (agent sessions) and sorted
 * by modification date (newest first).
 */
export function useSidebar(options: UseSidebarOptions): UseSidebarReturn {
  // Always start collapsed - user can open manually
  const loadCollapsedState = (): boolean => {
    return true;
  };

  // State signals
  const [collapsed, setCollapsed] = createSignal(loadCollapsedState());
  const [sessions, setSessions] = createSignal<SessionEntry[]>([]);
  const [sessionNames, setSessionNames] = createSignal<Record<string, string>>({});
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
   * Open the sidebar (used by /resume command).
   */
  const openSidebar = (): void => {
    if (collapsed()) {
      setCollapsed(false);
      try {
        localStorage.setItem(STORAGE_KEY, "false");
      } catch {
        // localStorage might be unavailable
      }
      // Load sessions if not already loaded
      if (sessions().length === 0 && !isLoading()) {
        loadSessions();
      }
    }
  };

  /**
   * Load session names from Claudia's config.
   */
  const loadSessionNames = async (): Promise<void> => {
    try {
      const names = await getSessionNames();
      setSessionNames(names);
    } catch (e) {
      console.error("[SIDEBAR] Failed to load session names:", e);
      // Non-critical error - continue without custom names
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
      // Load sessions and names in parallel
      const [result] = await Promise.all([
        listSessions(dir),
        loadSessionNames(),
      ]);
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

      // Also delete any custom name for this session
      try {
        await deleteSessionName(sessionId);
        setSessionNames((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
      } catch {
        // Ignore errors cleaning up custom name
      }

      // Remove from local state immediately for responsive UI
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error("[SIDEBAR] Failed to delete session:", errorMsg);
      setError(errorMsg);
    }
  };

  /**
   * Rename a session (set or update custom name).
   */
  const handleRenameSession = async (sessionId: string, name: string): Promise<void> => {
    try {
      console.log("[SIDEBAR] Renaming session:", sessionId, "to:", name);
      await setSessionName(sessionId, name);

      // Update local state
      setSessionNames((prev) => {
        const next = { ...prev };
        if (name.trim()) {
          next[sessionId] = name.trim();
        } else {
          delete next[sessionId];
        }
        return next;
      });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error("[SIDEBAR] Failed to rename session:", errorMsg);
      setError(errorMsg);
    }
  };

  // Sessions are loaded when sidebar is opened via openSidebar() or toggleSidebar()
  // No auto-load on mount since sidebar is hidden by default

  return {
    // Visibility
    collapsed,
    toggleSidebar,
    openSidebar,

    // Session data
    sessions,
    sessionNames,
    isLoading,
    error,

    // Actions
    loadSessions,
    handleDeleteSession,
    handleRenameSession,
  };
}
