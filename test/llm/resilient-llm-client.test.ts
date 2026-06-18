import { describe, expect, it } from 'vitest';
import { ResilientLLMClient } from '../../src/llm/resilient-llm-client.js';
import { FakeLLM } from '../helpers/fake-llm.js';
import type { LLMClient } from '../../src/llm/llm-client.js';

/** An LLMClient whose every method rejects — simulates Claude being down. */
const brokenLLM: LLMClient = {
  classify: async () => {
    throw new Error('api down');
  },
  confirmSameStory: async () => {
    throw new Error('api down');
  },
  adjustSignificance: async () => {
    throw new Error('api down');
  },
  analyze: async () => {
    throw new Error('api down');
  },
  narrate: async () => {
    throw new Error('api down');
  },
  interpretFeedback: async () => {
    throw new Error('api down');
  },
};

const classifyInput = { title: 't', text: null };
const stub = { title: 't', text: null };

describe('ResilientLLMClient', () => {
  it('passes results through when the delegate succeeds', async () => {
    const llm = new ResilientLLMClient(
      new FakeLLM({ classify: { region: 'Israel', topic: 'Politics' } }),
    );
    expect(await llm.classify(classifyInput)).toEqual({
      region: 'Israel',
      topic: 'Politics',
    });
  });

  it('degrades to safe defaults when the delegate throws', async () => {
    const llm = new ResilientLLMClient(brokenLLM);

    expect(await llm.classify(classifyInput)).toEqual({
      region: 'World',
      topic: 'Other',
    });
    expect(await llm.confirmSameStory(stub, stub)).toBe(false); // don't merge on uncertainty
    expect(await llm.adjustSignificance({ ...stub, baseScore: 5 })).toBe(0); // no nudge
    expect(
      await llm.analyze({
        ...stub,
        region: 'World',
        topic: 'AI',
        significance: 5,
      }),
    ).toBe(''); // no analysis rather than a crash
    expect(await llm.narrate({ minutes: 5, brief: 'b' })).toBe(''); // caller falls back to the brief
    expect(await llm.interpretFeedback({ text: 'more ai' })).toEqual({
      topics: [],
      regions: [],
      length: null,
      summary: '',
    }); // no-op intent: feedback didn't land, change nothing
  });
});
