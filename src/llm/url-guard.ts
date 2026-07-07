/**
 * Shared output-URL guard (ADR-0053/0054, security audit follow-up). Both the
 * reasoner's `discuss` and the chat agent's answer guard must decide whether a
 * URL the model wrote is one the tools/context actually surfaced. A naive
 * `answer.startsWith(grounded) || grounded.startsWith(answer)` string check is
 * exploitable two ways: an attacker can suffix a grounded host
 * (`https://good.example.evil.tld/...` "starts with" `https://good.example`),
 * and any truncated fragment (`https://e`) "is started by" every longer
 * grounded URL. Parsing with `new URL` and comparing the real origin + a
 * path-prefix on a segment boundary closes both holes.
 */
export function isGroundedUrl(url: string, grounded: Iterable<string>): boolean {
  const candidate = tryParse(url);
  if (!candidate) return false;
  for (const g of grounded) {
    const groundedUrl = tryParse(g);
    if (!groundedUrl) continue;
    if (candidate.protocol !== groundedUrl.protocol) continue;
    if (candidate.host.toLowerCase() !== groundedUrl.host.toLowerCase()) continue;
    if (candidate.search !== '' || candidate.hash !== '') {
      // A query string or fragment can smuggle an attacker-controlled URL
      // past a path-prefix match (`?redirect=https://evil.tld`, `#https://evil.tld`).
      // Fail closed: only an exact match (path, search, and hash all identical
      // to a grounded URL) counts — no path-prefix leniency once there's a
      // query or fragment to hide something in.
      if (
        candidate.pathname === groundedUrl.pathname &&
        candidate.search === groundedUrl.search &&
        candidate.hash === groundedUrl.hash
      ) {
        return true;
      }
      continue;
    }
    if (isPathPrefix(groundedUrl.pathname, candidate.pathname)) return true;
  }
  return false;
}

/**
 * A URL lifted from prose by a regex often drags along trailing sentence
 * punctuation ("...at https://example.com/x." — the period is not part of
 * the link). Split it off before grounding so a real, grounded URL followed
 * by a period isn't rejected for a path that doesn't actually exist.
 *
 * This only trims trailing punctuation off the candidate string being
 * checked; it has no effect on what counts as "grounded". It cannot be used
 * to widen grounding — the `trailing` piece is reattached unchanged by
 * callers after `isGroundedUrl` accepts `url`, so an attacker can't smuggle
 * anything through by choosing what looks like punctuation.
 */
export function splitTrailingPunctuation(raw: string): { url: string; trailing: string } {
  const m = /[.,;:!?]+$/.exec(raw);
  if (!m) return { url: raw, trailing: '' };
  return { url: raw.slice(0, -m[0].length), trailing: m[0] };
}

function tryParse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * True when `prefix` matches `path` exactly, or on a `/`-segment boundary.
 *
 * A grounded root path (`/`) is a special case: it must NOT grant grounding
 * to every path on the host (`/` is technically a prefix of everything on a
 * naive segment-boundary check, since `/` + anything already starts with
 * `/`). Fail closed — a grounded `/` only grounds `/` itself.
 */
function isPathPrefix(prefix: string, path: string): boolean {
  if (path === prefix) return true;
  if (prefix === '/') return false;
  const base = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return path.startsWith(base);
}
