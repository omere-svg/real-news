import { z } from 'zod';
import { SOURCE_IDS, TOPICS } from '../domain/types.js';

/**
 * The configuration contract (ADR-0003). The single source of truth for the
 * shape of config/horizon.yaml. Parsed once at boot; the result is frozen and
 * injected. Secrets (API keys) come from the environment, never from here.
 */

const topicSchema = z.enum(TOPICS as [string, ...string[]]);

// Derived from the single source of truth in domain/types (like topicSchema),
// so the config vocabulary can never drift from the SourceId types.
export const sourceIdSchema = z.enum(SOURCE_IDS);

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
    /**
     * On boot, regenerate the factual summary + why-it-matters for cached Stories
     * that lack a summary (e.g. created before the field existed, or never top-N).
     * Runs in the background, most-significant first, so the displayed brief
     * self-heals after a restart without a manual backfill.
     */
    backfillOnBoot: z.boolean().default(true),
    /** Max Stories the boot backfill will (re)analyze — bounds one-time cost. */
    backfillMaxOnBoot: z.number().int().nonnegative().default(200),
    /**
     * Steady-state healing: after each tick, deep-analyze up to this many cached
     * Stories that still lack a summary or whyItMatters, most-significant first.
     * Lets the whole cache converge over time instead of only on boot (ADR-0038).
     * 0 disables.
     */
    backfillPerTick: z.number().int().nonnegative().default(0),
  }),

  http: z
    .object({
      /** Per-request timeout for Source fetches (ADR-0023). */
      fetchTimeoutMs: z.number().int().positive().default(10_000),
      /** Max response body a Source fetch will buffer (bytes). */
      maxResponseBytes: z.number().int().positive().default(5_000_000),
    })
    .default({}),

  web: z
    .object({
      /**
       * Mark the "Log in with Telegram" session cookie `Secure` (ADR-0040). Keep
       * false when serving plain `http://`; set true behind HTTPS so the session
       * token is never transmitted over an unencrypted connection.
       */
      secureCookie: z.boolean().default(false),
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
    /**
     * Resolve a Cluster against recent Stories of ANY Topic, not just its own
     * (ADR-0038). The same event is often classified inconsistently across
     * sources, and a same-Topic gate blocks the merge; the LLM confirm + high
     * threshold still guard against false merges. Set false for legacy behaviour.
     */
    crossTopic: z.boolean().default(true),
    /** Max concurrent LLM confirm calls in cluster/resolve — tick throughput (ADR-0038). */
    confirmConcurrency: z.number().int().positive().default(8),
    /** Entity-aware blocking layer (ADR-0036) — toggle + tune; disable to revert. */
    entityBlocking: z
      .object({
        enabled: z.boolean().default(true),
        /** Lower cosine bar a pair may clear if it shares >= minSharedEntities. */
        relaxedThreshold: z.number().min(0).max(1).default(0.66),
        /** Shared-entity count that unlocks the relaxed threshold. */
        minSharedEntities: z.number().int().positive().default(1),
      })
      .default({}),
  }),

  scoring: z.object({
    /** Hours after which the floored recency factor decays one step (ADR-0034). */
    recencyHalfLifeHours: z.number().positive().default(36),
    /** Max absolute numeric-Signal nudge to significance (ADR-0025). */
    maxSignalAdjustment: z.number().min(0).max(10).default(1.0),
    /**
     * Max fractional salience lift for a numeric Signal series that is rising vs.
     * its prior persisted reading (ADR-0044). 0 disables trend enrichment (the
     * signal is then a pure snapshot). Needs persisted history to have any effect.
     */
    signalTrendBoost: z.number().min(0).max(2).default(0.5),
    /**
     * Entity-level attention (ADR-0043): also match a Cluster's named entities
     * against high-traffic Wikipedia Pageviews articles and nudge the specific
     * story, not just its whole topic. 0 disables entity matching. Shares the
     * `maxSignalAdjustment` ceiling — a story is nudged by the stronger of the
     * partition and entity signals, never both stacked past the cap.
     */
    entitySignalWeight: z.number().min(0).max(1).default(1.0),
  }),

  /** History retention + LLM reflection over recent ticks (ADR-0042). */
  retention: z
    .object({
      /** Keep only the most recent N tick reports; 0 keeps all. */
      tickReports: z.number().int().nonnegative().default(5),
      /** Keep only the most recent N reflection advisories; 0 keeps all. */
      reflections: z.number().int().nonnegative().default(20),
      /** Prune persisted Signal observations older than this many days; 0 keeps all. */
      signalHistoryDays: z.number().int().nonnegative().default(14),
      /** Prune expired web sessions / link codes each tick (ADR-0040 hardening). */
      pruneExpiredAuth: z.boolean().default(true),
      /** Generate an LLM reflection advisory every N ticks; 0 disables it. */
      reflectEveryTicks: z.number().int().nonnegative().default(5),
      /** How many recent ticks each reflection reasons over. */
      reflectWindow: z.number().int().positive().default(5),
    })
    .default({}),

  telegram: z
    .object({
      /** Master switch for the Telegram bot adapter (ADR-0019). */
      enabled: z.boolean().default(false),
      /** Long-poll server-side wait per cycle. */
      pollTimeoutSeconds: z.number().int().positive().default(30),
      /** Understand plain-language messages, not just slash commands (ADR-0030). */
      naturalLanguage: z.boolean().default(true),
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
          /**
           * Process-wide command ceiling per UTC day — the total-cost backstop that
           * bounds spend across ALL chats (essential under openAccess, since the
           * chat/`discuss` LLM path is otherwise capped only per-chat). ADR-0022/0031.
           */
          globalCommandsPerDay: z.number().int().positive().default(1000),
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
      /** Conversational chat about the news (ADR-0029). */
      chat: z
        .object({
          /** Enable the cache-grounded chat / free-text questions. */
          enabled: z.boolean().default(false),
          /**
           * Ground chat on the Stories most *semantically* similar to the question
           * (embed it, cosine over `story_vectors`) rather than top-by-significance
           * (ADR-0045). Falls back automatically when the embedder is unavailable.
           */
          semanticRetrieval: z.boolean().default(true),
          /** Web-search fallback when the cache can't answer (ADR-0029). */
          webSearch: z
            .object({
              /** `none` keeps it cache-only (Principle 4); `tavily` enables live lookup. */
              provider: z.enum(['none', 'tavily']).default('none'),
              /** Max web results to pull per escalated question. */
              maxResults: z.number().int().positive().default(5),
            })
            .default({}),
        })
        .default({}),
    })
    .default({}),

  presentation: z.object({
    /** Default topic preferences for the attention budget (Principle 5, ADR-0015). */
    preferredTopics: z.array(topicSchema).default([]),
    /** Default attention budget in minutes when a request omits it. */
    defaultMinutes: z.number().positive().default(3),
    /** Hard cap on requested minutes — clamps cost amplification (ADR-0023). */
    maxMinutes: z.number().positive().default(60),
    /** Tighter cap for the podcast (TTS) path; clamps the audio length (ADR-0023). */
    maxPodcastMinutes: z.number().positive().default(20),
    /** Readability floor: minimum depth every shown Story gets (ADR-0024). */
    minDepth: z.enum(['headline', 'brief', 'full']).default('full'),
    /** Always show at least this many Stories, even at a tiny budget (ADR-0024). */
    minStories: z.number().int().positive().default(3),
    /** Never show more than this many Stories — bounds large-minute briefs (ADR-0024). */
    maxStories: z.number().int().positive().default(12),
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
