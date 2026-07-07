import { describe, expect, it, vi } from 'vitest';
import { TickRunner } from '../../src/pipeline/tick-runner.js';
import { DrizzleRawItemRepo } from '../../src/db/raw-item-repo.js';
import { DrizzleStoryRepo } from '../../src/db/story-repo.js';
import { DrizzleSignalObservationRepo } from '../../src/db/signal-observation-repo.js';
import { createTestDb } from '../helpers/test-db.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { FakeLLM } from '../helpers/fake-llm.js';
import { FakeEmbedder } from '../helpers/fake-embedder.js';
import { ResilientEmbedder } from '../../src/embedding/resilient-embedder.js';
import { FakeSource } from '../helpers/fake-source.js';
import { FakeSignalSource } from '../helpers/fake-signal-source.js';
import type { RawItem, SignalObservation, SourceId, StorySourceId } from '../../src/domain/types.js';

function item(
  source: StorySourceId,
  externalId: string,
  title: string,
  metadata: RawItem['metadata'] = {},
): RawItem {
  return {
    source,
    externalId,
    title,
    url: null,
    text: null,
    publishedAt: 0,
    metadata,
  };
}

const config = {
  candidateThreshold: 0.78,
  recentWindowHours: 72,
  recencyHalfLifeHours: 24,
  maxEditorialAdjustment: 1.5,
  deepAnalysisTopN: 5,
  sourceWeights: { hackernews: 0.6, gdelt: 0.7 } as Partial<
    Record<SourceId, number>
  >,
};

async function build(overrides: {
  sources: FakeSource[];
  signalSources?: FakeSignalSource[];
  embedder?: FakeEmbedder;
  llm?: FakeLLM;
  maxSignalAdjustment?: number;
}) {
  const db = await createTestDb();
  const rawItemRepo = new DrizzleRawItemRepo(db);
  const storyRepo = new DrizzleStoryRepo(db, new FakeClock(1000));
  const runner = new TickRunner({
    sources: overrides.sources,
    ...(overrides.signalSources ? { signalSources: overrides.signalSources } : {}),
    rawItemRepo,
    storyRepo,
    llm: overrides.llm ?? new FakeLLM({ analyze: 'Why it matters.' }),
    embedder: overrides.embedder ?? new FakeEmbedder(),
    clock: new FakeClock(100 * 3_600_000),
    config: { ...config, maxSignalAdjustment: overrides.maxSignalAdjustment ?? 0 },
  });
  return { runner, rawItemRepo, storyRepo };
}

function signal(topic: SignalObservation['topic'], value: number): SignalObservation {
  return {
    source: 'wikipedia-pageviews',
    topic,
    key: `${topic ?? 'global'}:k:202605`,
    value,
    observedAt: 0,
  };
}

