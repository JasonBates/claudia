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
      expect(MODES).toEqual(['auto', 'request', 'plan']);
    });

    it('is readonly (frozen)', () => {
      expect(Object.isFrozen(MODES)).toBe(true);
    });
  });

  describe('getNextMode', () => {
    it('cycles from auto to request', () => {
      expect(getNextMode('auto')).toBe('request');
    });

    it('cycles from request to plan', () => {
      expect(getNextMode('request')).toBe('plan');
    });

    it('cycles from plan back to auto (wraps)', () => {
      expect(getNextMode('plan')).toBe('auto');
    });

    it('returns first mode for invalid input', () => {
      expect(getNextMode('invalid' as Mode)).toBe('auto');
    });

    it('completes a full cycle correctly', () => {
      let mode: Mode = 'auto';
      mode = getNextMode(mode); // request
      mode = getNextMode(mode); // plan
      mode = getNextMode(mode); // auto
      expect(mode).toBe('auto');
    });
  });

  describe('getPreviousMode', () => {
    it('cycles from auto back to plan (wraps)', () => {
      expect(getPreviousMode('auto')).toBe('plan');
    });

    it('cycles from request to auto', () => {
      expect(getPreviousMode('request')).toBe('auto');
    });

    it('cycles from plan to request', () => {
      expect(getPreviousMode('plan')).toBe('request');
    });

    it('returns first mode for invalid input', () => {
      expect(getPreviousMode('invalid' as Mode)).toBe('auto');
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
      expect(isValidMode('auto')).toBe(true);
      expect(isValidMode('request')).toBe(true);
      expect(isValidMode('plan')).toBe(true);
    });

    it('returns false for invalid modes', () => {
      expect(isValidMode('invalid')).toBe(false);
      expect(isValidMode('')).toBe(false);
      expect(isValidMode('AUTO')).toBe(false); // case sensitive
      expect(isValidMode('Plan')).toBe(false);
      expect(isValidMode('Request')).toBe(false); // case sensitive
      expect(isValidMode('normal')).toBe(false); // old mode name
      expect(isValidMode('auto-accept')).toBe(false); // old mode name
    });
  });

  describe('getModeLabel', () => {
    it('returns correct label for auto mode', () => {
      expect(getModeLabel('auto')).toBe('Auto');
    });

    it('returns correct label for request mode', () => {
      expect(getModeLabel('request')).toBe('Request');
    });

    it('returns correct label for plan mode', () => {
      expect(getModeLabel('plan')).toBe('Plan');
    });
  });
});
