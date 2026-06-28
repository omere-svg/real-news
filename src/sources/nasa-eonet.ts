import { z } from 'zod';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { RawItem, SourceMetadata } from '../domain/types.js';

// Keyless near-real-time natural-event feed; `status=open` = currently active.
const FEED_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open';

const pointSchema = z.object({
  magnitudeValue: z.number().nullable().optional(),
  date: z.string().nullable().optional(),
});

const eventSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  link: z.string().nullable().optional(),
  categories: z.array(z.object({ title: z.string() })).optional(),
  sources: z.array(z.object({ url: z.string() })).optional(),
  geometry: z.array(pointSchema).optional(),
});
type Event = z.infer<typeof eventSchema>;

const responseSchema = z.object({ events: z.array(eventSchema).optional() });

export interface NasaEonetDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
}

/**
 * NASA EONET adapter (ADR-0031) — the real-time natural-event feed for the new
 * `Climate` Topic (wildfires, storms, volcanoes, floods). Topic=Climate skips the
 * classifier (ADR-0009). The body is usually empty, so the "what happened" is the
 * category; the latest geometry point gives the timestamp and a severity
 * `magnitudeValue` → `points`. Earthquakes overlap USGS — prefer USGS for quakes.
 */
export class NasaEonetSource implements SourceAdapter {
  readonly id = 'nasa-eonet' as const;

  constructor(private readonly deps: NasaEonetDeps) {}

  private url(limit: number): string {
    return `${FEED_URL}&limit=${limit}`;
  }

  async healthCheck(): Promise<boolean> {
    try {
      return responseSchema.safeParse(await this.deps.fetchJson(this.url(1))).success;
    } catch {
      return false;
    }
  }

  async extract(): Promise<RawItem[]> {
    const parsed = responseSchema.parse(
      await this.deps.fetchJson(this.url(this.deps.maxItems)),
    );
    return (parsed.events ?? [])
      .slice(0, this.deps.maxItems)
      .map((e) => this.toRawItem(e))
      .filter((i): i is RawItem => i !== null);
  }

  private toRawItem(e: Event): RawItem | null {
    const title = e.title?.trim();
    if (!title) return null;

    const category = e.categories?.[0]?.title ?? null;
    const latest = latestPoint(e.geometry ?? []);
    const metadata: SourceMetadata = {
      topic: 'Climate',
      ...(typeof latest?.magnitudeValue === 'number' && latest.magnitudeValue > 0
        ? { points: latest.magnitudeValue }
        : {}),
    };
    return {
      source: 'nasa-eonet',
      externalId: e.id,
      title,
      // Prefer a real upstream source link; the `link` field is just the API record.
      url: e.sources?.[0]?.url ?? e.link ?? null,
      text: category,
      publishedAt: latest?.date ? Date.parse(latest.date) : null,
      metadata,
    };
  }
}

/** The most recent track point (events carry a time-ordered geometry array). */
function latestPoint(
  points: readonly z.infer<typeof pointSchema>[],
): z.infer<typeof pointSchema> | null {
  let best: z.infer<typeof pointSchema> | null = null;
  let bestT = -Infinity;
  for (const p of points) {
    const t = p.date ? Date.parse(p.date) : NaN;
    if (!Number.isNaN(t) && t >= bestT) {
      bestT = t;
      best = p;
    }
  }
  return best;
}
