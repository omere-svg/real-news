import { describe, expect, it } from 'vitest';
import { TheSportsDbSource } from '../../src/sources/thesportsdb.js';
import type { JsonFetcher } from '../../src/sources/http.js';
import { FakeClock } from '../helpers/fake-clock.js';

// 2026-06-28 → the adapter polls the previous UTC day (2026-06-27).
const CLOCK = new FakeClock(Date.UTC(2026, 5, 28, 9, 0, 0));

const SOCCER = {
  events: [
    {
      idEvent: '2391772',
      strEvent: 'Cape Verde vs Saudi Arabia',
      strSport: 'Soccer',
      strLeague: 'FIFA World Cup',
      strHomeTeam: 'Cape Verde',
      strAwayTeam: 'Saudi Arabia',
      intHomeScore: '0',
      intAwayScore: '2',
      strStatus: 'FT',
      strTimestamp: '2026-06-27T18:00:00',
    },
    { strSport: 'Soccer', strEvent: 'no id — dropped' },
  ],
};

describe('TheSportsDbSource', () => {
  it('maps a finished match to a Sports RawItem with the score in the text', async () => {
    const fetcher: JsonFetcher = async (url) => {
      expect(url).toContain('eventsday.php');
      expect(url).toContain('d=2026-06-27'); // previous UTC day
      return SOCCER;
    };
    const source = new TheSportsDbSource({
      fetchJson: fetcher,
      maxItems: 10,
      clock: CLOCK,
      sports: ['Soccer'],
    });

    const items = await source.extract();

    expect(items).toHaveLength(1); // id-less event dropped
    expect(items[0]).toMatchObject({
      source: 'thesportsdb',
      externalId: '2391772',
      title: 'Cape Verde vs Saudi Arabia',
      metadata: { topic: 'Sports' },
    });
    expect(items[0]?.text).toContain('0'); // score present
    expect(items[0]?.text).toContain('2');
    expect(items[0]?.text).toContain('FIFA World Cup');
    expect(items[0]?.publishedAt).toBe(Date.parse('2026-06-27T18:00:00'));
  });

  it('caps the combined result at maxItems and never throws in healthCheck on failure', async () => {
    const source = new TheSportsDbSource({
      fetchJson: async () => SOCCER,
      maxItems: 0,
      clock: CLOCK,
      sports: ['Soccer'],
    });
    expect(await source.extract()).toHaveLength(0);

    const broken = new TheSportsDbSource({
      fetchJson: async () => {
        throw new Error('down');
      },
      maxItems: 10,
      clock: CLOCK,
    });
    await expect(broken.healthCheck()).resolves.toBe(false);
  });
});
