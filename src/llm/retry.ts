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

/** Node/undici error codes for a dropped or unreachable connection. */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
]);

/** How many `.cause` links to follow before giving up (avoids a cyclic-cause hang). */
const MAX_CAUSE_DEPTH = 5;

/**
 * Whether a single error object's own code/name/message look like a network
 * blip — no recursion into `.cause` here; that's `isTransientNetworkError`'s job.
 */
function looksTransientAtThisLevel(e: {
  code?: string;
  name?: string;
  message?: string;
  transient?: boolean;
}): boolean {
  // Explicitly tagged by a caller that knows the error is a transport fault
  // (see `markTransient`) — not inferred from the error's type/name, since a
  // SyntaxError (say) is just as often a programmer bug as a wire fault.
  if (e.transient === true) return true;
  if (e.code && TRANSIENT_NETWORK_CODES.has(e.code)) return true;
  if (e.name === 'AbortError') return true;
  const message = e.message ?? '';
  return /fetch failed|network|ENOTFOUND|socket hang up|connection error|connection timeout/i.test(
    message,
  );
}

/**
 * Whether a status-less error looks like a network blip worth retrying, as
 * opposed to a programmer bug (TypeError, RangeError, ...) that will fail
 * identically on every attempt. Judged by `code`/`name`/message since fetch
 * and the OpenAI SDK don't agree on a single shape for these.
 *
 * The openai@4 SDK wraps a dropped connection as `APIConnectionError`, whose
 * own shape is `{status: undefined, code: undefined, message: 'Connection
 * error.'}` — none of that is recognizable on its own. The real cause (an
 * ECONNRESET, a fetch TypeError, ...) lives in `err.cause`, so this recurses
 * into `.cause` (bounded depth, since causes can chain arbitrarily deep) to
 * find it, in addition to matching the SDK's own generic wording.
 */
function isTransientNetworkError(err: unknown, depth = 0): boolean {
  if (!(err instanceof Error) && typeof err !== 'object') return false;
  if (err === null) return false;
  const e = err as {
    code?: string;
    name?: string;
    message?: string;
    transient?: boolean;
    cause?: unknown;
  };
  if (looksTransientAtThisLevel(e)) return true;
  if (depth < MAX_CAUSE_DEPTH && e.cause !== undefined && e.cause !== err) {
    return isTransientNetworkError(e.cause, depth + 1);
  }
  return false;
}

/**
 * Tag an error as a transient transport fault so `isRetryable` retries it.
 * Used by callers that parse a provider response body and know a parse
 * failure there means a truncated/garbled wire response (a real transport
 * fault) rather than a generic SyntaxError — which `isRetryable` otherwise
 * treats as a programmer bug that will fail identically on every attempt.
 * Mutates and returns the same error so it can be thrown inline: `throw
 * markTransient(err)`.
 */
export function markTransient<E>(err: E): E {
  if (err && typeof err === 'object') {
    (err as { transient?: boolean }).transient = true;
  }
  return err;
}

/**
 * Whether an error is worth retrying: transient network drops and the transient
 * HTTP statuses (429 rate-limit, 5xx). A permanent 4xx (401 bad key, 400 invalid
 * request, content filter) will fail again identically, so retrying it only
 * triples latency before the resilient client degrades (ADR-0049). Errors with
 * no status are only retried when they look network-ish (ECONNRESET, timeout,
 * fetch failure, ...) — a status-less TypeError/RangeError is a programmer bug
 * that will fail identically every time, so it fails fast instead.
 */
export function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number; statusCode?: number })?.status
    ?? (err as { statusCode?: number })?.statusCode;
  if (typeof status !== 'number') return isTransientNetworkError(err);
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
