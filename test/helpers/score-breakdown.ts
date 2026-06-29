import type { ScoreBreakdown, Signals } from '../../src/domain/types.js';

const ZERO_SIGNALS: Signals = {
  points: 0,
  mentions: 0,
  tone: 0,
  sourceWeight: 0.5,
  ageHours: 0,
  corroboration: 1,
};

/** A minimal, valid ScoreBreakdown for fixtures that don't exercise scoring (ADR-0032). */
export function fakeBreakdown(base = 0): ScoreBreakdown {
  return {
    base,
    recencyFactor: 1,
    contributions: [],
    editorialAdjustment: 0,
    signalNudge: 0,
    signals: ZERO_SIGNALS,
  };
}
