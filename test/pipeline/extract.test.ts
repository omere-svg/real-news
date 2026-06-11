import { describe, expect, it } from 'vitest';
import { extract } from '../../src/pipeline/extract.js';
import { FakeSource, rawItem } from '../helpers/fake-source.js';

describe('extract stage (the worker)', () => {
  it('aggregates items across healthy sources', async () => {
    const report = await extract([
      new FakeSource('hackernews', { items: [rawItem('hackernews', '1')] }),
      new FakeSource('arxiv', { items: [rawItem('arxiv', 'a')] }),
    ]);

    expect(report.items).toHaveLength(2);
    expect(report.skipped).toEqual([]);
    expect(report.failed).toEqual([]);
  });

  it('skips a source that fails its health check, without calling extract', async () => {
    const unhealthy = new FakeSource('gdelt', {
      healthy: false,
      items: [rawItem('gdelt', 'g')],
    });
    const healthy = new FakeSource('hackernews', {
      items: [rawItem('hackernews', '1')],
    });

    const report = await extract([unhealthy, healthy]);

    expect(report.items.map((i) => i.source)).toEqual(['hackernews']);
    expect(report.skipped).toEqual(['gdelt']);
    expect(unhealthy.extractCalls).toBe(0);
  });

  it('isolates a source whose extract throws — others still return', async () => {
    const boom = new FakeSource('arxiv', { extractError: 'arxiv exploded' });
    const ok = new FakeSource('hackernews', {
      items: [rawItem('hackernews', '1')],
    });

    const report = await extract([boom, ok]);

    expect(report.items.map((i) => i.source)).toEqual(['hackernews']);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.source).toBe('arxiv');
    expect(report.failed[0]?.error).toContain('arxiv exploded');
  });
});
