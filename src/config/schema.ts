import { z } from 'zod';

/**
 * The configuration contract (ADR-0003). The single source of truth for the
 * shape of config/horizon.yaml. Parsed once at boot; the result is frozen and
 * injected. Secrets (API keys) come from the environment, never from here.
 */

export const sourceIdSchema = z.enum([
  'hackernews',
  'gdelt',
  'datagovil',
  'arxiv',
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
    /** Cheap high-volume tier (ADR-0006). */
    cheapModel: z.string().default('claude-haiku-4-5-20251001'),
    /** Expensive analysis tier (ADR-0006). */
    deepModel: z.string().default('claude-opus-4-8'),
    /** Only the top-N most significant Clusters get the deep tier. */
    deepAnalysisTopN: z.number().int().positive().default(10),
  }),

  dedup: z.object({
    /** Cosine similarity above which two items are candidate pairs (ADR-0007). */
    candidateThreshold: z.number().min(0).max(1).default(0.78),
  }),

  scoring: z.object({
    /** Hours after which recency decay has roughly halved the score. */
    recencyHalfLifeHours: z.number().positive().default(24),
    /** Max absolute editorial adjustment the LLM may apply (ADR-0008). */
    maxEditorialAdjustment: z.number().min(0).max(10).default(1.5),
  }),

  presentation: z.object({
    /** Default topic preferences for the attention budget (Principle 5). */
    preferredTopics: z.array(z.string()).default([]),
  }),
});

export type Config = Readonly<z.infer<typeof configSchema>>;
export type SourceConfig = Readonly<z.infer<typeof sourceConfigSchema>>;
