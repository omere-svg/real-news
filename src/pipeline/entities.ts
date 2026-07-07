/**
 * Lightweight named-entity extraction for entity-aware blocking (ADR-0036). Pure,
 * deterministic, no LLM — a cheap regex pass over an item's title + body lead. Used
 * only to *relax* the dedup similarity threshold when two items share entities; the
 * Reasoner confirm remains the precision guard, so imperfect extraction is safe.
 */

/** Common capitalized/sentence-initial words that aren't useful entities. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its', 'we', 'our', 'us',
  'in', 'on', 'of', 'for', 'and', 'or', 'but', 'to', 'as', 'at', 'by', 'from', 'with',
  'is', 'are', 'was', 'were', 'be', 'has', 'have', 'will', 'live', 'latest', 'update',
  'updates', 'news', 'report', 'reports', 'breaking', 'more', 'new', 'how', 'why',
  'what', 'when', 'who', 'where', 'after', 'amid', 'over', 'into', 'says', 'said',
]);

/**
 * Candidate named entities in `text`, normalized to lowercase: capitalized
 * proper-noun phrases (e.g. "Venezuela", "Jorge Rodríguez") and short acronyms
 * (e.g. "AI", "WHO", "GLM"), minus stopwords.
 */
export function extractEntities(text: string): Set<string> {
  const out = new Set<string>();

  // Capitalized proper-noun phrases (one or more capitalized words in a row).
  const proper = text.match(/[A-ZÀ-Þ][\wÀ-ÿ'’-]+(?:\s+[A-ZÀ-Þ][\wÀ-ÿ'’-]+)*/g) ?? [];
  for (const m of proper) {
    const norm = m.toLowerCase().trim();
    if (norm.length >= 3 && !STOPWORDS.has(norm)) out.add(norm);
    // Also index each constituent word: cross-outlet phrasings rarely agree on
    // phrase boundaries ("Western Venezuela" vs "Venezuela", or a Title-Case
    // headline that greedily matches as ONE long phrase), and a phrase-only set
    // then shares nothing. Recall is what matters here — the Reasoner confirm
    // stays the precision guard (ADR-0036).
    const words = norm.split(/\s+/);
    if (words.length > 1) {
      for (const w of words) {
        if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
      }
    }
  }

  // Short all-caps acronyms (AI, WHO, SEC, NASA, GLM).
  const acronyms = text.match(/\b[A-Z]{2,6}\b/g) ?? [];
  for (const m of acronyms) {
    const norm = m.toLowerCase();
    if (!STOPWORDS.has(norm)) out.add(norm);
  }

  // Salient numbers — death tolls ("3,500"), magnitudes ("7.1"), quantities.
  // Two outlets phrasing one event differently still quote the same figures, so
  // a shared number is a strong same-event signal. Bare years and small counts
  // are too ubiquitous to discriminate, so they are skipped.
  const numbers = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  for (const m of numbers) {
    const norm = m.replace(/,/g, '').replace(/\.$/, '');
    if (/^(19|20)\d{2}$/.test(norm)) continue; // a bare year
    if (norm.includes('.') || Number(norm) >= 100) out.add(norm);
  }

  return out;
}

/** How many entities two extracted sets share (case-normalized). */
export function sharedEntityCount(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const e of small) if (large.has(e)) n += 1;
  return n;
}
