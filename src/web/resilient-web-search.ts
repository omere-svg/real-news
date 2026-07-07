import type { WebResult, WebSearch } from './web-search.js';

/**
 * Wraps any `WebSearch` so a provider error degrades to "no results" instead of
 * breaking the chat turn (ADR-0029) — the same non-blocking hygiene the Source
 * health checks give extraction (ADR-0001). The caller then answers from the
 * cache alone and tells the user it couldn't find more.
 */
export class ResilientWebSearch implements WebSearch {
  constructor(
    private readonly delegate: WebSearch,
    // Composition root wires the real Logger-backed callback (main.ts); this
    // default only covers callers (tests) that don't care about the degrade log.
    private readonly onError: (err: unknown) => void = () => undefined,
  ) {}

  async search(query: string): Promise<readonly WebResult[]> {
    try {
      return await this.delegate.search(query);
    } catch (err) {
      this.onError(err);
      return [];
    }
  }
}
