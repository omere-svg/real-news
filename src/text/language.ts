/**
 * A cheap, deterministic "is this headline probably not English?" test (ADR-0057).
 * The pipeline only spends a deep-tier `analyze` call on the top-N Stories, so
 * every other Story would otherwise render its raw source headline verbatim —
 * often a non-English one (Russian, Ukrainian, Hebrew, Arabic, CJK …). This gate
 * lets the analyze stage escalate ONLY the headlines that actually need a
 * translation to English, keeping the "one language: English" guarantee without
 * paying for a model call on the majority that are already English.
 *
 * It is intentionally a heuristic, not a language detector: a false positive
 * only costs one cheap translation call (which harmlessly cleans an already-
 * English title), so the test errs toward escalating anything that isn't plainly
 * ASCII English.
 */

/**
 * A LETTER outside the basic-ASCII range. This is the whole test: a non-Latin
 * script (Cyrillic, Hebrew, Arabic, Greek, CJK, Hangul, Devanagari …) is made of
 * such letters, and an accented Latin word (á, é, ñ, ü, ç …) — the tell of
 * Spanish/French/Portuguese/German/Turkish/… — contains them too. We match
 * letters only, so an English headline whose sole "foreign" mark is a curly
 * quote, an em-dash, "€", or "°" does NOT trip the gate.
 *
 * A false positive (an English headline that happens to contain an accented
 * proper noun like "Beyoncé") only costs a single cheap translation call, whose
 * prompt explicitly leaves an already-English title alone — so we deliberately
 * err toward escalating rather than risk letting foreign text through. What this
 * cannot catch is unaccented Latin foreign text (e.g. "El presidente habla hoy");
 * reliably detecting that needs a real language model, which the deep tier
 * already applies once such a Story reaches the top-N.
 */
const NON_ASCII_LETTER = /[^\u0000-\u007F]/u;
const ANY_NON_ASCII_LETTER = /\p{L}/u;

/**
 * True when `text` is unlikely to be plain-ASCII English and should be
 * translated before it reaches the store/UI (ADR-0057). Any non-ASCII letter ⇒
 * true; plain ASCII ⇒ false.
 */
export function looksNonEnglish(text: string): boolean {
  if (!text) return false;
  // A non-ASCII *letter* (not punctuation/symbol/currency): scan char by char so
  // "café" trips it but "AI — the year ahead" or "Q4 earnings up 3°" do not.
  for (const ch of text) {
    if (NON_ASCII_LETTER.test(ch) && ANY_NON_ASCII_LETTER.test(ch)) return true;
  }
  return false;
}

/**
 * Characters from writing systems other than Latin: Greek, Cyrillic, Armenian,
 * Hebrew, Arabic, Devanagari, CJK punctuation/Hiragana/Katakana, CJK ideographs,
 * and Hangul. Accented Latin (é, ñ, ü, ç) is Latin and deliberately NOT here.
 */
const NON_LATIN_SCRIPT =
  /[\u0370-\u03FF\u0400-\u04FF\u0530-\u058F\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u3000-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/u;

/**
 * True when `text` contains a non-Latin script (ADR-0059) — a strong, cheap
 * signal that a stored summary / why-it-matters is not English and should be
 * re-analyzed. Unlike `looksNonEnglish` (used for one-line headlines, where a
 * cheap translate harmlessly cleans accented Latin), this is used to gate the
 * *expensive* deep-tier heal of body text, so it must NOT fire on an English
 * sentence that merely contains a foreign name ("café", "Beyoncé", "Łódź") —
 * only on genuinely foreign script (中文, кириллица, עברית, العربية).
 */
export function hasNonLatinScript(text: string): boolean {
  return Boolean(text) && NON_LATIN_SCRIPT.test(text);
}
