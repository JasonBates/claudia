/**
 * Mode utilities for the Claude Terminal mode switching feature
 * (similar to Claude Code's Shift+Tab functionality)
 */

export type Mode = 'auto' | 'request' | 'plan' | 'bot';

/**
 * Available modes in cycling order
 * Object.freeze ensures runtime immutability (as const is compile-time only)
 *
 * - auto: Auto-approve tool permissions, run without prompts
 * - request: Show permission dialog for each tool use
 * - plan: Prepend planning instruction to prompt (also shows permission dialogs)
 */
export const MODES: readonly Mode[] = Object.freeze(['auto', 'request', 'plan', 'bot'] as const);

/**
 * Gets the next mode in the cycle
 *
 * @param currentMode - The current mode
 * @returns The next mode in the cycle (wraps around)
 */
export function getNextMode(currentMode: Mode): Mode {
  const currentIndex = MODES.indexOf(currentMode);
  if (currentIndex === -1) return MODES[0]; // Fallback to first mode if invalid
  const nextIndex = (currentIndex + 1) % MODES.length;
  return MODES[nextIndex];
}

/**
 * Gets the previous mode in the cycle
 *
 * @param currentMode - The current mode
 * @returns The previous mode in the cycle (wraps around)
 */
export function getPreviousMode(currentMode: Mode): Mode {
  const currentIndex = MODES.indexOf(currentMode);
  if (currentIndex === -1) return MODES[0];
  const prevIndex = (currentIndex - 1 + MODES.length) % MODES.length;
  return MODES[prevIndex];
}

/**
 * Checks if a mode is valid
 *
 * @param mode - The mode string to validate
 * @returns True if the mode is a valid Mode type
 */
export function isValidMode(mode: string): mode is Mode {
  return MODES.includes(mode as Mode);
}

/**
 * Gets a human-readable label for a mode
 *
 * @param mode - The mode to get a label for
 * @returns Display label for the mode
 */
export function getModeLabel(mode: Mode): string {
  switch (mode) {
    case 'auto':
      return 'Auto';
    case 'request':
      return 'Request';
    case 'plan':
      return 'Plan';
    case 'bot':
      return 'BotGuard';
    default:
      return mode;
  }
}
