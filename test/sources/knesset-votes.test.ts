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
    // Bare action label, no bill name → unpresentable + cross-bill merge risk → skipped.
    { vote_id: 77, vote_item_dscr: 'הסתייגות', total_for: 5, total_against: 4, total_abstain: 0 },
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
      metadata: { topic: 'Israel', points: 52, mentions: 55 },
    });
    expect(item?.title).toContain('נושא הישיבה'); // bill description leads the title
    expect(item?.title).toContain('הצעת סיכום');
    expect(item?.text).toContain('בעד 52'); // tally recap (dedup body lead + summary)
    expect(item?.publishedAt).toBe(Date.parse('2021-07-13T00:00:00'));
    // tone = margin (for-against)/(for+against) * 10 = (52-3)/55*10 ≈ 8.9
    expect(item?.metadata.tone).toBeCloseTo(8.9, 1);
  });

  it('skips votes lacking a bill description (no context / generic-title noise)', async () => {
    const source = new KnessetVotesSource({ fetchJson: fetcher, maxItems: 10 });
    const items = await source.extract();
    expect(items).toHaveLength(1); // vote 9 (no descr) and vote 77 (bare action) both dropped
    expect(items[0]?.externalId).toBe('34515');
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
