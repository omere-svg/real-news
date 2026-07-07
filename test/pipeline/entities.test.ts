import { describe, expect, it } from 'vitest';
import { extractEntities, sharedEntityCount, sharedEntityStats } from '../../src/pipeline/entities.js';

describe('extractEntities (ADR-0036)', () => {
  it('pulls capitalized proper nouns, normalized to lowercase', () => {
    const e = extractEntities('Venezuela earthquake kills hundreds, says Jorge Rodríguez');
    expect(e.has('venezuela')).toBe(true);
    expect(e.has('jorge rodríguez')).toBe(true);
  });

  it('captures short acronyms', () => {
    const e = extractEntities('GLM 5.2 beats Claude in AI benchmarks at OpenAI');
    expect(e.has('glm')).toBe(true);
    expect(e.has('ai')).toBe(true);
    expect(e.has('openai')).toBe(true);
  });

  it('drops common stopwords and sentence-initial filler', () => {
    const e = extractEntities('The latest update on the situation');
    expect(e.has('the')).toBe(false);
    expect(e.has('latest')).toBe(false);
    expect(e.has('update')).toBe(false);
  });

  it('finds the shared entity across two same-event headlines', () => {
    const a = extractEntities('Venezuela earthquakes: death toll rises to 1,400');
    const b = extractEntities("Venezuela in 'critical hours' to find earthquake survivors");
    expect(sharedEntityCount(a, b)).toBeGreaterThanOrEqual(1);
    expect(a.has('venezuela') && b.has('venezuela')).toBe(true);
  });

  it('sharedEntityCount is 0 for disjoint entity sets', () => {
    const a = extractEntities('Knesset passes new budget law');
    const b = extractEntities('SpaceX launches Starship from Texas');
    expect(sharedEntityCount(a, b)).toBe(0);
  });

  it('indexes constituent words of multi-word phrases so phrase boundaries do not block sharing', () => {
    // A greedy Title-Case match ("Western Venezuela") must still share
    // "venezuela" with a headline that names the country alone.
    const a = extractEntities('M7.1 earthquake in Western Venezuela — GDACS Red alert');
    const b = extractEntities('Venezuela earthquake: death toll passes 3,500');
    expect(a.has('venezuela')).toBe(true);
    expect(b.has('venezuela')).toBe(true);
    expect(sharedEntityCount(a, b)).toBeGreaterThanOrEqual(1);
  });

  it('extracts salient numbers (death tolls, magnitudes) as strong shared signals', () => {
    const a = extractEntities('Two earthquakes strike Venezuela, leaving more than 3,500 dead');
    const b = extractEntities('Venezuela earthquake: death toll passes 3,500');
    expect(a.has('3500')).toBe(true);
    expect(b.has('3500')).toBe(true);
    const c = extractEntities('M7.1 earthquake in western Venezuela — GDACS Red alert');
    expect(c.has('7.1')).toBe(true);
  });

  it('ignores bare years and small counts (too ubiquitous to discriminate)', () => {
    const e = extractEntities('In 2026, 3 people met 12 times');
    expect(e.has('2026')).toBe(false);
    expect(e.has('3')).toBe(false);
    expect(e.has('12')).toBe(false);
  });

  it('three cross-outlet phrasings of one disaster all pairwise share >= 2 entities', () => {
    // The regression the judge found: Wikipedia + GDACS + Guardian all covered
    // the same earthquake, yet corroboration stayed 0 (ADR-0036 recall).
    const wikipedia = extractEntities(
      'Two earthquakes strike Venezuela, leaving more than 3,500 people dead and thousands injured.',
    );
    const gdacs = extractEntities('M7.1 earthquake in western Venezuela — GDACS Red alert');
    const guardian = extractEntities('Venezuela earthquake: death toll passes 3,500');
    expect(sharedEntityCount(wikipedia, guardian)).toBeGreaterThanOrEqual(2); // venezuela + 3500
    expect(sharedEntityCount(gdacs, guardian)).toBeGreaterThanOrEqual(1); // venezuela
    expect(sharedEntityCount(wikipedia, gdacs)).toBeGreaterThanOrEqual(1);
  });

  it('sharedEntityStats: numbers alone never anchor a match (ADR-0054 precision)', () => {
    // Two DIFFERENT earthquakes share "magnitude" + "7.1" — the numeric overlap
    // must not count as an anchor; only non-numeric entities may.
    const japan = extractEntities('Magnitude 7.1 earthquake strikes northern Japan');
    const chile = extractEntities('Magnitude 7.1 earthquake hits central Chile');
    const stats = sharedEntityStats(japan, chile);
    // "magnitude" is capitalized sentence-initially → extracted; "7.1" shared.
    expect(stats.total).toBeGreaterThanOrEqual(2);
    // The relaxation logic demands nonNumeric >= 1 AND the confirm guard —
    // here the only safe anchors are generic words; what matters is the split:
    expect(stats.nonNumeric).toBeLessThan(stats.total); // "7.1" counted as numeric
  });

  it('year-like integers through 21xx and sub-1 decimals are not entities', () => {
    const e = extractEntities('By 2101 the 0.25 rate and a 1.5 degree rise');
    expect(e.has('2101')).toBe(false); // year-like beyond 20xx
    expect(e.has('0.25')).toBe(false); // sub-1 decimal (rates)
    expect(e.has('1.5')).toBe(true); // >= 1 decimal still counts
  });

  it('keeps uppercase acronyms WHO and US as entities while lowercase who/us remain stopwords', () => {
    // Uppercase WHO/US (acronyms) should be kept
    const upper = extractEntities('WHO declares outbreak; US responds');
    expect(upper.has('who')).toBe(true);
    expect(upper.has('us')).toBe(true);

    // Lowercase who/us (common words) should be filtered
    const lower = extractEntities('who said this is what the us is doing');
    expect(lower.has('who')).toBe(false);
    expect(lower.has('us')).toBe(false);
  });
});
