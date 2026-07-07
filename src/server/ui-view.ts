import { TOPICS } from '../domain/types.js';

/**
 * Server-side render helpers for the viewer (ui.ts, ADR-0011/0014). Split out so
 * the escaping and "why this score?" breakdown logic have a direct unit-test
 * surface instead of living only inside the inline client `<script>` string.
 *
 * `escHtml`, `breakdownHtml`, and `emptyStateHtml` are also injected VERBATIM
 * (via `.toString()`) into the client script in `renderUI` — one
 * implementation, tested here in Node and shipped unchanged to the browser
 * (the same pattern `renderUI` already uses for `COMPONENT_LABELS`,
 * JSON-injected rather than re-typed).
 * Keep these functions free of closures over module state (no imports, no
 * outer-scope variables) so their source is valid standalone JS once
 * embedded — but note they are NOT fully self-contained: `breakdownHtml` and
 * `emptyStateHtml` both call `escHtml` as a free variable, so whichever
 * splice site embeds them must splice `escHtml` first (see the ordering
 * comment at the `renderUI` splice site in ui.ts).
 */

/** Escape a string for safe interpolation into HTML text/attribute contexts. */
export function escHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return String(s).replace(/[&<>"]/g, (c) => map[c] ?? c);
}

/** The subset of a Story's ScoreBreakdown the "why this score?" widget reads. */
export interface BreakdownLike {
  readonly components: readonly { readonly key: string; readonly value: number }[];
  readonly signals: { readonly corroboration: number };
  readonly recencyFactor: number | null;
  readonly signalNudge: number;
}

/**
 * Render the "Why this score?" details/bars widget for one story's breakdown.
 * `labels` maps a component key (e.g. `impact`) to its human label
 * (`COMPONENT_LABELS`, ADR-0034). Returns `''` for a missing breakdown
 * (pre-ADR-0032 stories).
 */
export function breakdownHtml(
  b: BreakdownLike | null | undefined,
  open: boolean,
  labels: Record<string, string>,
): string {
  if (!b) return '';
  const pct = (v: number): string => Math.round(Number(v) * 100) + '%';
  // A lone-source story has nothing to corroborate with — a 0% bar reads as a
  // penalty, not a fact, and contradicts the dedup pitch. Drop that row
  // entirely rather than show a bar that can only ever say "0%" (Task 21).
  const cor = Number(b.signals.corroboration) || 0;
  const isSingleSource = cor <= 1;
  const bars = b.components
    .filter((c) => !(isSingleSource && c.key === 'corroboration'))
    .map(
      (c) =>
        '<div class="lbl">' +
        escHtml(labels[c.key] || c.key) +
        '</div>' +
        '<div class="track"><div class="fill" style="width:' +
        pct(c.value) +
        '"></div></div>' +
        '<div class="val">' +
        pct(c.value) +
        '</div>',
    )
    .join('');
  const recency = b.recencyFactor != null ? pct(b.recencyFactor) : '100%';
  const nudge =
    Math.abs(b.signalNudge) > 0.05
      ? ' · attention/macro nudge ' + (b.signalNudge >= 0 ? '+' : '') + Number(b.signalNudge).toFixed(1)
      : '';
  // Corroboration only when it says something ("0 sources" is noise, not a fact).
  const facts = (cor >= 1 ? cor + ' source' + (cor === 1 ? '' : 's') + ' · ' : '') + 'recency ' + recency + nudge;
  return (
    '<details class="why-score"' +
    (open ? ' open' : '') +
    '><summary>Why this score?</summary>' +
    '<div class="bars">' +
    bars +
    '</div>' +
    '<div class="meta">' +
    escHtml(facts) +
    '</div></details>'
  );
}

/** Render the topic filter as a group of pill toggles, pre-selecting defaults. */
export function topicChips(checked: readonly string[]): string {
  const set = new Set(checked);
  return TOPICS.map(
    (t) =>
      `<label class="chip" data-topic="${t}"><input type="checkbox" name="topic" value="${t}"${
        set.has(t) ? ' checked' : ''
      } /><span class="dot"></span>${t}</label>`,
  ).join('');
}

/** Short "Nm ago" / "Nh ago" age from a past epoch-ms to a reference now. */
export function ago(thenMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

/** Humanize a millisecond duration: "480ms" / "12.4s" / "4m 08s". */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

/** The viewer's "couldn't load / nothing to show" empty-state card. */
export function emptyStateHtml(headline: string, body: string): string {
  return `<div class="empty"><div class="big">${escHtml(headline)}</div>${escHtml(body)}</div>`;
}
