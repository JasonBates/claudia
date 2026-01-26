import { describe, it, expect } from 'vitest';
import {
  getContextThreshold,
  formatTokenCount,
  getContextPercentage,
  DEFAULT_CONTEXT_LIMIT,
} from '../lib/context-utils';

describe('context-utils', () => {
  describe('getContextThreshold', () => {
    it('returns "ok" when usage is below 60%', () => {
      expect(getContextThreshold(0)).toBe('ok');
      expect(getContextThreshold(100_000)).toBe('ok'); // 50%
      expect(getContextThreshold(119_999)).toBe('ok'); // just under 60%
    });

    it('returns "warning" when usage is 60-74%', () => {
      expect(getContextThreshold(120_000)).toBe('warning'); // exactly 60%
      expect(getContextThreshold(140_000)).toBe('warning'); // 70%
      expect(getContextThreshold(149_999)).toBe('warning'); // just under 75%
    });

    it('returns "critical" when usage is 75% or more', () => {
      expect(getContextThreshold(150_000)).toBe('critical'); // exactly 75%
      expect(getContextThreshold(180_000)).toBe('critical'); // 90%
      expect(getContextThreshold(200_000)).toBe('critical'); // 100%
      expect(getContextThreshold(250_000)).toBe('critical'); // over limit
    });

    it('uses custom limit when provided', () => {
      const customLimit = 100_000;
      expect(getContextThreshold(50_000, customLimit)).toBe('ok'); // 50%
      expect(getContextThreshold(60_000, customLimit)).toBe('warning'); // 60%
      expect(getContextThreshold(75_000, customLimit)).toBe('critical'); // 75%
    });

    it('handles edge cases gracefully', () => {
      expect(getContextThreshold(0, 0)).toBe('ok'); // zero limit
      expect(getContextThreshold(-100)).toBe('ok'); // negative usage
      expect(getContextThreshold(100, -100)).toBe('ok'); // negative limit
    });

    it('uses DEFAULT_CONTEXT_LIMIT correctly', () => {
      expect(DEFAULT_CONTEXT_LIMIT).toBe(200_000);
    });
  });

  describe('formatTokenCount', () => {
    it('formats thousands with "k" suffix', () => {
      expect(formatTokenCount(1_000)).toBe('1k');
      expect(formatTokenCount(50_000)).toBe('50k');
      expect(formatTokenCount(145_000)).toBe('145k');
      expect(formatTokenCount(200_000)).toBe('200k');
    });

    it('rounds to nearest thousand', () => {
      expect(formatTokenCount(1_499)).toBe('1k');
      expect(formatTokenCount(1_500)).toBe('2k');
      expect(formatTokenCount(145_678)).toBe('146k');
    });

    it('returns "—" for zero, undefined, or negative', () => {
      expect(formatTokenCount(0)).toBe('—');
      expect(formatTokenCount(undefined)).toBe('—');
      expect(formatTokenCount(-100)).toBe('—');
    });

    it('handles small values', () => {
      expect(formatTokenCount(500)).toBe('1k'); // rounds up
      expect(formatTokenCount(100)).toBe('0k'); // rounds down
    });
  });

  describe('getContextPercentage', () => {
    it('calculates percentage correctly', () => {
      expect(getContextPercentage(100_000)).toBe(50);
      expect(getContextPercentage(200_000)).toBe(100);
      expect(getContextPercentage(50_000)).toBe(25);
    });

    it('handles custom limits', () => {
      expect(getContextPercentage(50_000, 100_000)).toBe(50);
      expect(getContextPercentage(75_000, 100_000)).toBe(75);
    });

    it('handles edge cases', () => {
      expect(getContextPercentage(0)).toBe(0);
      expect(getContextPercentage(100, 0)).toBe(0); // zero limit
      expect(getContextPercentage(100, -100)).toBe(0); // negative limit
    });

    it('allows values over 100%', () => {
      expect(getContextPercentage(300_000)).toBe(150);
    });
  });
});
