import { describe, expect, it, vi } from 'vitest';
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
  return { item, topic: 'AI', vector };
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
    const cluster: Cluster = { items: [item], topic: 'AI' };

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

  it('fetches recent vectors once per tick, not once per cluster (ADR-0049)', async () => {
    const { storyRepo, rawItemRepo, clock } = await fixtures();
    let calls = 0;
    const orig = storyRepo.recentVectors.bind(storyRepo);
    storyRepo.recentVectors = (q) => {
      calls += 1;
      return orig(q);
    };

    const clusters: Cluster[] = Array.from({ length: 5 }, (_, i) => ({
      items: [rawItem('hackernews', String(i), `Item ${i}`)],
      topic: 'AI',
    }));
    const embeds = clusters.map((c, i) => embedded(c.items[0]!, [1, i, 0]));

    await resolve(clusters, embeds, { storyRepo, rawItemRepo, llm: new FakeLLM(), clock }, {
      ...opts,
      crossTopic: true,
    });
    expect(calls).toBe(1); // memoized, not 5
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
      topic: 'AI',
      significance: 5,
      whyItMatters: null,
      memberRefs: [{ source: 'hackernews', externalId: '1' }],
    });
    await storyRepo.putVector('hackernews:1', [1, 0, 0]);

    // This tick: a different source/id, same event, near-identical vector.
    const fresh = rawItem('gdelt', '2', 'Earthquake strikes area');
    const cluster: Cluster = { items: [fresh], topic: 'AI' };

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
      topic: 'AI',
      significance: 5,
      whyItMatters: null,
      memberRefs: [{ source: 'hackernews', externalId: '1' }],
    });
    await storyRepo.putVector('hackernews:1', [1, 0, 0]);

    const fresh = rawItem('gdelt', '2', 'Unrelated but similar vector');
    const cluster: Cluster = { items: [fresh], topic: 'AI' };

    const out = await resolve(
      [cluster],
      [embedded(fresh, [0.99, 0.02, 0])],
      { storyRepo, rawItemRepo, llm: new FakeLLM({ confirm: false }), clock },
      opts,
    );

    expect(out[0]?.id).toBe('gdelt:2'); // fresh id, no merge
    expect(out[0]?.cluster.items).toHaveLength(1);
  });

  it('does NOT merge across topics by default (same-topic gate)', async () => {
    const { storyRepo, rawItemRepo, clock } = await fixtures();
    const prior = rawItem('guardian', 'g1', 'Venezuela earthquake death toll rises');
    await rawItemRepo.upsert([prior]);
    await storyRepo.upsert({
      id: 'guardian:g1', title: prior.title, url: null, topic: 'Geopolitics',
      significance: 8, whyItMatters: null, memberRefs: [{ source: 'guardian', externalId: 'g1' }],
    });
    await storyRepo.putVector('guardian:g1', [1, 0, 0]);

    // Same event, but classified Climate this tick.
    const fresh = rawItem('wikipedia', 'w1', 'Two earthquakes strike Venezuela');
    const cluster: Cluster = { items: [fresh], topic: 'Climate' };
    const out = await resolve(
      [cluster],
      [{ item: fresh, topic: 'Climate', vector: [0.99, 0.02, 0] }],
      { storyRepo, rawItemRepo, llm: new FakeLLM({ confirm: true }), clock },
      opts, // crossTopic not set
    );
    expect(out[0]?.id).toBe('wikipedia:w1'); // no cross-topic match → fresh id
  });

  it('merges across topics when crossTopic is on, keeping the existing story topic (ADR-0038)', async () => {
    const { storyRepo, rawItemRepo, clock } = await fixtures();
    const prior = rawItem('guardian', 'g1', 'Venezuela earthquake death toll rises');
    await rawItemRepo.upsert([prior]);
    await storyRepo.upsert({
      id: 'guardian:g1', title: prior.title, url: null, topic: 'Geopolitics',
      significance: 8, whyItMatters: null, memberRefs: [{ source: 'guardian', externalId: 'g1' }],
    });
    await storyRepo.putVector('guardian:g1', [1, 0, 0]);

    const fresh = rawItem('wikipedia', 'w1', 'Two earthquakes strike Venezuela');
    const cluster: Cluster = { items: [fresh], topic: 'Climate' };
    const out = await resolve(
      [cluster],
      [{ item: fresh, topic: 'Climate', vector: [0.99, 0.02, 0] }],
      { storyRepo, rawItemRepo, llm: new FakeLLM({ confirm: true }), clock },
      { ...opts, crossTopic: true },
    );
    expect(out[0]?.id).toBe('guardian:g1'); // adopted the prior story's id across topics
    expect(out[0]?.cluster.topic).toBe('Geopolitics'); // existing topic preserved, no flap
    const sources = new Set(out[0]?.cluster.items.map((i) => i.source));
    expect(sources).toEqual(new Set(['guardian', 'wikipedia']));
  });

  it('folds two clusters that resolve to the same story id into one (ADR-0038)', async () => {
    const { storyRepo, rawItemRepo, clock } = await fixtures();
    const prior = rawItem('hackernews', '1', 'Quake hits region');
    await rawItemRepo.upsert([prior]);
    await storyRepo.upsert({
      id: 'hackernews:1', title: prior.title, url: null, topic: 'AI',
      significance: 5, whyItMatters: null, memberRefs: [{ source: 'hackernews', externalId: '1' }],
    });
    await storyRepo.putVector('hackernews:1', [1, 0, 0]);

    // Two distinct fresh clusters both match the prior story.
    const a = rawItem('gdelt', '2', 'Earthquake strikes area');
    const b = rawItem('guardian', 'g3', 'Quake devastates region');
    const out = await resolve(
      [{ items: [a], topic: 'AI' }, { items: [b], topic: 'AI' }],
      [
        { item: a, topic: 'AI', vector: [0.99, 0.02, 0] },
        { item: b, topic: 'AI', vector: [0.98, 0.03, 0] },
      ],
      { storyRepo, rawItemRepo, llm: new FakeLLM({ confirm: true }), clock },
      opts,
    );

    expect(out).toHaveLength(1); // folded, not two writes to the same id
    expect(out[0]?.id).toBe('hackernews:1');
    const sources = new Set(out[0]?.cluster.items.map((i) => i.source));
    expect(sources).toEqual(new Set(['hackernews', 'gdelt', 'guardian']));
  });

  it('merges a cross-outlet phrasing below the strict bar when >= 2 entities are shared (relaxed band)', async () => {
    const { storyRepo, rawItemRepo, clock } = await fixtures();

    // Prior tick: the Wikipedia phrasing of the disaster.
    const prior = rawItem('wikipedia', 'w1', 'Two earthquakes strike Venezuela, leaving more than 3,500 dead');
    await rawItemRepo.upsert([prior]);
    await storyRepo.upsert({
      id: 'wikipedia:w1', title: prior.title, url: null, topic: 'Geopolitics',
      significance: 8, whyItMatters: null, memberRefs: [{ source: 'wikipedia', externalId: 'w1' }],
    });
    await storyRepo.putVector('wikipedia:w1', [1, 0, 0]);

    // This tick: the Guardian phrasing — cosine 0.70, below strict 0.8 but the
    // pair shares "venezuela" + "3500", so the relaxed band escalates to the LLM.
    const fresh = rawItem('guardian', 'g1', 'Venezuela earthquake: death toll passes 3,500');
    const out = await resolve(
      [{ items: [fresh], topic: 'Geopolitics' }],
      [{ item: fresh, topic: 'Geopolitics', vector: [0.7, 0.7141, 0] }],
      { storyRepo, rawItemRepo, llm: new FakeLLM({ confirm: true }), clock },
      opts,
    );

    expect(out[0]?.id).toBe('wikipedia:w1'); // corroboration accretes cross-source
    const sources = new Set(out[0]?.cluster.items.map((i) => i.source));
    expect(sources).toEqual(new Set(['wikipedia', 'guardian']));
  });

  it('does NOT escalate a below-strict match that shares fewer than 2 entities', async () => {
    const { storyRepo, rawItemRepo, clock } = await fixtures();
    const prior = rawItem('wikipedia', 'w1', 'Venezuela signs oil deal with partners');
    await rawItemRepo.upsert([prior]);
    await storyRepo.upsert({
      id: 'wikipedia:w1', title: prior.title, url: null, topic: 'Geopolitics',
      significance: 5, whyItMatters: null, memberRefs: [{ source: 'wikipedia', externalId: 'w1' }],
    });
    await storyRepo.putVector('wikipedia:w1', [1, 0, 0]);

    const llm = new FakeLLM({ confirm: true });
    const fresh = rawItem('guardian', 'g1', 'Venezuela earthquake: death toll passes 3,500');
    const out = await resolve(
      [{ items: [fresh], topic: 'Geopolitics' }],
      [{ item: fresh, topic: 'Geopolitics', vector: [0.7, 0.7141, 0] }],
      { storyRepo, rawItemRepo, llm, clock },
      opts,
    );

    expect(out[0]?.id).toBe('guardian:g1'); // only "venezuela" shared → precision holds
    expect(llm.confirmCalls).toBe(0); // never even escalated
  });

  it('never escalates below the relaxed floor, entities or not', async () => {
    const { storyRepo, rawItemRepo, clock } = await fixtures();
    const prior = rawItem('wikipedia', 'w1', 'Two earthquakes strike Venezuela, leaving more than 3,500 dead');
    await rawItemRepo.upsert([prior]);
    await storyRepo.upsert({
      id: 'wikipedia:w1', title: prior.title, url: null, topic: 'Geopolitics',
      significance: 8, whyItMatters: null, memberRefs: [{ source: 'wikipedia', externalId: 'w1' }],
    });
    await storyRepo.putVector('wikipedia:w1', [1, 0, 0]);

    const llm = new FakeLLM({ confirm: true });
    const fresh = rawItem('guardian', 'g1', 'Venezuela earthquake: death toll passes 3,500');
    const out = await resolve(
      [{ items: [fresh], topic: 'Geopolitics' }],
      [{ item: fresh, topic: 'Geopolitics', vector: [0.4, 0.9165, 0] }], // cosine 0.4
      { storyRepo, rawItemRepo, llm, clock },
      opts,
    );

    expect(out[0]?.id).toBe('guardian:g1');
    expect(llm.confirmCalls).toBe(0);
  });

  it('passes the stored story summary as the confirm body snippet (not title-only)', async () => {
    const { storyRepo, rawItemRepo, clock } = await fixtures();
    const prior = rawItem('wikipedia', 'w1', 'Quake hits region');
    await rawItemRepo.upsert([prior]);
    await storyRepo.upsert({
      id: 'wikipedia:w1', title: prior.title, url: null, topic: 'AI',
      significance: 5, whyItMatters: null,
      summary: 'A magnitude 7.1 earthquake struck western Venezuela on Sunday.',
      memberRefs: [{ source: 'wikipedia', externalId: 'w1' }],
    });
    await storyRepo.putVector('wikipedia:w1', [1, 0, 0]);

    let seenText: string | null | undefined;
    const llm = new FakeLLM({
      confirm: (_a, b) => {
        seenText = b.text;
        return true;
      },
    });
    const fresh = rawItem('gdelt', '2', 'Earthquake strikes area');
    await resolve(
      [{ items: [fresh], topic: 'AI' }],
      [embedded(fresh, [0.99, 0.02, 0])],
      { storyRepo, rawItemRepo, llm, clock },
      opts,
    );

    expect(seenText).toBe('A magnitude 7.1 earthquake struck western Venezuela on Sunday.');
  });

  it('logs resolve confirm accept/veto counts when matches were escalated', async () => {
    const { storyRepo, rawItemRepo, clock } = await fixtures();
    const prior = rawItem('hackernews', '1', 'Quake hits region');
    await rawItemRepo.upsert([prior]);
    await storyRepo.upsert({
      id: 'hackernews:1', title: prior.title, url: null, topic: 'AI',
      significance: 5, whyItMatters: null, memberRefs: [{ source: 'hackernews', externalId: '1' }],
    });
    await storyRepo.putVector('hackernews:1', [1, 0, 0]);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const fresh = rawItem('gdelt', '2', 'Earthquake strikes area');
      await resolve(
        [{ items: [fresh], topic: 'AI' }],
        [embedded(fresh, [0.99, 0.02, 0])],
        { storyRepo, rawItemRepo, llm: new FakeLLM({ confirm: false }), clock },
        opts,
      );
      expect(log).toHaveBeenCalledWith('[dedup] resolve confirmed=0 vetoed=1');
    } finally {
      log.mockRestore();
    }
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
      topic: 'AI',
      significance: 5,
      whyItMatters: null,
      memberRefs: [{ source: 'hackernews', externalId: '1' }],
    });
    await storyRepo.putVector('hackernews:1', [1, 0, 0]);

    clock.set((1000 + 200) * HOUR); // 200h later, window is 72h

    const fresh = rawItem('gdelt', '2', 'Same event later');
    const cluster: Cluster = { items: [fresh], topic: 'AI' };
    const out = await resolve(
      [cluster],
      [embedded(fresh, [1, 0, 0])],
      { storyRepo, rawItemRepo, llm: new FakeLLM({ confirm: true }), clock },
      opts,
    );

    expect(out[0]?.id).toBe('gdelt:2'); // too old to match → fresh story
  });
});
