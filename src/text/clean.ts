/**
 * Canonical text-cleaning for source snippets (ADR-0051). Previously the markup
 * strip and HTML-entity decode were copy-pasted across the pipeline and the RSS
 * parser — and the two entity decoders diverged (one handled ~13 named entities,
 * the other only 5), so the same entity rendered differently depending on the
 * path. One owner here removes that inconsistency.
 */

/** Common named HTML entities → their characters. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

/** String.fromCodePoint that never throws on an out-of-range code point. */
function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * Decode the HTML entities that show up in RSS/API snippets — numeric (`&#47;`),
 * hexadecimal (`&#x2F;`), and the common named ones — in a single pass (so a
 * decoded `&amp;` can't re-open another entity). An UNKNOWN named entity is left
 * intact rather than dropped, so a character is never silently lost (ADR-0051).
 */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? safeFromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : match;
  });
}

/** Strip HTML/XML tags to spaces. */
export const stripHtml = (s: string): string => s.replace(/<[^>]+>/g, ' ');

/** Collapse runs of whitespace to single spaces and trim. */
export const collapseWhitespace = (s: string): string => s.replace(/\s+/g, ' ').trim();
