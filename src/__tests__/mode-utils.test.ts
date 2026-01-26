import { describe, it, expect } from 'vitest';
import {
  getNextMode,
  getPreviousMode,
  isValidMode,
  getModeLabel,
  MODES,
  Mode,
} from '../lib/mode-utils';

describe('mode-utils', () => {
  describe('MODES constant', () => {
    it('contains all three modes in correct order', () => {
      expect(MODES).toEqual(['normal', 'plan', 'auto-accept']);
    });

    it('is readonly (frozen)', () => {
      expect(Object.isFrozen(MODES)).toBe(true);
    });
  });

  describe('getNextMode', () => {
    it('cycles from normal to plan', () => {
      expect(getNextMode('normal')).toBe('plan');
    });

    it('cycles from plan to auto-accept', () => {
      expect(getNextMode('plan')).toBe('auto-accept');
    });

    it('cycles from auto-accept back to normal (wraps)', () => {
      expect(getNextMode('auto-accept')).toBe('normal');
    });

    it('returns first mode for invalid input', () => {
      expect(getNextMode('invalid' as Mode)).toBe('normal');
    });

    it('completes a full cycle correctly', () => {
      let mode: Mode = 'normal';
      mode = getNextMode(mode); // plan
      mode = getNextMode(mode); // auto-accept
      mode = getNextMode(mode); // normal
      expect(mode).toBe('normal');
    });
  });

  describe('getPreviousMode', () => {
    it('cycles from normal back to auto-accept (wraps)', () => {
      expect(getPreviousMode('normal')).toBe('auto-accept');
    });

    it('cycles from plan to normal', () => {
      expect(getPreviousMode('plan')).toBe('normal');
    });

    it('cycles from auto-accept to plan', () => {
      expect(getPreviousMode('auto-accept')).toBe('plan');
    });

    it('returns first mode for invalid input', () => {
      expect(getPreviousMode('invalid' as Mode)).toBe('normal');
    });

    it('is inverse of getNextMode', () => {
      for (const mode of MODES) {
        expect(getPreviousMode(getNextMode(mode))).toBe(mode);
        expect(getNextMode(getPreviousMode(mode))).toBe(mode);
      }
    });
  });

  describe('isValidMode', () => {
    it('returns true for valid modes', () => {
      expect(isValidMode('normal')).toBe(true);
      expect(isValidMode('plan')).toBe(true);
      expect(isValidMode('auto-accept')).toBe(true);
    });

    it('returns false for invalid modes', () => {
      expect(isValidMode('invalid')).toBe(false);
      expect(isValidMode('')).toBe(false);
      expect(isValidMode('NORMAL')).toBe(false); // case sensitive
      expect(isValidMode('Plan')).toBe(false);
    });
  });

  describe('getModeLabel', () => {
    it('returns correct label for normal mode', () => {
      expect(getModeLabel('normal')).toBe('Normal');
    });

    it('returns correct label for plan mode', () => {
      expect(getModeLabel('plan')).toBe('Plan');
    });

    it('returns correct label for auto-accept mode', () => {
      expect(getModeLabel('auto-accept')).toBe('Auto-Accept');
    });
  });
});
