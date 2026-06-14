import { describe, expect, it } from 'vitest';
import { KnessetSource } from '../../src/sources/knesset.js';
import type { JsonFetcher } from '../../src/sources/http.js';

function source(value: unknown[]): KnessetSource {
  const fetchJson: JsonFetcher = async () => ({ value });
  return new KnessetSource({ fetchJson, maxItems: 10 });
}

describe('KnessetSource', () => {
  it('maps a bill to an Israel/Politics RawItem (ISO date)', async () => {
    const [raw] = await source([
      {
        BillID: 2211922,
        KnessetNum: 25,
        Name: 'הצעת חוק לתיקון פקודת בתי הסוהר',
        LastUpdatedDate: '2026-06-10T00:00:00',
      },
    ]).extract();

    expect(raw?.source).toBe('knesset');
    expect(raw?.externalId).toBe('2211922');
    expect(raw?.title).toBe('הצעת חוק לתיקון פקודת בתי הסוהר');
    expect(raw?.metadata.region).toBe('Israel');
    expect(raw?.metadata.topic).toBe('Politics');
    expect(raw?.publishedAt).toBe(Date.parse('2026-06-10T00:00:00'));
  });

  it('parses the OData /Date(ms)/ timestamp format too', async () => {
    const [raw] = await source([
      { BillID: 1, Name: 'חוק', LastUpdatedDate: '/Date(1749513600000)/' },
    ]).extract();
    expect(raw?.publishedAt).toBe(1749513600000);
  });

  it('healthCheck returns false (never throws) on failure', async () => {
    const s = new KnessetSource({
      fetchJson: async () => {
        throw new Error('down');
      },
      maxItems: 10,
    });
    await expect(s.healthCheck()).resolves.toBe(false);
  });
});
