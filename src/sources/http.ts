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
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json', ...options?.headers },
      signal: AbortSignal.timeout(limits.timeoutMs),
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
