import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { chatPreferences } from './schema.js';
import type { Region, Topic } from '../domain/types.js';

/**
 * Per-chat presentation preferences for the Telegram bot (ADR-0019). Any field
 * may be unset; an unset field falls back to the config defaults (ADR-0015).
 */
export interface ChatPreferences {
  readonly chatId: number;
  readonly topics?: Topic[];
  readonly regions?: Region[];
  readonly defaultMinutes?: number;
}

export type ChatPreferencesPatch = Partial<Omit<ChatPreferences, 'chatId'>>;

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
    const merged: ChatPreferences = { chatId, ...current, ...patch };

    const values = {
      chatId,
      topics: merged.topics ?? null,
      regions: merged.regions ?? null,
      defaultMinutes: merged.defaultMinutes ?? null,
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
        },
      });
    return merged;
  }

  async clear(chatId: number): Promise<void> {
    await this.db
      .delete(chatPreferences)
      .where(eq(chatPreferences.chatId, chatId));
  }
}
