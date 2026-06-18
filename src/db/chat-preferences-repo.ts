import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { chatPreferences } from './schema.js';
import type { Region, Topic } from '../domain/types.js';

/** Snapshot of the feedback-affected fields, kept for one-level undo (ADR-0026). */
export interface PreviousPreferences {
  readonly topicWeights?: Partial<Record<Topic, number>>;
  readonly regionWeights?: Partial<Record<Region, number>>;
  readonly defaultMinutes?: number;
}

/**
 * Per-chat presentation preferences for the Telegram bot (ADR-0019). Any field
 * may be unset; an unset field falls back to the config defaults (ADR-0015).
 * `topicWeights`/`regionWeights` are the soft preference weights set by free-text
 * feedback (ADR-0026); `prev` is the undo snapshot.
 */
export interface ChatPreferences {
  readonly chatId: number;
  readonly topics?: Topic[];
  readonly regions?: Region[];
  readonly defaultMinutes?: number;
  readonly topicWeights?: Partial<Record<Topic, number>>;
  readonly regionWeights?: Partial<Record<Region, number>>;
  readonly prev?: PreviousPreferences;
}

/**
 * A patch over a chat's preferences. A field that is **omitted** is left as-is
 * (merge); a field set explicitly to `undefined` is **cleared** back to the
 * default. This two-mode contract lets feedback both nudge and reset (ADR-0026).
 */
export type ChatPreferencesPatch = {
  readonly [K in keyof Omit<ChatPreferences, 'chatId'>]?: ChatPreferences[K] | undefined;
};

export interface ChatPreferencesRepo {
  get(chatId: number): Promise<ChatPreferences | null>;
  /** Merge a partial patch over any existing preferences (upsert). */
  set(chatId: number, patch: ChatPreferencesPatch): Promise<ChatPreferences>;
  /** Forget a chat's preferences so it reverts to the config defaults. */
  clear(chatId: number): Promise<void>;
}

type Row = typeof chatPreferences.$inferSelect;

/** Map a row to the domain shape, dropping null columns (≡ "unset"). */
function toDomain(row: Row): ChatPreferences {
  return {
    chatId: row.chatId,
    ...(row.topics ? { topics: row.topics } : {}),
    ...(row.regions ? { regions: row.regions } : {}),
    ...(row.defaultMinutes !== null ? { defaultMinutes: row.defaultMinutes } : {}),
    ...(row.topicWeights ? { topicWeights: row.topicWeights } : {}),
    ...(row.regionWeights ? { regionWeights: row.regionWeights } : {}),
    ...(row.prev ? { prev: row.prev } : {}),
  };
}

export class DrizzleChatPreferencesRepo implements ChatPreferencesRepo {
  constructor(private readonly db: Db) {}

  async get(chatId: number): Promise<ChatPreferences | null> {
    const rows = await this.db
      .select()
      .from(chatPreferences)
      .where(eq(chatPreferences.chatId, chatId));
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async set(chatId: number, patch: ChatPreferencesPatch): Promise<ChatPreferences> {
    const current = await this.get(chatId);
    // A key present in the patch wins (even when undefined ⇒ clear); an absent
    // key keeps the current value (merge). Coalescing to null persists "unset".
    const field = <K extends keyof ChatPreferencesPatch>(k: K): ChatPreferences[K] | null => {
      const v = Object.prototype.hasOwnProperty.call(patch, k) ? patch[k] : current?.[k];
      return (v ?? null) as ChatPreferences[K] | null;
    };

    const values = {
      chatId,
      topics: field('topics'),
      regions: field('regions'),
      defaultMinutes: field('defaultMinutes'),
      topicWeights: field('topicWeights'),
      regionWeights: field('regionWeights'),
      prev: field('prev'),
    };
    await this.db
      .insert(chatPreferences)
      .values(values)
      .onConflictDoUpdate({
        target: chatPreferences.chatId,
        set: {
          topics: values.topics,
          regions: values.regions,
          defaultMinutes: values.defaultMinutes,
          topicWeights: values.topicWeights,
          regionWeights: values.regionWeights,
          prev: values.prev,
        },
      });
    // Read back so the returned shape exactly matches storage (drops cleared fields).
    return (await this.get(chatId)) as ChatPreferences;
  }

  async clear(chatId: number): Promise<void> {
    await this.db
      .delete(chatPreferences)
      .where(eq(chatPreferences.chatId, chatId));
  }
}
