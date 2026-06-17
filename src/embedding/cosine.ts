/**
 * Cosine similarity of two vectors (ADR-0007). The shared similarity measure for
 * both the within-tick blocking step and cross-tick matching (ADR-0017). Returns
 * 0 if either vector is all-zeros. Length mismatch is tolerated component-wise.
 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
