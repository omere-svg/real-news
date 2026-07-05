/**
 * Run `fn` over `items` with at most `limit` promises in flight, preserving
 * input order in the results. The tick's cluster/resolve stages make one LLM
 * round-trip per item; doing them with bounded concurrency (rather than a serial
 * `for await`) is what keeps a tick's wall-time under the interval without
 * firing hundreds of requests at once. Pure control-flow — no domain knowledge.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  const width = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

/** Default in-flight confirm calls per stage (ADR — tick throughput). */
export const DEFAULT_CONFIRM_CONCURRENCY = 8;
