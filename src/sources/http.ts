/**
 * The HTTP seam for Source adapters. Injecting this keeps adapters off the
 * network in tests (a fake fetcher returns fixtures) while production uses the
 * real implementation. Strictly zero scraping — fetches JSON from official APIs.
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

/** Production fetcher: GET `url`, parse JSON (or text), throw on a non-2xx response. */
export const fetchJson: JsonFetcher = async (url, options) => {
  const res = await fetch(url, {
    headers: { accept: 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  return options?.as === 'text' ? res.text() : res.json();
};
