import { createSignal, Accessor, Setter } from "solid-js";
import { startSession as tauriStartSession, getLaunchDir } from "../lib/tauri";
import type { SessionInfo } from "../lib/event-handlers";

export interface UseSessionReturn {
  // Signals
  sessionActive: Accessor<boolean>;
  setSessionActive: Setter<boolean>;
  launchDir: Accessor<string | null>;
  workingDir: Accessor<string | null>;
  sessionInfo: Accessor<SessionInfo>;
  setSessionInfo: Setter<SessionInfo>;

  // Launch session tracking (for "Original Session" feature)
  launchSessionId: Accessor<string | null>;
  setLaunchSessionId: Setter<string | null>;

  // Actions
  startSession: () => Promise<void>;

  // Error state
  sessionError: Accessor<string | null>;
}

/**
 * Custom hook for managing Claude CLI session lifecycle.
 *
 * Handles:
 * - Session startup with timeout handling
 * - Directory management (launch dir, working dir)
 * - Session info tracking (tokens, model, etc.)
 *
 * Note: Does NOT auto-start the session. Call startSession() in onMount.
 */
export function useSession(): UseSessionReturn {
  const [sessionActive, setSessionActive] = createSignal(false);
  const [launchDir, setLaunchDir] = createSignal<string | null>(null);
  const [workingDir, setWorkingDir] = createSignal<string | null>(null);
  const [sessionInfo, setSessionInfo] = createSignal<SessionInfo>({});
  const [sessionError, setSessionError] = createSignal<string | null>(null);

  // Track the session ID created when the app launches (for "Original Session" feature)
  const [launchSessionId, setLaunchSessionId] = createSignal<string | null>(null);

  // Helper to add timeout to a promise
  const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      )
    ]);
  };

  /**
   * Initialize the session. Should be called in onMount.
   *
   * 1. Gets the launch directory (worktree)
   * 2. Starts the CLI session with a 15s timeout
   * 3. Sets sessionActive to true on success
   */
  const startSession = async (): Promise<void> => {
    console.log("[useSession] Starting session...");
    setSessionError(null);

    try {
      // Get launch directory (worktree) first
      const launch = await getLaunchDir();
      console.log("[useSession] Launch directory:", launch);
      setLaunchDir(launch);

      // Start session with timeout so we don't hang forever on failures
      // Pass launch directory so Claude spawns in the correct working directory
      const dir = await withTimeout(tauriStartSession(launch), 15000, "startSession");
      console.log("[useSession] Session started successfully in:", dir);
      setWorkingDir(dir);
      setSessionActive(true);
    } catch (e) {
      console.error("[useSession] Failed to start session:", e);
      setSessionError(`Failed to start session: ${e}`);
      throw e; // Re-throw so caller can handle if needed
    }
  };

  return {
    sessionActive,
    setSessionActive,
    launchDir,
    workingDir,
    sessionInfo,
    setSessionInfo,
    launchSessionId,
    setLaunchSessionId,
    startSession,
    sessionError,
  };
}
