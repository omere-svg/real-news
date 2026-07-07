import { TOPICS } from '../domain/types.js';

/**
 * Server-side render helpers for the viewer (ui.ts, ADR-0011/0014). Split out so
 * the escaping and empty-state logic have a direct unit-test surface instead of
 * living only inside the inline client `<script>` string.
 *
 * `escHtml` and `emptyStateHtml` are also injected VERBATIM (via `.toString()`)
 * into the client script in `renderUI` — one implementation, tested here in Node
 * and shipped unchanged to the browser. Keep them free of closures over module
 * state (no imports, no outer-scope variables) so their source is valid
 * standalone JS once embedded — but note `emptyStateHtml` calls `escHtml` as a
 * free variable, so the splice site must embed `escHtml` first (see the ordering
 * comment at the `renderUI` splice site in ui.ts).
 */

/** Escape a string for safe interpolation into HTML text/attribute contexts. */
export function escHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return String(s).replace(/[&<>"]/g, (c) => map[c] ?? c);
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
