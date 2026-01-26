/**
 * SolidJS utility functions for working with reactive context.
 *
 * SolidJS uses an ownership model where reactive primitives (signals, effects)
 * must be created within a reactive context. When using async callbacks like
 * Tauri channel handlers or setTimeout, this context is lost.
 *
 * These utilities help restore the reactive context in such scenarios.
 */

import { Owner, runWithOwner, batch } from "solid-js";

/**
 * Creates a callback wrapper that restores SolidJS reactive context.
 *
 * Use this when you need to update signals from:
 * - Tauri IPC channel callbacks
 * - setTimeout/setInterval callbacks
 * - Promise callbacks
 * - Event listeners
 *
 * @param owner - The Owner captured from getOwner() in a reactive context
 * @returns A function that wraps callbacks to restore reactive context
 *
 * @example
 * ```tsx
 * const owner = getOwner();
 * const withContext = withReactiveContext(owner);
 *
 * // In a Tauri channel callback:
 * channel.onmessage = (event) => {
 *   withContext(() => {
 *     setMessages(prev => [...prev, event.data]);
 *     setIsLoading(false);
 *   });
 * };
 * ```
 */
export function withReactiveContext(owner: Owner | null) {
  return <T>(callback: () => T): T => {
    if (owner) {
      return runWithOwner(owner, () => batch(callback)) as T;
    }
    // Fallback: still batch updates even without owner
    return batch(callback);
  };
}

/**
 * Creates a batched state updater that groups multiple signal updates.
 *
 * This is useful when you need to update multiple signals atomically,
 * preventing unnecessary re-renders between updates.
 *
 * @param owner - The Owner captured from getOwner() in a reactive context
 * @returns A function that batches multiple signal updates
 *
 * @example
 * ```tsx
 * const owner = getOwner();
 * const batchUpdate = createBatchedUpdater(owner);
 *
 * // Update multiple signals atomically:
 * batchUpdate(() => {
 *   setUser(newUser);
 *   setIsLoggedIn(true);
 *   setLastLogin(Date.now());
 * });
 * ```
 */
export function createBatchedUpdater(owner: Owner | null) {
  return withReactiveContext(owner);
}

/**
 * Type-safe wrapper for creating async handlers that preserve reactive context.
 *
 * @param owner - The Owner captured from getOwner()
 * @param handler - The async handler function
 * @returns A wrapped handler that restores context for state updates
 */
export function createAsyncHandler<T extends unknown[], R>(
  owner: Owner | null,
  handler: (...args: T) => R
): (...args: T) => R {
  const withContext = withReactiveContext(owner);
  return (...args: T) => withContext(() => handler(...args));
}
