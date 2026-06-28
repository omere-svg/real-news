/**
 * The web-search seam (ADR-0029). The chat feature is cache-grounded first
 * (Principle 4); only when the Story cache can't answer a question does it
 * escalate to a live web lookup behind this seam. Pluggable and **off by
 * default** — the composition root wires a real provider only when configured,
 * so tests and the default deployment never touch the open internet.
 */
export interface WebResult {
  readonly title: string;
  readonly url: string;
  /** A short extract supporting the result, used to ground the answer. */
  readonly snippet: string;
}

export interface WebSearch {
  /** Relevant web results for a query, most relevant first; `[]` when none. */
  search(query: string): Promise<readonly WebResult[]>;
}
