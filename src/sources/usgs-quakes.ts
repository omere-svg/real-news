import { z } from 'zod';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { RawItem, SourceMetadata } from '../domain/types.js';

// Keyless GeoJSON feeds; default = M4.5+ over the past day (steady, notable volume).
const BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary';
const DEFAULT_FEED = '4.5_day';

const featureSchema = z.object({
  id: z.string(),
  properties: z.object({
    mag: z.number().nullable().optional(),
    place: z.string().nullable().optional(),
    time: z.number().nullable().optional(),
    url: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
  }),
});
type Feature = z.infer<typeof featureSchema>;

const responseSchema = z.object({ features: z.array(featureSchema).optional() });

export interface UsgsQuakesDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
  /** Feed slug, e.g. `4.5_day`, `significant_week`. Defaults to `4.5_day`. */
  readonly feed?: string;
}

/**
 * USGS Earthquakes adapter (ADR-0031) — primary-source physical-event ground
 * truth for the `Climate` Topic. Topic=Climate skips the classifier (ADR-0009).
 * Magnitude (`mag`) is a native severity number → `points`, so a bigger quake
 * scores higher without the LLM. `time` is already epoch-ms. Prefer USGS over
 * NASA EONET for quakes (EONET mirrors the same events).
 */
export class UsgsQuakesSource implements SourceAdapter {
  readonly id = 'usgs-quakes' as const;

  constructor(private readonly deps: UsgsQuakesDeps) {}

  private url(): string {
    return `${BASE}/${this.deps.feed ?? DEFAULT_FEED}.geojson`;
  }

  async healthCheck(): Promise<boolean> {
    try {
      return responseSchema.safeParse(await this.deps.fetchJson(this.url())).success;
    } catch {
      return false;
    }
  }

  async extract(): Promise<RawItem[]> {
    const parsed = responseSchema.parse(await this.deps.fetchJson(this.url()));
    return (parsed.features ?? [])
      .slice(0, this.deps.maxItems)
      .map((f) => this.toRawItem(f))
      .filter((i): i is RawItem => i !== null);
  }

  private toRawItem(f: Feature): RawItem | null {
    const p = f.properties;
    // No magnitude → not a usable quake record.
    if (typeof p.mag !== 'number') return null;
    const title = p.title?.trim() || `M ${p.mag} - ${p.place ?? 'unknown location'}`;
    const metadata: SourceMetadata = { topic: 'Climate', points: p.mag };
    return {
      source: 'usgs-quakes',
      externalId: f.id,
      title,
      url: p.url ?? null,
      text: p.place ?? null,
      publishedAt: typeof p.time === 'number' ? p.time : null,
      metadata,
    };
  }
}
