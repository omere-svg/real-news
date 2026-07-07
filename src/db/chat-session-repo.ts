import { eq, lt } from 'drizzle-orm';
import type { Db } from './client.js';
import { chatSessions } from './schema.js';
import type { ConversationTurn } from '../llm/llm-client.js';

/**
 * Durable conversational context per chat (ADR-0053): the last few turns, so a
 * restart or deploy mid-conversation doesn't amnesia the exchange. The bot's
 * in-memory SessionStore is the hot path; this is its write-through backing.
 */
export interface ChatSessionRepo {
  /** The persisted turns for a chat, oldest first; [] when none. */
  turns(chatId: number): Promise<ConversationTurn[]>;
  /** Replace a chat's persisted turns. */
  put(chatId: number, turns: readonly ConversationTurn[], now: number): Promise<void>;
  /** Drop sessions idle since before `beforeMs`. Returns rows removed. */
  pruneIdleSince(beforeMs: number): Promise<number>;
}

const VALID_ROLES = new Set(['user', 'assistant']);

export class DrizzleChatSessionRepo implements ChatSessionRepo {
  constructor(private readonly db: Db) {}

  async turns(chatId: number): Promise<ConversationTurn[]> {
    const rows = await this.db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.chatId, chatId));
    const stored = rows[0]?.turns ?? [];
    return stored
      .filter((t) => VALID_ROLES.has(t.role))
      .map((t) => ({ role: t.role as ConversationTurn['role'], content: t.content }));
  }

  async put(chatId: number, turns: readonly ConversationTurn[], now: number): Promise<void> {
    const values = { turns: turns.map((t) => ({ role: t.role, content: t.content })), updatedAt: now };
    await this.db
      .insert(chatSessions)
      .values({ chatId, ...values })
      .onConflictDoUpdate({ target: chatSessions.chatId, set: values });
  }

  async pruneIdleSince(beforeMs: number): Promise<number> {
    const stale = await this.db
      .select({ chatId: chatSessions.chatId })
      .from(chatSessions)
      .where(lt(chatSessions.updatedAt, beforeMs));
    if (stale.length === 0) return 0;
    await this.db.delete(chatSessions).where(lt(chatSessions.updatedAt, beforeMs));
    return stale.length;
  }
}
