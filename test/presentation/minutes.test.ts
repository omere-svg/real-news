import { describe, expect, it } from 'vitest';
import { normalizeMinutes } from '../../src/presentation/minutes.js';

describe('normalizeMinutes', () => {
  it('passes through a valid value within the cap', () => {
    expect(normalizeMinutes(3, 60)).toBe(3);
  });

  it('clamps values above the cap', () => {
    expect(normalizeMinutes(999999, 60)).toBe(60);
  });

  it('floors NaN, Infinity, and non-positive values to a tiny safe budget', () => {
    expect(normalizeMinutes(Number.NaN, 60)).toBe(1);
    expect(normalizeMinutes(Number.POSITIVE_INFINITY, 60)).toBe(60); // Infinity clamps to cap
    expect(normalizeMinutes(0, 60)).toBe(1);
    expect(normalizeMinutes(-5, 60)).toBe(1);
  });
});
