import { desc, notInArray } from 'drizzle-orm';
import type { Db } from './client.js';
import { chatTraces, type StoredTraceStep } from './schema.js';

/**
 * The chat-trace store (ADR-0053): each tool-loop answer's trajectory — which
 * tools the model chose, in what order, and whether the answer was grounded.
 * The inspectable "how I answered" evidence, publicly surfaced; no chat
 * identity is stored, and text fields are clamped at the writer.
 */
export interface ChatTrace {
  readonly id: number;
  readonly createdAt: number;
  readonly question: string;
  readonly steps: readonly StoredTraceStep[];
  readonly answeredFromNews: boolean;
}

export interface ChatTraceInput {
  readonly createdAt: number;
  readonly question: string;
  readonly steps: readonly StoredTraceStep[];
  readonly answeredFromNews: boolean;
}

const MAX_QUESTION_CHARS = 300;

export interface ChatTraceRepo {
  record(rec: ChatTraceInput): Promise<void>;
  /** The most recent traces, newest first. */
  recent(limit: number): Promise<ChatTrace[]>;
  /** Delete all but the most recent `keep` traces. Returns rows removed. */
  pruneToRecent(keep: number): Promise<number>;
}

export class DrizzleChatTraceRepo implements ChatTraceRepo {
  constructor(private readonly db: Db) {}

  async record(rec: ChatTraceInput): Promise<void> {
    await this.db.insert(chatTraces).values({
      createdAt: rec.createdAt,
      question: rec.question.slice(0, MAX_QUESTION_CHARS),
      steps: [...rec.steps],
      answeredFromNews: rec.answeredFromNews,
    });
  }

  async recent(limit: number): Promise<ChatTrace[]> {
    const rows = await this.db
      .select()
      .from(chatTraces)
      .orderBy(desc(chatTraces.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      question: r.question,
      steps: r.steps ?? [],
      answeredFromNews: r.answeredFromNews,
    }));
  }

  async pruneToRecent(keep: number): Promise<number> {
    if (keep <= 0) return 0;
    const survivors = await this.db
      .select({ id: chatTraces.id })
      .from(chatTraces)
      .orderBy(desc(chatTraces.createdAt))
      .limit(keep);
    if (survivors.length < keep) return 0;
    const keepIds = survivors.map((r) => r.id);
    const stale = await this.db
      .select({ id: chatTraces.id })
      .from(chatTraces)
      .where(notInArray(chatTraces.id, keepIds));
    if (stale.length === 0) return 0;
    await this.db.delete(chatTraces).where(notInArray(chatTraces.id, keepIds));
    return stale.length;
  }
}
