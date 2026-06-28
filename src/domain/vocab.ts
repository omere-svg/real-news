/**
 * Controlled-vocabulary matching shared across seams. The domain owns the
 * vocabularies (TOPICS in `types.ts`); this is the one place that decides what
 * "matches" a vocabulary member, so the Reasoner's schema boundary and the
 * bot's preference parsing can never drift apart.
 */

/** The canonical vocabulary member matching `raw` (case-insensitive), or null. */
export function canonical<T extends string>(
  vocab: readonly T[],
  raw: string,
): T | null {
  const needle = raw.trim().toLowerCase();
  return vocab.find((v) => v.toLowerCase() === needle) ?? null;
}
