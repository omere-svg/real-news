import { describe, expect, it } from 'vitest';
import { extractEntities, sharedEntityCount } from '../../src/pipeline/entities.js';

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
});
