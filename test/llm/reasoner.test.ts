import { describe, expect, it } from 'vitest';
import { Reasoner } from '../../src/llm/reasoner.js';
import type {
  ChatTransport,
  CompletionOptions,
} from '../../src/llm/chat-transport.js';

interface Call {
  readonly kind: 'text' | 'json';
  readonly prompt: string;
  readonly opts: CompletionOptions;
}

/** A ChatTransport that records calls and returns canned replies. */
class FakeTransport implements ChatTransport {
  readonly calls: Call[] = [];
  constructor(
    private readonly json: unknown = {},
    private readonly text = 'REPLY TEXT',
  ) {}

  async complete(prompt: string, opts: CompletionOptions): Promise<string> {
    this.calls.push({ kind: 'text', prompt, opts });
    return this.text;
  }
  async completeJson(prompt: string, opts: CompletionOptions): Promise<unknown> {
    this.calls.push({ kind: 'json', prompt, opts });
    return this.json;
  }
}

describe('Reasoner', () => {
  it('classify: parses the JSON reply and uses the cheap tier', async () => {
    const t = new FakeTransport({ region: 'Israel', topic: 'Politics' });
    const out = await new Reasoner(t).classify({ title: 'Knesset vote', text: null });

    expect(out).toEqual({ region: 'Israel', topic: 'Politics' });
    expect(t.calls[0]?.kind).toBe('json');
    expect(t.calls[0]?.opts.tier).toBe('cheap');
    expect(t.calls[0]?.prompt).toContain('Knesset vote');
  });

  it('classify: rejects an out-of-vocabulary reply (Zod guards the contract)', async () => {
    const t = new FakeTransport({ region: 'Mars', topic: 'AI' });
    await expect(
      new Reasoner(t).classify({ title: 'x', text: null }),
    ).rejects.toThrow();
  });

  it('confirmSameStory: returns the parsed boolean', async () => {
    const t = new FakeTransport({ same: true });
    const same = await new Reasoner(t).confirmSameStory(
      { title: 'A', text: null },
      { title: 'B', text: null },
    );
    expect(same).toBe(true);
    expect(t.calls[0]?.opts.tier).toBe('cheap');
  });

  it('adjustSignificance: returns the parsed adjustment', async () => {
    const t = new FakeTransport({ adjustment: 1.25 });
    const adj = await new Reasoner(t).adjustSignificance({
      title: 'x',
      text: null,
      baseScore: 5,
    });
    expect(adj).toBeCloseTo(1.25, 5);
  });

  it('analyze: free-form completion on the deep tier, prompt carries the story', async () => {
    const t = new FakeTransport({}, 'It matters because.');
    const out = await new Reasoner(t).analyze({
      title: 'Big merger',
      text: null,
      region: 'World',
      topic: 'Business',
      significance: 8,
    });
    expect(out).toBe('It matters because.');
    expect(t.calls[0]?.kind).toBe('text');
    expect(t.calls[0]?.opts.tier).toBe('deep');
    expect(t.calls[0]?.prompt).toContain('Big merger');
  });

  it('narrate: free-form completion on the deep tier, built from the brief', async () => {
    const t = new FakeTransport({}, 'Welcome to the show.');
    const out = await new Reasoner(t).narrate({ minutes: 5, brief: 'BRIEF BODY' });
    expect(out).toBe('Welcome to the show.');
    expect(t.calls[0]?.opts.tier).toBe('deep');
    expect(t.calls[0]?.prompt).toContain('BRIEF BODY');
  });

  it('interpretFeedback: parses intent on the cheap tier and keeps the feedback text', async () => {
    const t = new FakeTransport({
      topics: [
        { topic: 'AI', direction: 'more' },
        { topic: 'Sports', direction: 'mute' },
      ],
      regions: [{ region: 'Israel', direction: 'more' }],
      length: 'shorter',
      summary: 'More AI, no Sports, shorter, more Israel.',
    });

    const intent = await new Reasoner(t).interpretFeedback({
      text: 'love the AI, hide sports, keep it short, more israel',
    });

    expect(t.calls[0]?.kind).toBe('json');
    expect(t.calls[0]?.opts.tier).toBe('cheap');
    expect(t.calls[0]?.prompt).toContain('hide sports');
    expect(intent.topics).toContainEqual({ topic: 'AI', direction: 'more' });
    expect(intent.topics).toContainEqual({ topic: 'Sports', direction: 'mute' });
    expect(intent.regions).toContainEqual({ region: 'Israel', direction: 'more' });
    expect(intent.length).toBe('shorter');
  });

  it('interpretFeedback: silently drops out-of-vocabulary topics/regions', async () => {
    const t = new FakeTransport({
      topics: [
        { topic: 'AI', direction: 'more' },
        { topic: 'Crypto', direction: 'more' }, // not in the controlled vocabulary
      ],
      regions: [{ region: 'Mars', direction: 'less' }], // not a Region
      length: null,
      summary: 'More AI.',
    });

    const intent = await new Reasoner(t).interpretFeedback({ text: 'more ai and crypto' });

    expect(intent.topics).toEqual([{ topic: 'AI', direction: 'more' }]);
    expect(intent.regions).toEqual([]);
  });
});
