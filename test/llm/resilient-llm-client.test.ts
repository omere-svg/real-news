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
  assessImpact: async () => {
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
  discuss: async () => {
    throw new Error('api down');
  },
  routeIntent: async () => {
    throw new Error('api down');
  },
  interpretPrefs: async () => {
    throw new Error('api down');
  },
  reflect: async () => {
    throw new Error('api down');
  },
};

const classifyInput = { title: 't', text: null };
const stub = { title: 't', text: null };

describe('ResilientLLMClient', () => {
  it('passes results through when the delegate succeeds', async () => {
    const llm = new ResilientLLMClient(
      new FakeLLM({ classify: { topic: 'Israel' } }),
    );
    expect(await llm.classify(classifyInput)).toEqual({
      topic: 'Israel',
    });
  });

  it('degrades to safe defaults when the delegate throws', async () => {
    const llm = new ResilientLLMClient(brokenLLM);

    expect(await llm.classify(classifyInput)).toEqual({
      topic: 'Other',
    });
    expect(await llm.confirmSameStory(stub, stub)).toBe(false); // don't merge on uncertainty
    expect(await llm.assessImpact(stub)).toBe(0); // no impact signal on outage
    expect(
      await llm.analyze({
        ...stub,
        topic: 'AI',
        significance: 5,
      }),
    ).toEqual({ summary: '', whyItMatters: '' }); // no analysis rather than a crash
    expect(await llm.narrate({ minutes: 5, brief: 'b' })).toBe(''); // caller falls back to the brief
    expect(await llm.interpretFeedback({ text: 'more ai' })).toEqual({
      topics: [],
      length: null,
      summary: '',
    }); // no-op intent: feedback didn't land, change nothing

    const discussed = await llm.discuss({ question: 'q', history: [], stories: [] });
    expect(discussed.answer).toMatch(/try again/i); // honest non-answer
    expect(discussed.answeredFromNews).toBe(true); // never escalate to web on an error

    expect(await llm.routeIntent({ text: 'give me a brief' })).toEqual({
      action: 'help',
      minutes: null,
      topic: null,
    }); // degrade to the menu when routing can't run

    expect(await llm.interpretPrefs({ text: 'add politics' })).toEqual({
      topics: null,
      minutes: null,
      summary: '',
    }); // no-op patch: the preference edit didn't land, change nothing

    expect(await llm.reflect({ ticks: [] })).toBe(''); // skip the advisory on an outage
  });
});
