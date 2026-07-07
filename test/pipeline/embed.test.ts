import { describe, expect, it } from 'vitest';
import { embed, dedupText } from '../../src/pipeline/embed.js';
import { FakeEmbedder } from '../helpers/fake-embedder.js';
import { ResilientEmbedder } from '../../src/embedding/resilient-embedder.js';
import type { ClassifiedItem } from '../../src/pipeline/types.js';
import type { RawItem } from '../../src/domain/types.js';
import type { Embedder } from '../../src/embedding/embedder.js';

function classified(title: string, text: string | null = null): ClassifiedItem {
  const item: RawItem = {
    source: 'hackernews',
    externalId: title,
    title,
    url: null,
    text,
    publishedAt: null,
    metadata: {},
  };
  return { item, topic: 'AI' };
}

describe('embed stage', () => {
  it('attaches the embedder vector to each item, preserving order', async () => {
    const embedder = new FakeEmbedder({ A: [1, 0, 0], B: [0, 1, 0] });

    const { items, degraded } = await embed([classified('A'), classified('B')], embedder);

    expect(items).toHaveLength(2);
    expect(items[0]?.vector).toEqual([1, 0, 0]);
    expect(items[1]?.vector).toEqual([0, 1, 0]);
    // ClassifiedItem fields are carried through.
    expect(items[0]?.topic).toBe('AI');
    // A plain (non-degrade-aware) embedder is never treated as degraded.
    expect(degraded).toBe(false);
  });

  it('reports degraded when a resilient embedder falls back this batch (ADR-0065)', async () => {
    const broken: Embedder = {
      dimensions: 3,
      embed: async () => {
        throw new Error('embeddings down');
      },
    };
    const fallback = new FakeEmbedder({ A: [0, 0, 1] });
    const embedder = new ResilientEmbedder(broken, fallback);

    const { items, degraded } = await embed([classified('A')], embedder);

    expect(items[0]?.vector).toEqual([0, 0, 1]); // still usable in-tick
    expect(degraded).toBe(true); // …but the tick must not persist it
  });

  it('is not degraded when a resilient embedder succeeds on the primary', async () => {
    const embedder = new ResilientEmbedder(
      new FakeEmbedder({ A: [1, 0, 0] }),
      new FakeEmbedder({ A: [0, 0, 9] }),
    );
    const { degraded } = await embed([classified('A')], embedder);
    expect(degraded).toBe(false);
  });

  it('embeds the title plus the body lead for same-event recall (ADR-0035)', async () => {
    const seen: string[] = [];
    const embedder = new FakeEmbedder();
    const original = embedder.embed.bind(embedder);
    embedder.embed = async (texts) => {
      seen.push(...texts);
      return original(texts);
    };

    await embed(
      [
        classified('Hello world'), // no body → title only
        classified('Quake', 'A 6.0 earthquake struck the coast, killing dozens.'),
      ],
      embedder,
    );
    expect(seen).toContain('Hello world');
    expect(seen.some((t) => t.startsWith('Quake. ') && t.includes('earthquake struck'))).toBe(true);
  });
});

describe('dedupText (ADR-0035)', () => {
  const of = (title: string, text: string | null) => dedupText({ title, text });

  it('is the title alone when there is no body', () => {
    expect(of('Headline', null)).toBe('Headline');
    expect(of('Headline', '   ')).toBe('Headline');
  });

  it('joins title + body lead, stripping markup and whitespace', () => {
    expect(of('Quake', '<p>Death  toll\nrises.</p>')).toBe('Quake. Death toll rises.');
  });

  it('caps the body lead so a long article cannot drown the title', () => {
    const long = 'x'.repeat(1000);
    const out = of('T', long);
    expect(out.startsWith('T. ')).toBe(true);
    expect(out.length).toBeLessThan(400); // title + ~320-char lead, not 1000
  });
});
