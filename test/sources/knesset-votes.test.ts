import { describe, expect, it } from 'vitest';
import { KnessetVotesSource } from '../../src/sources/knesset-votes.js';
import type { JsonFetcher } from '../../src/sources/http.js';

const FEED = {
  value: [
    {
      vote_id: 34515,
      sess_item_dscr: 'נושא הישיבה',
      vote_item_dscr: 'הצעת סיכום',
      vote_date: '2021-07-13T00:00:00',
      is_accepted: 1,
      total_for: 52,
      total_against: 3,
      total_abstain: 0,
    },
    { vote_id: 9, total_for: 1, total_against: 1, total_abstain: 0 }, // no descr → skipped
  ],
};

const fetcher: JsonFetcher = async () => FEED;

describe('KnessetVotesSource', () => {
  it('maps a vote to a RawItem with Israel/Politics + tally signals', async () => {
    const source = new KnessetVotesSource({ fetchJson: fetcher, maxItems: 10 });
    const [item] = await source.extract();

    expect(item).toMatchObject({
      source: 'knesset-votes',
      externalId: '34515',
      url: null,
      metadata: { region: 'Israel', topic: 'Politics', points: 52, mentions: 55 },
    });
    expect(item?.title).toContain('הצעת סיכום');
    expect(item?.publishedAt).toBe(Date.parse('2021-07-13T00:00:00'));
    // tone = margin (for-against)/(for+against) * 10 = (52-3)/55*10 ≈ 8.9
    expect(item?.metadata.tone).toBeCloseTo(8.9, 1);
  });

  it('skips votes with no description', async () => {
    const source = new KnessetVotesSource({ fetchJson: fetcher, maxItems: 10 });
    expect(await source.extract()).toHaveLength(1);
  });

  it('healthCheck never throws on failure', async () => {
    const broken = new KnessetVotesSource({
      fetchJson: async () => {
        throw new Error('down');
      },
      maxItems: 10,
    });
    await expect(broken.healthCheck()).resolves.toBe(false);
  });
});
