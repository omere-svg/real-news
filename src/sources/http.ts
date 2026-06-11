/**
 * The HTTP seam for Source adapters. Injecting this keeps adapters off the
 * network in tests (a fake fetcher returns fixtures) while production uses the
 * real implementation. Strictly zero scraping — fetches JSON from official APIs.
 */
export type JsonFetcher = (url: string) => Promise<unknown>;

/** Production fetcher: GET `url`, parse JSON, throw on a non-2xx response. */
export const fetchJson: JsonFetcher = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
};
