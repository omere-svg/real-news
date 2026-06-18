import { describe, expect, it } from 'vitest';
import { TickRunner } from '../../src/pipeline/tick-runner.js';
import { DrizzleRawItemRepo } from '../../src/db/raw-item-repo.js';
import { DrizzleStoryRepo } from '../../src/db/story-repo.js';
import { createTestDb } from '../helpers/test-db.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { FakeLLM } from '../helpers/fake-llm.js';
import { FakeEmbedder } from '../helpers/fake-embedder.js';
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

function signal(region: 'World' | 'Israel', value: number): SignalObservation {
  return {
    source: 'wikipedia-pageviews',
    region,
    topic: null,
    key: `${region}:k:202605`,
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
              region: 'World',
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
    expect(story?.region).toBe('World');
    expect(story?.topic).toBe('AI');
    expect(story?.significance).toBeGreaterThan(0);
    expect(story?.whyItMatters).toBe('Why it matters.'); // in top-N
    expect(story?.memberRefs).toHaveLength(1);
  });

  it('reports skipped and failed sources without crashing the tick', async () => {
    const { runner, storyRepo } = await build({
      sources: [
        new FakeSource('hackernews', {
          items: [item('hackernews', '1', 'Live story', { topic: 'AI', region: 'World' })],
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
          items: [item('hackernews', '1', 'Quake hits region', { region: 'World', topic: 'Geopolitics' })],
        }),
        new FakeSource('gdelt', {
          items: [item('gdelt', '2', 'Earthquake strikes area', { region: 'World', topic: 'Geopolitics' })],
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
          items: [item('hackernews', '1', 'Quake hits region', { region: 'World', topic: 'Geopolitics' })],
        }),
      ],
    }).run();
    expect(await storyRepo.all()).toHaveLength(1);

    // Tick 2 — gdelt reports the same event under a different id/headline.
    await new TickRunner({
      ...deps,
      sources: [
        new FakeSource('gdelt', {
          items: [item('gdelt', '2', 'Earthquake strikes area', { region: 'World', topic: 'Geopolitics' })],
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
        items: [item('hackernews', '1', 'AI breakthrough', { region: 'World', topic: 'AI', points: 50 })],
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
      signalSources: [new FakeSignalSource('wikipedia-pageviews', { observations: [signal('World', 400_000)] })],
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
          items: [item('hackernews', '1', 'Live story', { region: 'World', topic: 'AI' })],
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

  it('is idempotent across ticks — re-running does not duplicate stories', async () => {
    const { runner, storyRepo } = await build({
      sources: [
        new FakeSource('hackernews', {
          items: [item('hackernews', '1', 'Stable story', { region: 'World', topic: 'AI' })],
        }),
      ],
      embedder: new FakeEmbedder({ 'Stable story': [1, 0, 0] }),
    });

    await runner.run();
    await runner.run();

    expect(await storyRepo.all()).toHaveLength(1);
  });
});
