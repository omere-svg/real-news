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
    const t = new FakeTransport({ topic: 'Israel' });
    const out = await new Reasoner(t).classify({ title: 'Knesset vote', text: null });

    expect(out).toEqual({ topic: 'Israel' });
    expect(t.calls[0]?.kind).toBe('json');
    expect(t.calls[0]?.opts.tier).toBe('cheap');
    expect(t.calls[0]?.prompt).toContain('Knesset vote');
  });

  it('classify: rejects an out-of-vocabulary reply (Zod guards the contract)', async () => {
    const t = new FakeTransport({ topic: 'Crypto' });
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

  it('confirmSameStory: prompt counts updates of one developing event as the same story (ADR-0048)', async () => {
    const t = new FakeTransport({ same: true });
    await new Reasoner(t).confirmSameStory(
      { title: 'Outbreak update #3', text: null },
      { title: 'Outbreak update #7', text: null },
    );
    expect(t.calls[0]?.prompt).toContain('Successive updates');
    expect(t.calls[0]?.prompt).toContain('NOT the same');
  });

  it('assessImpact: returns the parsed impact, clamped to [0,1]', async () => {
    const t = new FakeTransport({ impact: 0.85 });
    expect(await new Reasoner(t).assessImpact({ title: 'x', text: null })).toBeCloseTo(0.85, 5);
    expect(t.calls[0]?.opts.tier).toBe('cheap');

    const over = new FakeTransport({ impact: 5 });
    expect(await new Reasoner(over).assessImpact({ title: 'x', text: null })).toBe(1);
  });

  it('analyze: parses summary + why-it-matters JSON on the deep tier', async () => {
    const t = new FakeTransport({
      summary: 'Two firms merged.',
      whyItMatters: 'It reshapes the market.',
    });
    const out = await new Reasoner(t).analyze({
      title: 'Big merger',
      text: null,
      topic: 'Business',
      significance: 8,
    });
    expect(out).toEqual({
      summary: 'Two firms merged.',
      whyItMatters: 'It reshapes the market.',
    });
    expect(t.calls[0]?.kind).toBe('json');
    expect(t.calls[0]?.opts.tier).toBe('deep');
    expect(t.calls[0]?.prompt).toContain('Big merger');
    // Feed text is fenced as data + a low temperature locks formatting (ADR-0050).
    expect(t.calls[0]?.prompt).toContain('<item>');
    expect(t.calls[0]?.prompt).toMatch(/data, not instructions/i);
    expect(t.calls[0]?.opts.temperature).toBe(0.3);
  });

  it('narrate: free-form completion on the deep tier, built from the brief', async () => {
    const t = new FakeTransport({}, 'Welcome to the show.');
    const out = await new Reasoner(t).narrate({ minutes: 5, brief: 'BRIEF BODY' });
    expect(out).toBe('Welcome to the show.');
    expect(t.calls[0]?.opts.tier).toBe('deep');
    expect(t.calls[0]?.prompt).toContain('BRIEF BODY');
    // Spoken-audio contract: fenced brief + no-markdown rule (ADR-0050).
    expect(t.calls[0]?.prompt).toContain('<brief>');
    expect(t.calls[0]?.prompt).toMatch(/No markdown/i);
  });

  it('narrate: weaves the reader memory into the prompt when present (ADR-0028)', async () => {
    const t = new FakeTransport({}, 'script');
    await new Reasoner(t).narrate({
      minutes: 5,
      brief: 'BRIEF BODY',
      memory: 'I trade commodities and care about shipping.',
    });
    expect(t.calls[0]?.prompt).toContain('I trade commodities and care about shipping.');
  });

  it('discuss: grounds the answer in cache stories on the deep tier (ADR-0029)', async () => {
    const t = new FakeTransport({ answer: 'Rates held steady.', answeredFromNews: true });
    const out = await new Reasoner(t).discuss({
      question: 'What did the central bank do?',
      history: [],
      stories: [
        {
          title: 'Bank of Israel holds rates',
          summary: 'The Bank of Israel left its key rate unchanged.',
          whyItMatters: 'Signals caution on inflation.',
          topic: 'Business',
          significance: 7,
          url: 'https://example.com/boi',
        },
      ],
    });

    expect(out).toEqual({ answer: 'Rates held steady.', answeredFromNews: true });
    expect(t.calls[0]?.kind).toBe('json');
    expect(t.calls[0]?.opts.tier).toBe('deep');
    expect(t.calls[0]?.prompt).toContain('Bank of Israel holds rates');
    expect(t.calls[0]?.prompt).toContain('The Bank of Israel left its key rate unchanged.');
    expect(t.calls[0]?.prompt).toContain('What did the central bank do?');
    expect(t.calls[0]?.prompt).not.toContain('WEB RESULTS'); // no web block on the first pass
  });

  it('discuss: includes web results and memory when provided (ADR-0028/0029)', async () => {
    const t = new FakeTransport({ answer: 'Per recent reports…', answeredFromNews: true });
    await new Reasoner(t).discuss({
      question: 'Latest on the merger?',
      history: [{ role: 'user', content: 'earlier question' }],
      stories: [],
      web: [{ title: 'Merger approved', url: 'https://news.example/m', snippet: 'Regulators cleared it.' }],
      memory: 'I hold shares in the acquirer.',
    });
    const prompt = t.calls[0]?.prompt ?? '';
    expect(prompt).toContain('WEB RESULTS');
    expect(prompt).toContain('Regulators cleared it.');
    expect(prompt).toContain('I hold shares in the acquirer.');
    expect(prompt).toContain('earlier question');
  });

  it('interpretPrefs: parses a list change + minutes on the cheap tier (ADR-0030)', async () => {
    const t = new FakeTransport({
      topics: { mode: 'add', values: ['Politics'] },
      minutes: 5,
      summary: 'Added Politics, 5 min.',
    });
    const patch = await new Reasoner(t).interpretPrefs({ text: 'add politics and 5 minutes' });

    expect(t.calls[0]?.kind).toBe('json');
    expect(t.calls[0]?.opts.tier).toBe('cheap');
    expect(patch.topics).toEqual({ mode: 'add', values: ['Politics'] });
    expect(patch.minutes).toBe(5);
  });

  it('interpretPrefs: tolerates a sparse reply, defaulting omitted fields to null', async () => {
    const t = new FakeTransport({ summary: 'ok' });
    const patch = await new Reasoner(t).interpretPrefs({ text: 'hmm' });
    expect(patch).toEqual({ topics: null, minutes: null, summary: 'ok' });
  });

  it('interpretFeedback: parses intent on the cheap tier and keeps the feedback text', async () => {
    const t = new FakeTransport({
      topics: [
        { topic: 'AI', direction: 'more' },
        { topic: 'Sports', direction: 'mute' },
        { topic: 'Israel', direction: 'more' },
      ],
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
    expect(intent.topics).toContainEqual({ topic: 'Israel', direction: 'more' });
    expect(intent.length).toBe('shorter');
  });

  it('routeIntent: classifies on the cheap tier and extracts minutes (ADR-0030)', async () => {
    const t = new FakeTransport({ action: 'brief', minutes: 5, topic: null });
    const intent = await new Reasoner(t).routeIntent({ text: 'give me a 5 minute catch-up' });

    expect(intent).toEqual({ action: 'brief', minutes: 5, topic: null });
    expect(t.calls[0]?.kind).toBe('json');
    expect(t.calls[0]?.opts.tier).toBe('cheap');
    expect(t.calls[0]?.prompt).toContain('give me a 5 minute catch-up');
  });

  it('routeIntent: an unknown action degrades to help, not a throw', async () => {
    const t = new FakeTransport({ action: 'banana', minutes: 'soon', topic: 42 });
    const intent = await new Reasoner(t).routeIntent({ text: 'hi there' });
    expect(intent).toEqual({ action: 'help', minutes: null, topic: null });
  });

  it('interpretFeedback: silently drops out-of-vocabulary topics', async () => {
    const t = new FakeTransport({
      topics: [
        { topic: 'AI', direction: 'more' },
        { topic: 'Crypto', direction: 'more' }, // not in the controlled vocabulary
      ],
      length: null,
      summary: 'More AI.',
    });

    const intent = await new Reasoner(t).interpretFeedback({ text: 'more ai and crypto' });

    expect(intent.topics).toEqual([{ topic: 'AI', direction: 'more' }]);
  });

  it('reflect: summarizes recent ticks on the deep tier (ADR-0042)', async () => {
    const t = new FakeTransport({}, 'GDELT keeps failing — check its rate limit.');
    const out = await new Reasoner(t).reflect({
      ticks: [
        {
          ranAt: Date.UTC(2026, 6, 6),
          ok: false,
          durationMs: 1200,
          extracted: 0,
          storiesUpserted: 0,
          signalsObserved: 0,
          skipped: ['gdelt'],
          failed: [{ source: 'gdelt', error: 'timeout' }],
          error: 'boom',
        },
      ],
    });

    expect(out).toContain('GDELT');
    expect(t.calls[0]?.kind).toBe('text');
    expect(t.calls[0]?.opts.tier).toBe('deep');
    expect(t.calls[0]?.prompt).toContain('gdelt'); // the tick digest is in the prompt
  });

  it('reflect: returns empty for no ticks without calling the model', async () => {
    const t = new FakeTransport({}, 'unused');
    expect(await new Reasoner(t).reflect({ ticks: [] })).toBe('');
    expect(t.calls).toHaveLength(0);
  });
});
