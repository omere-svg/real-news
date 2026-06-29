import { XMLParser } from 'fast-xml-parser';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { RawItem } from '../domain/types.js';

const FEED_URL = 'https://www.gdacs.org/xml/rss.xml';

// Same hardening as the shared RSS parser (ADR-0023): no entity expansion (XXE-safe).
const parser = new XMLParser({ ignoreAttributes: true, processEntities: false });

/** Coerce an XML node (string/number/{#text}) to a trimmed string, or null. */
function text(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && '#text' in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>)['#text']).trim() || null;
  }
  return null;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** GDACS event-type codes → readable names. Unknown codes pass through. */
const EVENT_TYPE: Record<string, string> = {
  WF: 'Wildfire',
  EQ: 'Earthquake',
  TC: 'Tropical Cyclone',
  FL: 'Flood',
  DR: 'Drought',
  VO: 'Volcanic activity',
  TS: 'Tsunami',
};

/**
 * Plain-language meaning of a GDACS alert level, so the impact model (ADR-0034)
 * rates a minor "Green" alert low and a "Red" alert high — without any global
 * scoring rule. Encoded into the item text the Reasoner reads.
 */
const ALERT_MEANING: Record<string, string> = {
  green: 'minor humanitarian impact',
  orange: 'moderate humanitarian impact',
  red: 'severe / major humanitarian impact',
};

/** A concise distinguishing detail from the severity string (e.g. "10776 ha"). */
function severityDetail(severity: string | null): string {
  if (!severity) return '';
  const afterIn = severity.split(/\bin\b/i).pop()?.trim() ?? '';
  const detail = afterIn && afterIn.length <= 40 ? afterIn : severity;
  return detail.slice(0, 40).trim();
}

export interface GdacsDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
  /** Override the feed URL (tests). */
  readonly feedUrl?: string;
}

/**
 * GDACS global-disaster adapter (ADR-0004/0036 follow-up). The generic RSS
 * adapter collapsed distinct events under GDACS's templated titles ("Green forest
 * fire notification in Canada"), merging unrelated wildfires. This dedicated
 * adapter parses GDACS's namespaced fields so each event is distinct (eventid +
 * severity + country) and carries its **alert level + meaning** for impact
 * scoring. Topic = Climate. APIs/feeds only, no scraping.
 */
export class GdacsSource implements SourceAdapter {
  readonly id = 'gdacs' as const;

  constructor(private readonly deps: GdacsDeps) {}

  private get url(): string {
    return this.deps.feedUrl ?? FEED_URL;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const xml = String(await this.deps.fetchJson(this.url, { as: 'text' }));
      return xml.includes('<rss') || xml.includes('<item');
    } catch {
      return false;
    }
  }

  async extract(): Promise<RawItem[]> {
    let parsed: Record<string, unknown>;
    try {
      const xml = String(await this.deps.fetchJson(this.url, { as: 'text' }));
      parsed = parser.parse(xml) as Record<string, unknown>;
    } catch {
      return [];
    }

    const channel = (parsed.rss as { channel?: { item?: unknown } } | undefined)?.channel;
    const nodes = asArray<Record<string, unknown>>(
      channel?.item as Record<string, unknown> | Record<string, unknown>[] | undefined,
    );

    return nodes
      .slice(0, this.deps.maxItems)
      .map((n) => this.toRawItem(n))
      .filter((i): i is RawItem => i !== null);
  }

  private toRawItem(node: Record<string, unknown>): RawItem | null {
    const eventId = text(node['gdacs:eventid']);
    if (!eventId) return null;

    const alert = (text(node['gdacs:alertlevel']) ?? 'Green').trim();
    const country = text(node['gdacs:country']) ?? 'unknown location';
    const typeCode = text(node['gdacs:eventtype']) ?? '';
    const typeName = EVENT_TYPE[typeCode] ?? typeCode ?? 'Event';
    const eventName = text(node['gdacs:eventname']);
    const severity = text(node['gdacs:severity']);
    const population = text(node['gdacs:population']);

    // A distinct, readable title: alert level + type (+ name) + country + a unique
    // severity detail, so different events never collapse under one templated title.
    const namePart = eventName ? ` ${eventName}` : '';
    const detail = severityDetail(severity);
    const detailPart = detail ? ` (${detail})` : ` [#${eventId}]`;
    const title = `${alert} alert: ${typeName}${namePart} in ${country}${detailPart}`;

    // Text carries the alert level's MEANING so the impact model scores minor
    // green alerts low and red alerts high — GDACS-specific, no global rule.
    const meaning = ALERT_MEANING[alert.toLowerCase()] ?? 'unspecified impact';
    const text_ =
      `GDACS alert level: ${alert} (${meaning}). ` +
      (severity ? `${severity}. ` : '') +
      `Country: ${country}.` +
      (population ? ` People potentially exposed: ${population}.` : '');

    const link =
      text(node.link) ??
      `https://www.gdacs.org/report.aspx?eventtype=${typeCode}&eventid=${eventId}`;
    const dateStr = text(node.pubDate) ?? text(node['gdacs:fromdate']);
    const ts = dateStr ? Date.parse(dateStr) : Number.NaN;

    return {
      source: 'gdacs',
      externalId: `gdacs:${typeCode}:${eventId}`,
      title,
      url: link,
      text: text_,
      publishedAt: Number.isNaN(ts) ? null : ts,
      metadata: { topic: 'Climate' },
    };
  }
}
