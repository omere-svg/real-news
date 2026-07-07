import { describe, expect, it } from 'vitest';
import { screenReflectionActions } from '../../src/pipeline/reflection-policy.js';
import type { ReflectionAction } from '../../src/llm/llm-client.js';

/**
 * The policy guard (ADR-0053): the reflection LLM proposes, this deterministic
 * screen disposes — whitelisted types only, magnitudes clamped, unknown
 * sources rejected. Nothing the model says can push a parameter out of bounds.
 */

const CTX = {
  validSources: ['gdelt', 'arxiv'] as const,
  topN: { min: 3, max: 15 },
  maxBackoffTicks: 10,
};

describe('screenReflectionActions', () => {
  it('accepts a well-formed backoff for a known source, clamped to the cap', () => {
    const out = screenReflectionActions(
      [
        { type: 'backoff_source', source: 'gdelt', ticks: 4, reason: 'keeps 429ing' },
        { type: 'backoff_source', source: 'arxiv', ticks: 99, reason: 'flaky' },
      ],
      CTX,
    );
    expect(out.backoffs).toEqual([
      { source: 'gdelt', ticks: 4, reason: 'keeps 429ing' },
      { source: 'arxiv', ticks: 10, reason: 'flaky' }, // clamped to maxBackoffTicks
    ]);
    expect(out.rejected).toEqual([]);
  });

  it('rejects a backoff for a source the pipeline does not run', () => {
    const out = screenReflectionActions(
      [{ type: 'backoff_source', source: 'not-a-source', ticks: 3, reason: 'x' }],
      CTX,
    );
    expect(out.backoffs).toEqual([]);
    expect(out.rejected).toHaveLength(1);
  });

  it('clamps set_deep_analysis_top_n into the guard bounds', () => {
    const low = screenReflectionActions(
      [{ type: 'set_deep_analysis_top_n', value: 1, reason: 'slow ticks' }],
      CTX,
    );
    expect(low.deepAnalysisTopN).toEqual({ value: 3, reason: 'slow ticks' });

    const high = screenReflectionActions(
      [{ type: 'set_deep_analysis_top_n', value: 40, reason: 'healthy' }],
      CTX,
    );
    expect(high.deepAnalysisTopN).toEqual({ value: 15, reason: 'healthy' });
  });

  it('the last top-n proposal wins when the model repeats itself', () => {
    const out = screenReflectionActions(
      [
        { type: 'set_deep_analysis_top_n', value: 5, reason: 'first' },
        { type: 'set_deep_analysis_top_n', value: 8, reason: 'second' },
      ],
      CTX,
    );
    expect(out.deepAnalysisTopN).toEqual({ value: 8, reason: 'second' });
  });

  it('an empty proposal set yields an empty, all-null policy', () => {
    const out = screenReflectionActions([] as ReflectionAction[], CTX);
    expect(out).toEqual({ backoffs: [], deepAnalysisTopN: null, rejected: [] });
  });
});
