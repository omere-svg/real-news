import { describe, expect, it } from 'vitest';
import { embed } from '../../src/pipeline/embed.js';
import { FakeEmbedder } from '../helpers/fake-embedder.js';
import type { ClassifiedItem } from '../../src/pipeline/types.js';
import type { RawItem } from '../../src/domain/types.js';

function classified(title: string): ClassifiedItem {
  const item: RawItem = {
    source: 'hackernews',
    externalId: title,
    title,
    url: null,
    text: null,
    publishedAt: null,
    metadata: {},
  };
  return { item, topic: 'AI' };
}

describe('embed stage', () => {
  it('attaches the embedder vector to each item, preserving order', async () => {
    const embedder = new FakeEmbedder({ A: [1, 0, 0], B: [0, 1, 0] });

    const result = await embed([classified('A'), classified('B')], embedder);

    expect(result).toHaveLength(2);
    expect(result[0]?.vector).toEqual([1, 0, 0]);
    expect(result[1]?.vector).toEqual([0, 1, 0]);
    // ClassifiedItem fields are carried through.
    expect(result[0]?.topic).toBe('AI');
  });

  it('embeds the item titles', async () => {
    const seen: string[] = [];
    const embedder = new FakeEmbedder();
    const original = embedder.embed.bind(embedder);
    embedder.embed = async (texts) => {
      seen.push(...texts);
      return original(texts);
    };

    await embed([classified('Hello world')], embedder);
    expect(seen).toContain('Hello world');
  });
});
