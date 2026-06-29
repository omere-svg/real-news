import { describe, expect, it } from 'vitest';
import { GdacsSource } from '../../src/sources/gdacs.js';
import type { JsonFetcher } from '../../src/sources/http.js';

// Two DISTINCT Canadian wildfires (different eventid + severity) that the generic
// RSS adapter collapsed under one templated title, plus a severe Red cyclone.
const FEED = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>Green forest fire notification in Canada</title>
    <link>https://www.gdacs.org/report.aspx?eventtype=WF&amp;eventid=1029164</link>
    <pubDate>Sun, 29 Jun 2026 10:00:00 GMT</pubDate>
    <gdacs:alertlevel>Green</gdacs:alertlevel>
    <gdacs:eventid>1029164</gdacs:eventid>
    <gdacs:eventtype>WF</gdacs:eventtype>
    <gdacs:country>Canada</gdacs:country>
    <gdacs:severity>Green impact for forestfire in 10776 ha</gdacs:severity>
  </item>
  <item>
    <title>Green forest fire notification in Canada</title>
    <link>https://www.gdacs.org/report.aspx?eventtype=WF&amp;eventid=1029165</link>
    <pubDate>Sun, 29 Jun 2026 10:05:00 GMT</pubDate>
    <gdacs:alertlevel>Green</gdacs:alertlevel>
    <gdacs:eventid>1029165</gdacs:eventid>
    <gdacs:eventtype>WF</gdacs:eventtype>
    <gdacs:country>Canada</gdacs:country>
    <gdacs:severity>Green impact for forestfire in 504 ha</gdacs:severity>
  </item>
  <item>
    <title>Red tropical cyclone notification</title>
    <link>https://www.gdacs.org/report.aspx?eventtype=TC&amp;eventid=900001</link>
    <pubDate>Sun, 29 Jun 2026 09:00:00 GMT</pubDate>
    <gdacs:alertlevel>Red</gdacs:alertlevel>
    <gdacs:eventid>900001</gdacs:eventid>
    <gdacs:eventtype>TC</gdacs:eventtype>
    <gdacs:country>Philippines</gdacs:country>
    <gdacs:eventname>Mawar</gdacs:eventname>
    <gdacs:severity>Maximum wind speed 230 km/h</gdacs:severity>
  </item>
</channel></rss>`;

const fetcher: JsonFetcher = async () => FEED;

describe('GdacsSource', () => {
  it('gives each event a distinct id + title so distinct events never merge', async () => {
    const items = await new GdacsSource({ fetchJson: fetcher, maxItems: 10 }).extract();
    expect(items).toHaveLength(3);

    const ids = items.map((i) => i.externalId);
    expect(new Set(ids).size).toBe(3); // unique per eventid
    expect(ids).toContain('gdacs:WF:1029164');

    const titles = items.map((i) => i.title);
    expect(new Set(titles).size).toBe(3); // the two Canadian fires now differ
    expect(titles[0]).toContain('10776 ha');
    expect(titles[1]).toContain('504 ha');
    expect(items[0]?.metadata.topic).toBe('Climate');
  });

  it('encodes the alert level meaning so impact scoring can tell minor from severe', async () => {
    const items = await new GdacsSource({ fetchJson: fetcher, maxItems: 10 }).extract();
    const green = items.find((i) => i.externalId === 'gdacs:WF:1029164');
    const red = items.find((i) => i.externalId === 'gdacs:TC:900001');

    expect(green?.text).toContain('Green (minor humanitarian impact)');
    expect(red?.text).toContain('Red (severe / major humanitarian impact)');
    expect(red?.title).toContain('Mawar'); // named events carry their name
    expect(red?.title).toMatch(/^Red alert: Tropical Cyclone/);
  });

  it('healthCheck returns false (never throws) on failure', async () => {
    const s = new GdacsSource({
      fetchJson: async () => {
        throw new Error('down');
      },
      maxItems: 10,
    });
    await expect(s.healthCheck()).resolves.toBe(false);
  });
});
