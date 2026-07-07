/**
 * The HTTP seam for Source adapters. Injecting this keeps adapters off the
 * network in tests (a fake fetcher returns fixtures) while production uses the
 * real implementation. Strictly zero scraping — fetches JSON from official APIs.
 * Hardened (ADR-0023): a per-request timeout and a max response-size cap so a
 * slow or oversized upstream fails the one Source, never the whole tick.
 */
export interface FetchOptions {
  /** Extra request headers (e.g. SEC EDGAR requires a User-Agent). */
  readonly headers?: Record<string, string>;
  /** Parse the response as text instead of JSON (e.g. arXiv's Atom XML). */
  readonly as?: 'json' | 'text';
  /**
   * Override the default per-request timeout for this one call (ADR-0039). A few
   * official APIs are legitimately slow — GDELT's doc API routinely takes ~13s —
   * and would otherwise trip the global timeout every tick. Absent ⇒ global limit.
   */
  readonly timeoutMs?: number;
}

export type JsonFetcher = (
  url: string,
  options?: FetchOptions,
) => Promise<unknown>;

export interface FetchLimits {
  /** Abort the request after this many ms. */
  readonly timeoutMs: number;
  /** Reject a response body larger than this many bytes. */
  readonly maxBytes: number;
}

/** Default limits used by the production fetcher; overridden from config in main. */
export const DEFAULT_FETCH_LIMITS: FetchLimits = {
  timeoutMs: 10_000,
  maxBytes: 5_000_000,
};

/** Descriptive UA so bot-manager CDNs don't 403 the anonymous Node default (ADR-0049). */
export const DEFAULT_USER_AGENT =
  'project-horizon/1.0 (+https://github.com/omere-svg/real-news; horizon@example.com)';

type FetchImpl = typeof fetch;

/**
 * Build a hardened JSON fetcher over a given `fetch` implementation (injectable
 * for tests). Applies a timeout via AbortSignal and enforces a size cap from the
 * Content-Length header and the actual body length.
 */
export function makeFetchJson(
  fetchImpl: FetchImpl,
  limits: FetchLimits,
): JsonFetcher {
  return async (url, options) => {
    // Default Accept follows the parse mode: text feeds (RSS/Atom) must not claim
    // application/json — some servers (e.g. GDACS) 406 on it. A caller header wins.
    const defaultAccept = options?.as === 'text' ? '*/*' : 'application/json';
    // A descriptive User-Agent: Node's default `User-Agent: node` is 403'd by
    // bot-manager CDNs (Akamai/Cloudflare) that front some feeds — NBER returned
    // 403 without a UA and 200 with one (ADR-0049). A caller header still wins.
    const res = await fetchImpl(url, {
      headers: { accept: defaultAccept, 'user-agent': DEFAULT_USER_AGENT, ...options?.headers },
      signal: AbortSignal.timeout(options?.timeoutMs ?? limits.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
    }

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > limits.maxBytes) {
      throw new Error(`GET ${url} response too large: ${declared} > ${limits.maxBytes} bytes`);
    }

    const body = await res.text();
    if (body.length > limits.maxBytes) {
      throw new Error(`GET ${url} response too large: ${body.length} > ${limits.maxBytes} bytes`);
    }
    return options?.as === 'text' ? body : JSON.parse(body);
  };
}

/** Production fetcher: hardened, over the global `fetch`, with default limits. */
export const fetchJson: JsonFetcher = makeFetchJson(fetch, DEFAULT_FETCH_LIMITS);

/** Minimum spacing between requests to a rate-limited host, keyed by hostname. */
export type HostRateLimits = Readonly<Record<string, number>>;

/** The hosts that enforce their own request rate. GDELT allows ~1 req / 5s and
 * returns 429 when two adapters (the story feed + the tone signal) hit it in the
 * same tick — so serialize and space calls to it (ADR-0047). */
export const DEFAULT_HOST_RATE_LIMITS: HostRateLimits = {
  'api.gdeltproject.org': 5_000,
};

/**
 * Wrap a fetcher so requests to a rate-limited host are serialized and spaced by
 * at least the configured interval (ADR-0047). GDELT's story adapter and its tone
 * Signal both call `api.gdeltproject.org`, and the tick fires extraction and
 * signal observation concurrently — without this they collide and trip GDELT's
 * ~1-req/5s limit (429) every tick. Calls to any other host pass straight
 * through with no added latency.
 */
export function rateLimitByHost(
  fetcher: JsonFetcher,
  limits: HostRateLimits = DEFAULT_HOST_RATE_LIMITS,
): JsonFetcher {
  // Per-host serialization tail + the timestamp of the last completed request.
  const tail = new Map<string, Promise<unknown>>();
  const lastAt = new Map<string, number>();

  const runSpaced = async (
    host: string,
    minMs: number,
    url: string,
    options?: FetchOptions,
  ): Promise<unknown> => {
    const wait = Math.max(0, (lastAt.get(host) ?? 0) + minMs - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fetcher(url, options);
    } finally {
      lastAt.set(host, Date.now());
    }
  };

  return (url, options) => {
    const host = hostOf(url);
    const minMs = host ? limits[host] : undefined;
    if (!host || !minMs) return fetcher(url, options);

    // Chain onto this host's tail so requests never overlap; a prior failure
    // must not break the chain, so swallow it before scheduling the next.
    const prev = tail.get(host) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => runSpaced(host, minMs, url, options));
    tail.set(host, next);
    return next;
  };
}

/** The hostname of a URL, or null when it can't be parsed. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
