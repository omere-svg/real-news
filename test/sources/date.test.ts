import { describe, expect, it } from 'vitest';
import { parseDateOrNull, isoDate } from '../../src/sources/date.js';

describe('parseDateOrNull (ADR-0049)', () => {
  it('returns null for empty/nullish', () => {
    expect(parseDateOrNull('')).toBeNull();
    expect(parseDateOrNull(null)).toBeNull();
    expect(parseDateOrNull(undefined)).toBeNull();
  });

  it('returns null (never NaN) for a truthy-unparseable value', () => {
    expect(parseDateOrNull('not a date')).toBeNull();
    expect(parseDateOrNull('unknown')).toBeNull();
  });

  it('parses a valid ISO date to finite epoch ms', () => {
    const ms = parseDateOrNull('2026-07-07T00:00:00Z');
    expect(ms).toBe(Date.parse('2026-07-07T00:00:00Z'));
    expect(Number.isFinite(ms)).toBe(true);
  });

  it('isoDate renders UTC YYYY-MM-DD', () => {
    expect(isoDate(Date.parse('2026-07-07T15:30:00Z'))).toBe('2026-07-07');
  });
});
