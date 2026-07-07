import { describe, expect, it } from 'vitest';
import { parseRssItems } from '../../src/sources/rss.js';

const RSS2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Feed</title>
  <item>
    <title>First headline</title>
    <link>https://example.com/a</link>
    <description><![CDATA[<p>A <b>summary</b> with markup.</p>]]></description>
    <pubDate>Tue, 10 Jun 2026 12:00:00 GMT</pubDate>
    <category>World</category><category>Politics</category>
  </item>
  <item>
    <title>Second headline</title>
    <link>https://example.com/b</link>
  </item>
</channel></rss>`;

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://purl.org/rss/1.0/">
  <item rdf:about="https://nature.com/x">
    <title><![CDATA[Science thing]]></title>
    <link>https://nature.com/x</link>
    <content:encoded xmlns:content="http://purl.org/rss/1.0/modules/content/"><![CDATA[<p>Body</p>]]></content:encoded>
    <dc:date>2026-06-17T00:00:00Z</dc:date>
  </item>
</rdf:RDF>`;

describe('parseRssItems', () => {
  it('parses RSS 2.0 items, strips HTML, parses dates and categories', () => {
    const items = parseRssItems(RSS2);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: 'First headline',
      link: 'https://example.com/a',
      description: 'A summary with markup.', // tags stripped, whitespace collapsed
      publishedAt: Date.parse('Tue, 10 Jun 2026 12:00:00 GMT'),
      categories: ['World', 'Politics'],
    });
    expect(items[1]?.title).toBe('Second headline');
    expect(items[1]?.description).toBeNull();
    expect(items[1]?.publishedAt).toBeNull();
  });

  it('parses RDF/RSS-1.0 (Nature) items via content:encoded and dc:date', () => {
    const [item] = parseRssItems(RDF);
    expect(item?.title).toBe('Science thing');
    expect(item?.link).toBe('https://nature.com/x');
    expect(item?.description).toBe('Body');
    expect(item?.publishedAt).toBe(Date.parse('2026-06-17T00:00:00Z'));
  });

  it('decodes HTML entities in titles and descriptions (ADR-0051 shared decoder)', () => {
    const feed = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item>
        <title>Rocks &amp; minerals &#8212; a trader&#x2019;s guide</title>
        <link>https://example.com/e</link>
        <description>Supply &amp;amp; demand&amp;hellip;</description>
      </item>
    </channel></rss>`;
    const [item] = parseRssItems(feed);
    expect(item?.title).toBe('Rocks & minerals — a trader’s guide');
    // Double-encoded entities decode exactly one level — no re-opening (ADR-0051).
    expect(item?.description).toBe('Supply &amp; demand&hellip;');
  });

  it('returns [] for malformed or itemless XML', () => {
    expect(parseRssItems('<rss><channel></channel></rss>')).toEqual([]);
    expect(parseRssItems('not xml at all')).toEqual([]);
  });
});
