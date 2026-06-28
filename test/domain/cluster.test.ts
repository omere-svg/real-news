import { describe, expect, it } from 'vitest';
import { representativeOf, storyIdOf } from '../../src/domain/cluster.js';
import type { Cluster, RawItem } from '../../src/domain/types.js';

function member(source: RawItem['source'], externalId: string): RawItem {
  return {
    source,
    externalId,
    title: `${source} ${externalId}`,
    url: null,
    text: null,
    publishedAt: null,
    metadata: {},
  };
}

function cluster(items: RawItem[]): Cluster {
  return { items, topic: 'AI' };
}

describe('Cluster projection', () => {
  it('picks a deterministic representative (lowest source, externalId) regardless of order', () => {
    const a = cluster([member('hackernews', '9'), member('arxiv', '2')]);
    const b = cluster([member('arxiv', '2'), member('hackernews', '9')]);

    expect(representativeOf(a)).toEqual(representativeOf(b));
    expect(representativeOf(a).source).toBe('arxiv'); // 'arxiv' < 'hackernews'
  });

  it('derives a stable Story id from the representative', () => {
    const c = cluster([member('gdelt', '2'), member('hackernews', '1')]);
    expect(storyIdOf(c)).toBe('gdelt:2');
  });
});
