/**
 * Canonicalize a URL into a stable dedup key (ADR-0047). Several feeds append
 * per-fetch tracking params (utm_*, fbclid, gclid, …) or vary trailing slashes,
 * which would otherwise make the SAME article arrive under different
 * `externalId`s and pile up as duplicate raw_items. Normalizing the URL —
 * lowercased host, tracking params stripped, fragment dropped, trailing slash
 * removed — gives one article one id. Falls back to the raw string when the
 * input isn't a parseable absolute URL (the caller still gets a usable key).
 */

/** Query params known to be per-visit/marketing noise, safe to drop. */
const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref',
  'ref_src',
  'cmpid',
  'spm',
]);

/** True for the utm_* family, which is always tracking. */
function isTracking(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower);
}

export function canonicalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.trim();
  }

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();

  const kept = [...url.searchParams.entries()].filter(([k]) => !isTracking(k));
  // Rebuild deterministically (sorted) so param order can't split the key.
  url.search = '';
  for (const [k, v] of kept.sort((a, b) => a[0].localeCompare(b[0]))) {
    url.searchParams.append(k, v);
  }

  // Drop a lone trailing slash on the path (but keep the root "/").
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}
