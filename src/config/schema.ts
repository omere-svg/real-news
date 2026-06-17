import { z } from 'zod';
import { REGIONS, TOPICS } from '../domain/types.js';

/**
 * The configuration contract (ADR-0003). The single source of truth for the
 * shape of config/horizon.yaml. Parsed once at boot; the result is frozen and
 * injected. Secrets (API keys) come from the environment, never from here.
 */

const topicSchema = z.enum(TOPICS as [string, ...string[]]);
const regionSchema = z.enum(REGIONS as [string, ...string[]]);

export const sourceIdSchema = z.enum([
  'hackernews',
  'gdelt',
  'datagovil',
  'arxiv',
  'knesset',
  'secedgar',
  'wikipedia',
  // Phase 4 — media + thematic anchors (ADR-0021).
  'guardian',
  'timesofisrael',
  'knesset-votes',
  'hf-papers',
  'nber',
  'nature',
  'psyarxiv',
]);

export const sourceConfigSchema = z.object({
  id: sourceIdSchema,
  enabled: z.boolean().default(true),
  /** Editorial weight of this Source's signals, [0, 1] (ADR-0008). */
  weight: z.number().min(0).max(1).default(0.5),
  /** Max items to pull per tick. */
  maxItems: z.number().int().positive().default(50),
});

export const configSchema = z.object({
  /** The tick interval in minutes — "every X minutes" (ADR-0001). */
  tickIntervalMinutes: z.number().positive(),

  sources: z.array(sourceConfigSchema).min(1),

  reasoner: z.object({
    /** Cheap high-volume tier (ADR-0006/0012). */
    cheapModel: z.string().default('gpt-4o-mini'),
    /** Expensive analysis tier. */
    deepModel: z.string().default('gpt-4o'),
    /** Only the top-N most significant Clusters get the deep tier. */
    deepAnalysisTopN: z.number().int().positive().default(10),
  }),

  http: z
    .object({
      /** Per-request timeout for Source fetches (ADR-0023). */
      fetchTimeoutMs: z.number().int().positive().default(10_000),
      /** Max response body a Source fetch will buffer (bytes). */
      maxResponseBytes: z.number().int().positive().default(5_000_000),
    })
    .default({}),

  embedder: z
    .object({
      /** `openai` (neural, ADR-0018) or `hashing` (offline stand-in, ADR-0007). */
      provider: z.enum(['openai', 'hashing']).default('openai'),
      /** Embeddings model when provider is `openai`. */
      model: z.string().default('text-embedding-3-small'),
      /** Vector dimensionality (also the hashing fallback width). */
      dimensions: z.number().int().positive().default(1536),
    })
    .default({}),

  dedup: z.object({
    /** Cosine similarity above which two items are candidate pairs (ADR-0007). */
    candidateThreshold: z.number().min(0).max(1).default(0.78),
    /** How far back cross-tick dedup looks for a matching Story (ADR-0017). */
    recentWindowHours: z.number().positive().default(72),
  }),

  scoring: z.object({
    /** Hours after which recency decay has roughly halved the score. */
    recencyHalfLifeHours: z.number().positive().default(24),
    /** Max absolute editorial adjustment the LLM may apply (ADR-0008). */
    maxEditorialAdjustment: z.number().min(0).max(10).default(1.5),
  }),

  telegram: z
    .object({
      /** Master switch for the Telegram bot adapter (ADR-0019). */
      enabled: z.boolean().default(false),
      /** Long-poll server-side wait per cycle. */
      pollTimeoutSeconds: z.number().int().positive().default(30),
      /** Allowlist of chat ids the bot answers (ADR-0022). */
      allowedChatIds: z.array(z.number().int()).default([]),
      /** Answer everyone when the allowlist is empty. Default-deny otherwise (ADR-0022). */
      openAccess: z.boolean().default(false),
      /** Rate limits & per-chat/global cost quotas (ADR-0022). */
      limits: z
        .object({
          /** Max commands per chat per minute (burst). */
          perMinute: z.number().int().positive().default(8),
          /** Max podcasts per chat per UTC day (the expensive path). */
          podcastPerDay: z.number().int().positive().default(30),
          /** Max total commands per chat per UTC day. */
          commandsPerDay: z.number().int().positive().default(100),
          /** Process-wide podcast ceiling per UTC day — the hard bill backstop. */
          globalPodcastPerDay: z.number().int().positive().default(50),
        })
        .default({}),
      /** Podcast text-to-speech (ADR-0020). */
      tts: z
        .object({
          enabled: z.boolean().default(true),
          model: z.string().default('gpt-4o-mini-tts'),
          voice: z.string().default('alloy'),
        })
        .default({}),
    })
    .default({}),

  presentation: z.object({
    /** Default topic preferences for the attention budget (Principle 5, ADR-0015). */
    preferredTopics: z.array(topicSchema).default([]),
    /** Default region preferences (Principle 5, ADR-0015). */
    preferredRegions: z.array(regionSchema).default([]),
    /** Default attention budget in minutes when a request omits it. */
    defaultMinutes: z.number().positive().default(3),
    /** Hard cap on requested minutes — clamps cost amplification (ADR-0023). */
    maxMinutes: z.number().positive().default(60),
    /** Readability floor: minimum depth every shown Story gets (ADR-0024). */
    minDepth: z.enum(['headline', 'brief', 'full']).default('full'),
    /** Always show at least this many Stories, even at a tiny budget (ADR-0024). */
    minStories: z.number().int().positive().default(3),
    /** Expose the LLM-backed /api/podcast on the web server (ADR-0023). Off by default. */
    webPodcastEnabled: z.boolean().default(false),
    /** Reading rate for text artifacts — brief, outline (ADR-0013/0014). */
    textWordsPerMinute: z.number().positive().default(220),
    /** Speaking rate for the podcast script (ADR-0013/0014). */
    audioWordsPerMinute: z.number().positive().default(150),
    /** How many Significance-ranked Stories to pull as the candidate pool. */
    candidatePool: z.number().int().positive().default(200),
    /** Word cost of rendering a Story at each depth (the ADR-0013 cost model). */
    wordCost: z
      .object({
        headline: z.number().positive().default(18),
        brief: z.number().positive().default(45),
        full: z.number().positive().default(95),
      })
      .default({}),
  }),
});

export type Config = Readonly<z.infer<typeof configSchema>>;
export type SourceConfig = Readonly<z.infer<typeof sourceConfigSchema>>;