describe('TickRunner', () => {
  it('runs the full pipeline: extracts, classifies, scores, persists a story', async () => {
    const { runner, storyRepo, rawItemRepo } = await build({
      sources: [
        new FakeSource('hackernews', {
          items: [
            item('hackernews', '1', 'AI breakthrough', {
              topic: 'AI',
              points: 300,
            }),
          ],
        }),
      ],
      embedder: new FakeEmbedder({ 'AI breakthrough': [1, 0, 0] }),
    });

    const report = await runner.run();

    expect(report.extracted).toBe(1);
    expect(report.storiesUpserted).toBe(1);
    expect(await rawItemRepo.all()).toHaveLength(1); // raw persisted too

    const [story] = await storyRepo.all();
    expect(story?.topic).toBe('AI');
    expect(story?.significance).toBeGreaterThan(0);
    expect(story?.whyItMatters).toBe('Why it matters.'); // in top-N
    expect(story?.memberRefs).toHaveLength(1);
  });

  it('skips sources in the adaptive-backoff set (ADR-0052)', async () => {
    const { runner } = await build({
      sources: [
        new FakeSource('hackernews', { items: [item('hackernews', '1', 'Kept', { topic: 'AI' })] }),
        new FakeSource('gdelt', { items: [item('gdelt', '2', 'Skipped', { topic: 'Geopolitics' })] }),
      ],
      embedder: new FakeEmbedder({ Kept: [1, 0, 0], Skipped: [0, 1, 0] }),
    });

    const report = await runner.run({ skipSources: new Set(['gdelt']) });
    expect(report.extracted).toBe(1); // only hackernews ran; gdelt was backed off
  });

  it('honors a per-run deepAnalysisTopN policy override (ADR-0053)', async () => {
    const llm = new FakeLLM({ confirm: false, analyze: 'Deep analysis.' });
    const { runner } = await build({
      sources: [
        new FakeSource('hackernews', {
          items: [
            item('hackernews', '1', 'Alpha', { topic: 'AI' }),
            item('hackernews', '2', 'Bravo', { topic: 'AI' }),
            item('hackernews', '3', 'Charlie', { topic: 'AI' }),
          ],
        }),
      ],
      embedder: new FakeEmbedder({ Alpha: [1, 0, 0], Bravo: [0, 1, 0], Charlie: [0, 0, 1] }),
      llm,
    });

    // config.deepAnalysisTopN is 5 — the reflection policy dials it to 1.
    await runner.run({ deepAnalysisTopN: 1 });
    expect(llm.analyzeCalls).toBe(1); // only the top story got the deep tier
  });

  it('falls back to the source text for a Story the deep tier skipped (ADR-0024)', async () => {
    const db = await createTestDb();
    const rawItemRepo = new DrizzleRawItemRepo(db);
    const storyRepo = new DrizzleStoryRepo(db, new FakeClock(1000));
    const withText: RawItem = {
      source: 'guardian',
      externalId: 'g1',
      title: 'Parliament passes the bill',
      url: 'https://example.com/bill',
      text: '<p>The parliament passed the bill today.</p> More detail followed afterwards.',
      publishedAt: 0,
      metadata: { topic: 'Israel' },
    };
    const runner = new TickRunner({
      sources: [new FakeSource('guardian', { items: [withText] })],
      rawItemRepo,
      storyRepo,
      llm: new FakeLLM(),
      embedder: new FakeEmbedder({ 'Parliament passes the bill': [1, 0, 0] }),
      clock: new FakeClock(100 * 3_600_000),
      config: { ...config, deepAnalysisTopN: 0, maxSignalAdjustment: 0 },
    });

    await runner.run();

    const [story] = await storyRepo.all();
    // Markup stripped, first sentences kept — a factual line without an LLM call.
    expect(story?.summary).toBe(
      'The parliament passed the bill today. More detail followed afterwards.',
    );
    expect(story?.whyItMatters).toBeNull(); // not deep-analyzed
    expect(story?.url).toBe('https://example.com/bill');
  });

  it('decodes HTML entities in the deterministic lead summary (ADR-0047)', async () => {
    const db = await createTestDb();
    const rawItemRepo = new DrizzleRawItemRepo(db);
    const storyRepo = new DrizzleStoryRepo(db, new FakeClock(1000));
    const withEntities: RawItem = {
      source: 'guardian',
      externalId: 'g1',
      title: 'Report on AT&amp;T and I&#x2F;O',
      url: null,
      // Hex (&#x2F; → /), named (&amp; → &), and decimal (&#39; → ') entities.
      text: 'The firm&#39;s AT&amp;T unit reported I&#x2F;O gains today.',
      publishedAt: 0,
      metadata: { topic: 'Business' },
    };
    const runner = new TickRunner({
      sources: [new FakeSource('guardian', { items: [withEntities] })],
      rawItemRepo,
      storyRepo,
      llm: new FakeLLM(),
      embedder: new FakeEmbedder({ 'Report on AT&amp;T and I&#x2F;O': [1, 0, 0] }),
      clock: new FakeClock(100 * 3_600_000),
      config: { ...config, deepAnalysisTopN: 0, maxSignalAdjustment: 0 },
    });

    await runner.run();

    const [story] = await storyRepo.all();
    expect(story?.summary).toBe("The firm's AT&T unit reported I/O gains today.");
  });

  it('reports skipped and failed sources without crashing the tick', async () => {
    const { runner, storyRepo } = await build({
      sources: [
        new FakeSource('hackernews', {
          items: [item('hackernews', '1', 'Live story', { topic: 'AI' })],
        }),
        new FakeSource('gdelt', { healthy: false }),
        new FakeSource('arxiv', { extractError: 'boom' }),
      ],
      embedder: new FakeEmbedder({ 'Live story': [1, 0, 0] }),
    });

    const report = await runner.run();

    expect(report.skipped).toEqual(['gdelt']);
    expect(report.failed.map((f) => f.source)).toEqual(['arxiv']);
    expect(report.storiesUpserted).toBe(1);
    expect(await storyRepo.all()).toHaveLength(1);
  });

  it('merges the same story across sources into one corroborated story', async () => {
    const { runner, storyRepo } = await build({
      sources: [
        new FakeSource('hackernews', {
          items: [item('hackernews', '1', 'Quake hits region', { topic: 'Geopolitics' })],
        }),
        new FakeSource('gdelt', {
          items: [item('gdelt', '2', 'Earthquake strikes area', { topic: 'Geopolitics' })],
        }),
      ],
      embedder: new FakeEmbedder({
        'Quake hits region': [1, 0, 0],
        'Earthquake strikes area': [0.99, 0.02, 0],
      }),
      llm: new FakeLLM({ confirm: true, analyze: 'Why it matters.' }),
    });

    const report = await runner.run();

    expect(report.storiesUpserted).toBe(1);
    const [story] = await storyRepo.all();
    const distinctSources = new Set(story?.memberRefs.map((r) => r.source));
    expect(distinctSources.size).toBe(2); // corroborated across both sources
  });

  it('cross-tick dedup: a later item from a new source merges into the prior story', async () => {
    // Shared db/repos/clock so the prior story sits inside the recency window.
    const db = await createTestDb();
    const rawItemRepo = new DrizzleRawItemRepo(db);
    const clock = new FakeClock(1000 * 3_600_000);
    const storyRepo = new DrizzleStoryRepo(db, clock);
    const embedder = new FakeEmbedder({
      'Quake hits region': [1, 0, 0],
      'Earthquake strikes area': [0.99, 0.02, 0],
    });
    const deps = {
      rawItemRepo,
      storyRepo,
      llm: new FakeLLM({ confirm: true, analyze: 'Why it matters.' }),
      embedder,
      clock,
      config,
    };

    // Tick 1 — hackernews reports the event.
    await new TickRunner({
      ...deps,
      sources: [
        new FakeSource('hackernews', {
          items: [item('hackernews', '1', 'Quake hits region', { topic: 'Geopolitics' })],
        }),
      ],
    }).run();
    expect(await storyRepo.all()).toHaveLength(1);

    // Tick 2 — gdelt reports the same event under a different id/headline.
    await new TickRunner({
      ...deps,
      sources: [
        new FakeSource('gdelt', {
          items: [item('gdelt', '2', 'Earthquake strikes area', { topic: 'Geopolitics' })],
        }),
      ],
    }).run();

    const stories = await storyRepo.all();
    expect(stories).toHaveLength(1); // merged, not duplicated across ticks
    const distinctSources = new Set(stories[0]?.memberRefs.map((r) => r.source));
    expect(distinctSources).toEqual(new Set(['hackernews', 'gdelt']));
  });

  it('numeric Signals lift the significance of a matching-partition story (ADR-0025)', async () => {
    const makeSources = () => [
      new FakeSource('hackernews', {
        items: [item('hackernews', '1', 'AI breakthrough', { topic: 'AI', points: 50 })],
      }),
    ];
    const embedder = () => new FakeEmbedder({ 'AI breakthrough': [1, 0, 0] });

    // Baseline: no signals.
    const plain = await build({ sources: makeSources(), embedder: embedder() });
    await plain.runner.run();
    const [plainStory] = await plain.storyRepo.all();

    // With a strong World attention surge and a non-zero max nudge.
    const boosted = await build({
      sources: makeSources(),
      embedder: embedder(),
      signalSources: [new FakeSignalSource('wikipedia-pageviews', { observations: [signal(null, 400_000)] })],
      maxSignalAdjustment: 1.5,
    });
    const report = await boosted.runner.run();
    const [boostedStory] = await boosted.storyRepo.all();

    expect(report.signalsObserved).toBe(1);
    expect(boostedStory!.significance).toBeGreaterThan(plainStory!.significance);
  });

  it('isolates an unhealthy or throwing Signal source without crashing the tick', async () => {
    const { runner, storyRepo } = await build({
      sources: [
        new FakeSource('hackernews', {
          items: [item('hackernews', '1', 'Live story', { topic: 'AI' })],
        }),
      ],
      embedder: new FakeEmbedder({ 'Live story': [1, 0, 0] }),
      signalSources: [
        new FakeSignalSource('wikipedia-pageviews', { healthy: false }),
        new FakeSignalSource('worldbank', { observeError: 'boom' }),
      ],
      maxSignalAdjustment: 1.0,
    });

    const report = await runner.run();

    expect(report.signalsSkipped).toEqual(['wikipedia-pageviews']);
    expect(report.signalsFailed.map((f) => f.source)).toEqual(['worldbank']);
    expect(report.storiesUpserted).toBe(1); // tick still completes
    expect(await storyRepo.all()).toHaveLength(1);
  });

  it('drops a non-finite Signal value instead of letting it crash the whole tick', async () => {
    // A Signal source's own arithmetic (division, subtraction) can yield NaN/
    // Infinity — e.g. a corrupt upstream numeric literal overflowing on JSON
    // parse. `signal_observations.value` is a raw numeric DB bind, not JSON:
    // recording a non-finite value throws (libsql rejects it, matching the
    // publishedAt guard in raw-item-repo, ADR-0051/0025). Unlike a throwing
    // Source, nothing isolated that per-observation before this fix — it
    // propagated out of run() and crashed the WHOLE tick (ok:false,
    // extracted:0), even though extraction itself fully succeeded.
    const db = await createTestDb();
    const rawItemRepo = new DrizzleRawItemRepo(db);
    const storyRepo = new DrizzleStoryRepo(db, new FakeClock(1000));
    const signalObservationRepo = new DrizzleSignalObservationRepo(db);
    const runner = new TickRunner({
      sources: [
        new FakeSource('hackernews', {
          items: [item('hackernews', '1', 'Live story', { topic: 'AI' })],
        }),
      ],
      signalSources: [
        new FakeSignalSource('worldbank', {
          observations: [
            { source: 'worldbank', topic: 'Business', key: 'corrupt:1', value: NaN, observedAt: 0 },
            { source: 'worldbank', topic: 'Business', key: 'fine:1', value: 3, observedAt: 0 },
          ],
        }),
      ],
      rawItemRepo,
      storyRepo,
      signalObservationRepo,
      llm: new FakeLLM({ analyze: 'Why it matters.' }),
      embedder: new FakeEmbedder({ 'Live story': [1, 0, 0] }),
      clock: new FakeClock(100 * 3_600_000),
      config: { ...config, maxSignalAdjustment: 1.0 },
    });

    const report = await runner.run(); // must not throw

    expect(report.signalsObserved).toBe(1); // the NaN reading was dropped, not counted
    expect(report.storiesUpserted).toBe(1); // the tick still completes end to end
    expect(await storyRepo.all()).toHaveLength(1);
  });

  it('keeps each Story aligned with its own cluster through score→analyze→upsert', async () => {
    // Three distinct, non-clustering stories. The deep tier echoes each item's
    // title, so a misaligned index (analyzed[i] paired with the wrong id) would
    // attach the wrong analysis to a Story. Guards the Promise.all order assumption.
    const { runner, storyRepo } = await build({
      sources: [
        new FakeSource('hackernews', {
          items: [
            item('hackernews', 'a', 'Alpha event', { topic: 'AI', points: 10 }),
            item('hackernews', 'b', 'Bravo event', { topic: 'AI', points: 300 }),
            item('hackernews', 'c', 'Charlie event', { topic: 'AI', points: 80 }),
          ],
        }),
      ],
      embedder: new FakeEmbedder({
        'Alpha event': [1, 0, 0],
        'Bravo event': [0, 1, 0],
        'Charlie event': [0, 0, 1],
      }),
      llm: new FakeLLM({ analyze: (i) => `analysis of ${i.title}` }),
    });

    await runner.run();

    const stories = await storyRepo.all();
    expect(stories).toHaveLength(3);
    // Each Story's analysis must come from its OWN title — not a neighbour's.
    for (const s of stories) {
      expect(s.whyItMatters).toBe(`analysis of ${s.title}`);
    }
  });

  it('sweeps orphaned stories at the end of every tick (ADR-0038)', async () => {
    const { runner, storyRepo } = await build({
      sources: [
        new FakeSource('hackernews', {
          items: [item('hackernews', '1', 'Live story', { topic: 'AI' })],
        }),
      ],
      embedder: new FakeEmbedder({ 'Live story': [1, 0, 0] }),
    });
    const pruneSpy = vi.spyOn(storyRepo, 'pruneOrphans');

    await runner.run();

    expect(pruneSpy).toHaveBeenCalledTimes(1); // orphan sweep runs each tick
    // And a normal tick never leaves a member-less story behind.
    for (const s of await storyRepo.all()) expect(s.memberRefs.length).toBeGreaterThan(0);
  });

  it('preserves a prior deep summary/why when a later tick does not re-analyze it (ADR-0047)', async () => {
    const db = await createTestDb();
    const rawItemRepo = new DrizzleRawItemRepo(db);
    const clock = new FakeClock(1000 * 3_600_000);
    const storyRepo = new DrizzleStoryRepo(db, clock);
    const embedder = new FakeEmbedder({ 'Deep story': [1, 0, 0] });

    // Tick 1: the story is in top-N, so the deep tier writes a real summary + why.
    await new TickRunner({
      sources: [
        new FakeSource('hackernews', {
          items: [item('hackernews', '1', 'Deep story', { topic: 'AI' })],
        }),
      ],
      rawItemRepo,
      storyRepo,
      llm: new FakeLLM({
        analyze: { summary: 'The deep summary.', whyItMatters: 'The deep why.', displayTitle: null },
      }),
      embedder,
      clock,
      config: { ...config, deepAnalysisTopN: 5, maxSignalAdjustment: 0 },
    }).run();

    const [afterFirst] = await storyRepo.all();
    expect(afterFirst?.summary).toBe('The deep summary.');
    expect(afterFirst?.whyItMatters).toBe('The deep why.');

    // Tick 2: same story, but NOT deep-analyzed this time (topN = 0). The cheap
    // re-upsert must not clobber the prior deep summary/why with a fallback/null.
    await new TickRunner({
      sources: [
        new FakeSource('hackernews', {
          items: [item('hackernews', '1', 'Deep story', { topic: 'AI' })],
        }),
      ],
      rawItemRepo,
      storyRepo,
      llm: new FakeLLM(),
      embedder,
      clock,
      config: { ...config, deepAnalysisTopN: 0, maxSignalAdjustment: 0 },
    }).run();

    const [afterSecond] = await storyRepo.all();
    expect(afterSecond?.summary).toBe('The deep summary.'); // preserved
    expect(afterSecond?.whyItMatters).toBe('The deep why.'); // preserved
  });

  it('the tick persists the analyzed displayTitle on the story', async () => {
    const db = await createTestDb();
    const rawItemRepo = new DrizzleRawItemRepo(db);
    const clock = new FakeClock(1000 * 3_600_000);
    const storyRepo = new DrizzleStoryRepo(db, clock);
    const embedder = new FakeEmbedder({ 'Deep story': [1, 0, 0] });

    // Tick 1: the story is in top-N, so the deep tier writes a real displayTitle.
    await new TickRunner({
      sources: [
        new FakeSource('hackernews', {
          items: [item('hackernews', '1', 'Deep story', { topic: 'AI' })],
        }),
      ],
      rawItemRepo,
      storyRepo,
      llm: new FakeLLM({
        analyze: {
          summary: 'The deep summary.',
          whyItMatters: 'The deep why.',
          displayTitle: 'The Deep Story, Explained',
        },
      }),
      embedder,
      clock,
      config: { ...config, deepAnalysisTopN: 5, maxSignalAdjustment: 0 },
    }).run();

    const [afterFirst] = await storyRepo.all();
    expect(afterFirst?.displayTitle).toBe('The Deep Story, Explained');

    // Tick 2: same story, but NOT deep-analyzed this time (topN = 0). The cheap
    // re-upsert must not clobber the prior deep displayTitle with null.
    await new TickRunner({
      sources: [
        new FakeSource('hackernews', {
          items: [item('hackernews', '1', 'Deep story', { topic: 'AI' })],
        }),
      ],
      rawItemRepo,
      storyRepo,
      llm: new FakeLLM(),
      embedder,
      clock,
      config: { ...config, deepAnalysisTopN: 0, maxSignalAdjustment: 0 },
    }).run();

    const [afterSecond] = await storyRepo.all();
    expect(afterSecond?.displayTitle).toBe('The Deep Story, Explained'); // preserved
  });

  it('does not persist a degraded (fallback) embedding vector (ADR-0065)', async () => {
    // Primary embedder is down, so the resilient embedder serves hash vectors.
    // The Story still upserts (from the source text), but its hash vector must
    // NOT reach story_vectors — a non-semantic vector would poison cross-tick
    // merge and semantic search against the real neural index.
    const brokenPrimary = { dimensions: 3, embed: async () => { throw new Error('down'); } };
    const embedder = new ResilientEmbedder(brokenPrimary, new FakeEmbedder({ 'Live story': [0.3, 0.3, 0.3] }));
    const { runner, storyRepo } = await build({
      sources: [
        new FakeSource('hackernews', {
          items: [item('hackernews', '1', 'Live story', { topic: 'AI' })],
        }),
      ],
    });
    // Swap in the degrading embedder (build() defaults to a healthy FakeEmbedder).
    (runner as unknown as { deps: { embedder: unknown } }).deps.embedder = embedder;

    const report = await runner.run();

    expect(report.storiesUpserted).toBe(1); // the tick still completes
    const [story] = await storyRepo.all();
    const vectors = await storyRepo.vectorsFor([story!.id]);
    expect(vectors.size).toBe(0); // no hash vector persisted
  });

  it('is idempotent across ticks — re-running does not duplicate stories', async () => {
    const { runner, storyRepo } = await build({
      sources: [
        new FakeSource('hackernews', {
          items: [item('hackernews', '1', 'Stable story', { topic: 'AI' })],
        }),
      ],
      embedder: new FakeEmbedder({ 'Stable story': [1, 0, 0] }),
    });

    await runner.run();
    await runner.run();

    expect(await storyRepo.all()).toHaveLength(1);
  });
});
