import { describe, expect, it } from 'vitest';
import { bestMatch, resolve } from '../../src/pipeline/resolve.js';
import { createTestDb } from '../helpers/test-db.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { FakeLLM } from '../helpers/fake-llm.js';
import { DrizzleStoryRepo } from '../../src/db/story-repo.js';
import { DrizzleRawItemRepo } from '../../src/db/raw-item-repo.js';
import type { Cluster, RawItem } from '../../src/domain/types.js';
import type { EmbeddedItem } from '../../src/pipeline/types.js';

const HOUR = 3_600_000;

function rawItem(source: RawItem['source'], externalId: string, title: string): RawItem {
  return { source, externalId, title, url: null, text: null, publishedAt: 0, metadata: {} };
}

function embedded(item: RawItem, vector: number[]): EmbeddedItem {
  return { item, region: 'World', topic: 'AI', vector };
}

describe('bestMatch', () => {
  const candidates = [
    { storyId: 'x', vector: [1, 0, 0] },
    { storyId: 'y', vector: [0, 1, 0] },
  ];

  it('returns the closest story above the threshold', () => {
    expect(bestMatch([0.98, 0.02, 0], candidates, 0.8)).toBe('x');
  });

  it('returns null when nothing clears the threshold', () => {
    expect(bestMatch([0.5, 0.5, 0.7], candidates, 0.95)).toBeNull();
  });

  it('returns null for an empty candidate set', () => {
    expect(bestMatch([1, 0, 0], [], 0.5)).toBeNull();
  });
});

describe('resolve', () => {
  async function fixtures() {
    const db = await createTestDb();
    const clock = new FakeClock(1000 * HOUR);
    const storyRepo = new DrizzleStoryRepo(db, clock);
    const rawItemRepo = new DrizzleRawItemRepo(db);
    return { storyRepo, rawItemRepo, clock };
  }

  const opts = { candidateThreshold: 0.8, recentWindowHours: 72 };

  it('assigns a fresh deterministic id when nothing matches', async () => {
    const { storyRepo, rawItemRepo, clock } = await fixtures();
    const item = rawItem('hackernews', '1', 'New thing');
    const cluster: Cluster = { items: [item], region: 'World', topic: 'AI' };

    const out = await resolve(
      [cluster],
      [embedded(item, [1, 0, 0])],
      { storyRepo, rawItemRepo, llm: new FakeLLM(), clock },
      opts,
    );

    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('hackernews:1'); // storyIdOf
    expect(out[0]?.cluster.items).toHaveLength(1);
  });

  it('adopts an existing story id and merges prior members on a confirmed match', async () => {
    const { storyRepo, rawItemRepo, clock } = await fixtures();

    // A prior-tick story: hackernews:1, vector [1,0,0].
    const prior = rawItem('hackernews', '1', 'Quake hits region');
    await rawItemRepo.upsert([prior]);
    await storyRepo.upsert({
      id: 'hackernews:1',
      title: prior.title,
      url: null,
      region: 'World',
      topic: 'AI',
      significance: 5,
      whyItMatters: null,
      memberRefs: [{ source: 'hackernews', externalId: '1' }],
    });
    await storyRepo.putVector('hackernews:1', [1, 0, 0]);

    // This tick: a different source/id, same event, near-identical vector.
    const fresh = rawItem('gdelt', '2', 'Earthquake strikes area');
    const cluster: Cluster = { items: [fresh], region: 'World', topic: 'AI' };

    const out = await resolve(
      [cluster],
      [embedded(fresh, [0.99, 0.02, 0])],
      { storyRepo, rawItemRepo, llm: new FakeLLM({ confirm: true }), clock },
      opts,
    );

    expect(out[0]?.id).toBe('hackernews:1'); // adopts the prior story's id
    const sources = new Set(out[0]?.cluster.items.map((i) => i.source));
    expect(sources).toEqual(new Set(['hackernews', 'gdelt'])); // prior member merged in
  });

  it('does not merge when the Reasoner declines the match', async () => {
    const { storyRepo, rawItemRepo, clock } = await fixtures();
    const prior = rawItem('hackernews', '1', 'Story A');
    await rawItemRepo.upsert([prior]);
    await storyRepo.upsert({
      id: 'hackernews:1',
      title: prior.title,
      url: null,
      region: 'World',
      topic: 'AI',
      significance: 5,
      whyItMatters: null,
      memberRefs: [{ source: 'hackernews', externalId: '1' }],
    });
    await storyRepo.putVector('hackernews:1', [1, 0, 0]);

    const fresh = rawItem('gdelt', '2', 'Unrelated but similar vector');
    const cluster: Cluster = { items: [fresh], region: 'World', topic: 'AI' };

    const out = await resolve(
      [cluster],
      [embedded(fresh, [0.99, 0.02, 0])],
      { storyRepo, rawItemRepo, llm: new FakeLLM({ confirm: false }), clock },
      opts,
    );

    expect(out[0]?.id).toBe('gdelt:2'); // fresh id, no merge
    expect(out[0]?.cluster.items).toHaveLength(1);
  });

  it('ignores stored stories outside the recency window', async () => {
    const { storyRepo, rawItemRepo, clock } = await fixtures();
    // Story stored "now"; then advance the clock far past the window.
    const prior = rawItem('hackernews', '1', 'Old story');
    await rawItemRepo.upsert([prior]);
    await storyRepo.upsert({
      id: 'hackernews:1',
      title: prior.title,
      url: null,
      region: 'World',
      topic: 'AI',
      significance: 5,
      whyItMatters: null,
      memberRefs: [{ source: 'hackernews', externalId: '1' }],
    });
    await storyRepo.putVector('hackernews:1', [1, 0, 0]);

    clock.set((1000 + 200) * HOUR); // 200h later, window is 72h

    const fresh = rawItem('gdelt', '2', 'Same event later');
    const cluster: Cluster = { items: [fresh], region: 'World', topic: 'AI' };
    const out = await resolve(
      [cluster],
      [embedded(fresh, [1, 0, 0])],
      { storyRepo, rawItemRepo, llm: new FakeLLM({ confirm: true }), clock },
      opts,
    );

    expect(out[0]?.id).toBe('gdelt:2'); // too old to match → fresh story
  });
});
