/**
 * Retry a network call a few times with exponential backoff (ADR-0047). The
 * OpenAI chat/embeddings APIs occasionally return transient 429/5xx or drop a
 * connection. Without a retry, one blip degrades the whole tick — the reasoner
 * falls back to neutral defaults, and (worse) the embedder falls back to hashing,
 * mixing a hash vector into a store of neural vectors so cosine dedup silently
 * breaks. A couple of spaced retries turn most blips into a slightly slower call.
 */
export interface RetryOptions {
  /** Total attempts including the first (default 3). */
  readonly attempts?: number;
  /** Base backoff in ms; doubles each attempt (default 250). */
  readonly baseDelayMs?: number;
  /** Injectable sleep for tests; defaults to a real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseDelayMs = opts.baseDelayMs ?? 250;
  const sleep = opts.sleep ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts - 1) await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastErr;
}
