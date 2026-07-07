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
  /** Injectable randomness for the jitter (tests); defaults to Math.random. */
  readonly random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether an error is worth retrying: transient network drops and the transient
 * HTTP statuses (429 rate-limit, 5xx). A permanent 4xx (401 bad key, 400 invalid
 * request, content filter) will fail again identically, so retrying it only
 * triples latency before the resilient client degrades (ADR-0049). Errors with
 * no status (fetch/DNS/timeout) are treated as transient.
 */
export function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number; statusCode?: number })?.status
    ?? (err as { statusCode?: number })?.statusCode;
  if (typeof status !== 'number') return true; // network/timeout — worth a retry
  return status === 429 || status >= 500;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseDelayMs = opts.baseDelayMs ?? 250;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;

  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // A permanent error won't get better by retrying — fail fast so the
      // resilient client degrades immediately instead of after 9 doomed calls.
      if (!isRetryable(err)) break;
      // ±25% jitter de-synchronizes the tick's fan-out: a 429 hits many calls at
      // once, and identical backoffs would re-stampede the API in lockstep.
      const jitter = 0.75 + 0.5 * random();
      if (attempt < attempts - 1) await sleep(baseDelayMs * 2 ** attempt * jitter);
    }
  }
  throw lastErr;
}
