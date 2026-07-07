import { describe, expect, it } from 'vitest';
import { GdeltSignalSource } from '../../src/sources/gdelt-signal.js';
import type { JsonFetcher } from '../../src/sources/http.js';

const TIMELINE = {
  timeline: [
    {
      series: 'Average Tone',
      data: [
        { date: '20260627T000000Z', value: -1.2 },
        { date: '20260628T000000Z', value: -4.5 },
      ],
    },
  ],
};

describe('GdeltSignalSource (ADR-0041)', () => {
  it('emits the negativity of the latest average tone as a Geopolitics signal', async () => {
    const fetcher: JsonFetcher = async (url) => {
      expect(url).toContain('mode=timelinetone');
      return TIMELINE;
    };
    const source = new GdeltSignalSource({ fetchJson: fetcher, maxItems: 1 });

    const obs = await source.observe();

    expect(obs).toHaveLength(1);
    expect(obs[0]?.source).toBe('gdelt-signal');
    expect(obs[0]?.topic).toBe('Geopolitics');
    expect(obs[0]?.value).toBeCloseTo(4.5, 5); // -(-4.5) — the latest reading
    expect(obs[0]?.key).toContain('20260628');
  });

  it('treats a neutral/positive climate as no nudge (value 0)', async () => {
    const source = new GdeltSignalSource({
      fetchJson: async () => ({
        timeline: [{ data: [{ date: '20260628T000000Z', value: 2.1 }] }],
      }),
      maxItems: 1,
    });
    const obs = await source.observe();
    expect(obs[0]?.value).toBe(0); // positive tone ⇒ Math.max(0, -2.1) = 0
  });

  it('returns nothing when the timeline is empty', async () => {
    const source = new GdeltSignalSource({
      fetchJson: async () => ({ timeline: [{ data: [] }] }),
      maxItems: 1,
    });
    await expect(source.observe()).resolves.toEqual([]);
  });

  it('retries once after a 429 so a shared-host collision does not lose the tick signal', async () => {
    let calls = 0;
    const source = new GdeltSignalSource({
      fetchJson: async () => {
        calls += 1;
        if (calls === 1) throw new Error('GET https://api.gdeltproject.org/... failed: 429 Too Many Requests');
        return TIMELINE;
      },
      maxItems: 1,
      retryDelayMs: 1,
    });
    const obs = await source.observe();
    expect(calls).toBe(2);
    expect(obs).toHaveLength(1);
  });

  it('makes no health-check probe (one request per tick, ADR-0039/0041)', async () => {
    let calls = 0;
    const source = new GdeltSignalSource({
      fetchJson: async () => {
        calls += 1;
        return TIMELINE;
      },
      maxItems: 1,
    });
    await expect(source.healthCheck()).resolves.toBe(true);
    expect(calls).toBe(0); // healthCheck must not fetch
    expect(source.saturationReference).toBeGreaterThan(0);
  });
});
