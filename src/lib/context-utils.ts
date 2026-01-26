/**
 * Context window utilities for token tracking and threshold calculation
 */

export type ContextThreshold = 'critical' | 'warning' | 'ok';

export const DEFAULT_CONTEXT_LIMIT = 200_000;

/**
 * Calculates the context threshold level based on token usage
 *
 * @param usedTokens - Number of tokens currently used
 * @param limit - Maximum context window size (defaults to 200k)
 * @returns 'critical' if >= 75%, 'warning' if >= 60%, 'ok' otherwise
 */
export function getContextThreshold(
  usedTokens: number,
  limit: number = DEFAULT_CONTEXT_LIMIT
): ContextThreshold {
  if (limit <= 0) return 'ok';

  const percent = (usedTokens / limit) * 100;
  if (percent >= 75) return 'critical';
  if (percent >= 60) return 'warning';
  return 'ok';
}

/**
 * Formats token count as a human-readable string (e.g., "145k")
 *
 * @param tokens - Number of tokens
 * @returns Formatted string like "145k" or "—" if zero/undefined
 */
export function formatTokenCount(tokens: number | undefined): string {
  if (!tokens || tokens <= 0) return '—';
  return `${Math.round(tokens / 1000)}k`;
}

/**
 * Calculates context usage percentage
 *
 * @param usedTokens - Number of tokens currently used
 * @param limit - Maximum context window size
 * @returns Percentage as a number (0-100+)
 */
export function getContextPercentage(
  usedTokens: number,
  limit: number = DEFAULT_CONTEXT_LIMIT
): number {
  if (limit <= 0) return 0;
  return (usedTokens / limit) * 100;
}
