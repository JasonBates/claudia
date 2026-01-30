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

/**
 * Model pricing per million tokens (approximate, as of 2025)
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-opus-4-5-20251101": { input: 15, output: 75 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-opus-20240229": { input: 15, output: 75 },
  "claude-3-5-haiku-20241022": { input: 1, output: 5 },
};

// Default pricing if model not found (use sonnet pricing)
const DEFAULT_PRICING = { input: 3, output: 15 };

export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

/**
 * Estimates cost based on token usage and model
 *
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param model - Model name (e.g., "claude-sonnet-4-20250514")
 * @returns Cost estimate in dollars
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): CostEstimate {
  const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}
