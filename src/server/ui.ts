import { TOPICS } from '../domain/types.js';
import type { TickRecord } from '../db/tick-report-repo.js';
import { COMPONENT_LABELS } from '../presentation/score-explanation.js';

/** Defaults the viewer seeds its controls from (ADR-0015). */
export interface UiDefaults {
  readonly minutes: number;
  /** Pre-checked topics; empty/omitted means none checked ("All"). */
  readonly topics?: readonly string[];
}

/** Render the topic multi-select as a checkbox group, pre-checking defaults. */
function topicCheckboxes(checked: readonly string[]): string {
  const set = new Set(checked);
  return TOPICS.map(
    (t) =>
      `<label class="chk"><input type="checkbox" name="topic" value="${t}"${
        set.has(t) ? ' checked' : ''
      } />${t}</label>`,
  ).join('');
}

/**
 * The single-page read-only viewer (ADR-0011/0014). Plain HTML + fetch, no build
 * step. Controls are seeded from the configured presentation defaults (ADR-0015).
 */
export function renderUI(defaults: UiDefaults): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Project Horizon</title>
<style>
  :root { --bg:#0f1115; --card:#181b22; --muted:#8b93a7; --fg:#e7ebf3; --accent:#e0a458; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 ui-sans-serif,system-ui,sans-serif; }
  header { padding:24px 20px 8px; max-width:860px; margin:0 auto; }
  h1 { margin:0; font-size:22px; letter-spacing:.3px; }
  .sub { color:var(--muted); font-size:13px; margin-top:4px; }
  .filters { max-width:860px; margin:12px auto; padding:0 20px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  select { background:var(--card); color:var(--fg); border:1px solid #2a2f3a; border-radius:8px; padding:6px 10px; }
  .topics { display:flex; gap:6px; flex-wrap:wrap; align-items:center; background:var(--card); border:1px solid #2a2f3a; border-radius:8px; padding:5px 8px; }
  .topics .lbl { color:var(--muted); font-size:13px; }
  .chk { display:inline-flex; align-items:center; gap:4px; font-size:13px; color:var(--fg); cursor:pointer; }
  .chk input { accent-color:var(--accent); }
  .budget { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:13px; }
  .budget input { accent-color:var(--accent); }
  main { max-width:860px; margin:0 auto; padding:8px 20px 60px; }
  .card { background:var(--card); border:1px solid #232833; border-radius:12px; padding:16px; margin:12px 0; }
  .row { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
  .title { font-size:17px; font-weight:600; margin:0; }
  .title a { color:var(--fg); text-decoration:none; }
  .title a:hover { text-decoration:underline; }
  .score { color:var(--accent); font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .badges { margin:8px 0; display:flex; gap:6px; flex-wrap:wrap; }
  .badge { font-size:12px; color:var(--muted); border:1px solid #2a2f3a; border-radius:999px; padding:2px 9px; }
  .why { color:#c7cede; margin:8px 0 0; }
  .why-score { margin-top:8px; font-size:13px; color:var(--muted); }
  .why-score summary { cursor:pointer; color:var(--accent); list-style:none; }
  .why-score summary::-webkit-details-marker { display:none; }
  .why-score summary::before { content:'▸ '; }
  .why-score[open] summary::before { content:'▾ '; }
  .why-score table { margin:8px 0 4px; border-collapse:collapse; width:100%; max-width:360px; }
  .why-score td { padding:1px 10px 1px 0; }
  .why-score td.num { text-align:right; color:var(--fg); font-variant-numeric:tabular-nums; }
  .meta { color:var(--muted); font-size:12px; margin-top:8px; }
  .empty { color:var(--muted); text-align:center; padding:48px 0; }
  pre.doc { white-space:pre-wrap; word-wrap:break-word; font:15px/1.6 ui-sans-serif,system-ui,sans-serif; margin:0; }
</style>
</head>
<body>
<header>
  <h1>🌅 Project Horizon</h1>
  <div class="sub">Background intelligence — stories scored, deduped, and explained.</div>
</header>
<div class="filters">
  <select id="format">
    <option value="stories">Stories</option>
    <option value="brief">Text brief</option>
    <option value="outline">Topic outline</option>
    <option value="podcast">Podcast script</option>
  </select>
  <div class="topics" id="topics"><span class="lbl">Topics:</span>${topicCheckboxes(defaults.topics ?? [])}</div>
  <label class="budget" id="budgetCtl">⏱ <input id="minutes" type="range" min="1" max="30" value="${defaults.minutes}" /> <span id="minutesLabel">${defaults.minutes} min</span></label>
</div>
<main id="list"><div class="empty">Loading…</div></main>
<script>
const list = document.getElementById('list');
const formatSel = document.getElementById('format');
const topicsBox = document.getElementById('topics');
const minutesInput = document.getElementById('minutes');

function selectedTopics() {
  return [...topicsBox.querySelectorAll('input[name="topic"]:checked')].map(c => c.value);
}
const minutesLabel = document.getElementById('minutesLabel');
const budgetCtl = document.getElementById('budgetCtl');
const DOC_FIELD = { brief: 'brief', outline: 'outline', podcast: 'script' };

function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// "Why this score?" — render the persisted breakdown. Axis labels are injected
// from the shared interpreter (ADR-0037), so there's one source of truth.
const SCORE_LABELS = ${JSON.stringify(COMPONENT_LABELS)};
function pct(v){ return Math.round(Number(v)*100) + '%'; }
function breakdownHtml(b){
  if(!b) return '';
  const rows = (b.components||[])
    .map(c => '<tr><td>'+esc(SCORE_LABELS[c.key]||c.key)+'</td><td class="num">'+pct(c.value)+'</td></tr>');
  const s = b.signals||{};
  const recency = b.recencyFactor!=null ? pct(b.recencyFactor) : '100%';
  const nudge = Math.abs(b.signalNudge) > 0.05 ? ' · attention/macro nudge '+(b.signalNudge>=0?'+':'')+Number(b.signalNudge).toFixed(1) : '';
  const facts = (s.corroboration||1)+' source(s) · recency '+recency+nudge;
  return '<details class="why-score"><summary>Why this score?</summary>'+
    '<table>'+rows.join('')+'</table>'+
    '<div class="meta">'+esc(facts)+'</div></details>';
}

async function load() {
  const format = formatSel.value;
  const topics = selectedTopics();
  budgetCtl.style.display = format === 'stories' ? 'none' : 'flex';
  minutesLabel.textContent = minutesInput.value + ' min';

  if (format === 'stories') return loadStories(topics);

  if (format === 'outline' && topics.length !== 1) {
    list.innerHTML = '<div class="empty">Pick exactly one topic for the outline.</div>';
    return;
  }
  const params = new URLSearchParams({ minutes: minutesInput.value });
  for (const t of topics) params.append('topic', t);
  const res = await fetch('/api/' + format + '?' + params);
  const body = await res.json();
  const text = body[DOC_FIELD[format]] || '';
  list.innerHTML = '<div class="card"><pre class="doc">' + esc(text) + '</pre></div>';
}

async function loadStories(topics) {
  const params = new URLSearchParams({ limit: '50' });
  for (const t of topics) params.append('topic', t);
  const res = await fetch('/api/stories?' + params);
  const { stories } = await res.json();
  if (!stories.length) { list.innerHTML = '<div class="empty">No stories yet. The worker fills the cache on each tick.</div>'; return; }
  list.innerHTML = stories.map(s => {
    const title = s.url ? '<a href="'+s.url+'" target="_blank" rel="noopener">'+esc(s.title)+'</a>' : esc(s.title);
    const sources = [...new Set(s.memberRefs.map(r => r.source))].join(', ');
    return '<div class="card"><div class="row"><p class="title">'+title+'</p>'+
      '<span class="score">'+s.significance.toFixed(1)+'</span></div>'+
      '<div class="badges"><span class="badge">'+esc(s.topic)+'</span></div>'+
      (s.whyItMatters ? '<p class="why">'+esc(s.whyItMatters)+'</p>' : '')+
      breakdownHtml(s.scoreBreakdown)+
      '<div class="meta">'+s.memberRefs.length+' source(s): '+esc(sources)+'</div></div>';
  }).join('');
}

formatSel.onchange = load;
topicsBox.addEventListener('change', load);
minutesInput.oninput = () => { minutesLabel.textContent = minutesInput.value + ' min'; };
minutesInput.onchange = load;
load();
</script>
</body>
</html>`;
}

// --- Observability dashboard (ADR-0033) ---

function escHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      default: return '&quot;';
    }
  });
}

/** Short "Nm ago" / "Nh ago" age from a past epoch-ms to a reference now. */
function ago(thenMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

/**
 * The server-rendered observability dashboard (ADR-0033): a health banner plus a
 * table of recent tick outcomes. Data is passed in (no client fetch); the page
 * self-refreshes. `nowMs` is injected for testable "age" rendering.
 */
export function renderDashboard(ticks: readonly TickRecord[], nowMs = Date.now()): string {
  const last = ticks[0];
  const issues = (t: TickRecord): number =>
    t.failed.length + t.signalsFailed.length + t.skipped.length + t.signalsSkipped.length;
  const degraded = !last || !last.ok || issues(last) > 0;
  const banner = !last
    ? 'No ticks recorded yet — the worker writes one on each cycle.'
    : `${last.ok ? (degraded ? 'Degraded' : 'Healthy') : 'Last tick FAILED'} · ` +
      `last tick ${ago(last.ranAt, nowMs)} · ${last.storiesUpserted} stories · ${last.extracted} items`;

  const rows = ticks
    .map((t) => {
      const fails = [...t.failed, ...t.signalsFailed]
        .map((f) => `${f.source}: ${f.error}`)
        .join('; ');
      const skips = [...t.skipped, ...t.signalsSkipped].join(', ');
      const status = t.ok ? (issues(t) > 0 ? '⚠️' : '✅') : '❌';
      return (
        '<tr>' +
        `<td>${ago(t.ranAt, nowMs)}</td>` +
        `<td class="c">${status}</td>` +
        `<td class="num">${t.durationMs}ms</td>` +
        `<td class="num">${t.extracted}</td>` +
        `<td class="num">${t.storiesUpserted}</td>` +
        `<td class="num">${t.signalsObserved}</td>` +
        `<td class="muted">${escHtml(skips)}</td>` +
        `<td class="muted">${escHtml(t.error ? t.error : fails)}</td>` +
        '</tr>'
      );
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="60" />
<title>Horizon — Dashboard</title>
<style>
  :root { --bg:#0f1115; --card:#181b22; --muted:#8b93a7; --fg:#e7ebf3; --accent:#e0a458; --ok:#5fd38d; --bad:#e06c75; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 ui-sans-serif,system-ui,sans-serif; }
  header { max-width:1000px; margin:0 auto; padding:24px 20px 8px; }
  h1 { margin:0; font-size:20px; }
  .sub { color:var(--muted); font-size:13px; margin-top:4px; }
  .banner { max-width:1000px; margin:12px auto; padding:12px 16px; border-radius:10px; font-weight:600;
            background:var(--card); border:1px solid #2a2f3a; }
  .banner.ok { color:var(--ok); } .banner.bad { color:var(--bad); }
  main { max-width:1000px; margin:0 auto; padding:8px 20px 60px; }
  table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
  th, td { text-align:left; padding:7px 10px; border-bottom:1px solid #232833; }
  th { color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.4px; }
  td.num { text-align:right; } td.c { text-align:center; } td.muted { color:var(--muted); font-size:13px; }
  .empty { color:var(--muted); text-align:center; padding:40px 0; }
  a { color:var(--accent); }
</style>
</head>
<body>
<header>
  <h1>🌅 Horizon — Operations</h1>
  <div class="sub">Tick observability (ADR-0033) · auto-refreshes every 60s · <a href="/">viewer</a> · <a href="/api/ticks">JSON</a></div>
</header>
<div class="banner ${degraded ? 'bad' : 'ok'}">${escHtml(banner)}</div>
<main>
  ${
    ticks.length === 0
      ? '<div class="empty">No ticks recorded yet.</div>'
      : `<table>
    <thead><tr><th>When</th><th>OK</th><th>Duration</th><th>Items</th><th>Stories</th><th>Signals</th><th>Skipped</th><th>Errors</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
  }
</main>
</body>
</html>`;
}
