import type { ConversationTurn } from '../llm/llm-client.js';
import type { ChatSessionRepo } from '../db/chat-session-repo.js';

/**
 * Per-chat conversational state (ADR-0028/0029), held in memory. `idle` is the
 * pre-brief default (plain text ⇒ help); after a brief the chat enters `chat`
 * (plain text ⇒ questions about the news); the feedback button parks it in
 * `feedback` for one message (the next plain text ⇒ tuning).
 */
export interface ChatSession {
  mode: 'idle' | 'chat' | 'feedback';
  history: ConversationTurn[];
  /** Last time this chat sent anything — for evicting idle sessions (ADR-0050). */
  lastSeen: number;
}

/** How many prior turns to carry as conversation context. */
const MAX_HISTORY_TURNS = 6;
/** Evict a chat's session after this much inactivity; under open access every
 * stranger's chat id would otherwise accumulate forever (ADR-0050). */
const SESSION_TTL_MS = 6 * 3600_000;

/**
 * The bot's in-memory session lifecycle, extracted from `HorizonBot` (ADR-0052):
 * get-or-create, idle eviction, and bounded conversation history — one cohesive,
 * independently-testable collaborator instead of state tangled into the dispatcher.
 */
export class SessionStore {
  private readonly sessions = new Map<number, ChatSession>();

  constructor(
    private readonly ttlMs: number = SESSION_TTL_MS,
    private readonly maxHistory: number = MAX_HISTORY_TURNS,
    /** Durable backing (ADR-0053): sessions survive restarts when wired. */
    private readonly repo?: ChatSessionRepo,
  ) {}

  /** The session for a chat, created idle on first contact; touches `lastSeen`. */
  get(chatId: number, now: number): ChatSession {
    let s = this.sessions.get(chatId);
    if (!s) {
      this.evictIdle(now); // amortized: only when a new chat appears
      s = { mode: 'idle', history: [], lastSeen: now };
      this.sessions.set(chatId, s);
    } else {
      s.lastSeen = now;
    }
    return s;
  }

  /**
   * The chat's conversation history, hydrated from the durable store on first
   * touch after a restart (ADR-0053) — a deploy mid-conversation no longer
   * amnesias the exchange. In-memory wins once present.
   */
  async history(chatId: number, now: number): Promise<ConversationTurn[]> {
    const s = this.get(chatId, now);
    if (s.history.length === 0 && this.repo) {
      const persisted = await this.repo.turns(chatId).catch(() => []);
      if (s.history.length === 0 && persisted.length > 0) {
        s.history.push(...persisted.slice(-this.maxHistory));
      }
    }
    return s.history;
  }

  /** Append a turn to a chat's history, trimming to the most recent `maxHistory`. */
  remember(chatId: number, now: number, turn: ConversationTurn): void {
    const s = this.get(chatId, now);
    s.history.push(turn);
    if (s.history.length > this.maxHistory) {
      s.history.splice(0, s.history.length - this.maxHistory);
    }
    // Write-through (best-effort): the durable copy trails the hot path.
    void this.repo
      ?.put(chatId, s.history, now)
      .catch((err) => console.warn('[telegram] session persist failed:', err));
  }

  /** Whether a chat currently has a live (non-evicted) session. */
  has(chatId: number): boolean {
    return this.sessions.has(chatId);
  }

  private evictIdle(now: number): void {
    for (const [id, s] of this.sessions) {
      if (now - s.lastSeen >= this.ttlMs) this.sessions.delete(id);
    }
  }
}
