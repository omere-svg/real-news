/** Defaults the viewer seeds its controls from (ADR-0015). */
export interface UiDefaults {
  readonly minutes: number;
  /** Pre-selected when exactly one region is preferred; else "All". */
  readonly region?: string;
  /** Pre-selected when exactly one topic is preferred; else "All". */
  readonly topic?: string;
}

/** Mark a <select>/<option> selected for the given value (controlled vocab → safe). */
function sel(value: string | undefined, candidate: string): string {
  return value === candidate ? ' selected' : '';
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
  <select id="region"><option value="">All regions</option><option${sel(defaults.region, 'World')}>World</option><option${sel(defaults.region, 'Israel')}>Israel</option></select>
  <select id="topic"><option value="">All topics</option><option${sel(defaults.topic, 'AI')}>AI</option><option${sel(defaults.topic, 'Geopolitics')}>Geopolitics</option><option${sel(defaults.topic, 'Politics')}>Politics</option><option${sel(defaults.topic, 'Sports')}>Sports</option><option${sel(defaults.topic, 'Business')}>Business</option><option${sel(defaults.topic, 'Science')}>Science</option><option${sel(defaults.topic, 'Other')}>Other</option></select>
  <label class="budget" id="budgetCtl">⏱ <input id="minutes" type="range" min="1" max="30" value="${defaults.minutes}" /> <span id="minutesLabel">${defaults.minutes} min</span></label>
</div>
<main id="list"><div class="empty">Loading…</div></main>
<script>
const list = document.getElementById('list');
const formatSel = document.getElementById('format');
const regionSel = document.getElementById('region');
const topicSel = document.getElementById('topic');
const minutesInput = document.getElementById('minutes');
const minutesLabel = document.getElementById('minutesLabel');
const budgetCtl = document.getElementById('budgetCtl');
const DOC_FIELD = { brief: 'brief', outline: 'outline', podcast: 'script' };

function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function load() {
  const format = formatSel.value;
  const region = regionSel.value;
  const topic = topicSel.value;
  budgetCtl.style.display = format === 'stories' ? 'none' : 'flex';
  minutesLabel.textContent = minutesInput.value + ' min';

  if (format === 'stories') return loadStories(region, topic);

  if (format === 'outline' && !topic) {
    list.innerHTML = '<div class="empty">Pick a topic for the outline.</div>';
    return;
  }
  const params = new URLSearchParams({ minutes: minutesInput.value });
  if (region) params.set('region', region);
  if (topic) params.set('topic', topic);
  const res = await fetch('/api/' + format + '?' + params);
  const body = await res.json();
  const text = body[DOC_FIELD[format]] || '';
  list.innerHTML = '<div class="card"><pre class="doc">' + esc(text) + '</pre></div>';
}

async function loadStories(region, topic) {
  const params = new URLSearchParams({ limit: '50' });
  if (region) params.set('region', region);
  if (topic) params.set('topic', topic);
  const res = await fetch('/api/stories?' + params);
  const { stories } = await res.json();
  if (!stories.length) { list.innerHTML = '<div class="empty">No stories yet. The worker fills the cache on each tick.</div>'; return; }
  list.innerHTML = stories.map(s => {
    const title = s.url ? '<a href="'+s.url+'" target="_blank" rel="noopener">'+esc(s.title)+'</a>' : esc(s.title);
    const sources = [...new Set(s.memberRefs.map(r => r.source))].join(', ');
    return '<div class="card"><div class="row"><p class="title">'+title+'</p>'+
      '<span class="score">'+s.significance.toFixed(1)+'</span></div>'+
      '<div class="badges"><span class="badge">'+esc(s.region)+'</span><span class="badge">'+esc(s.topic)+'</span></div>'+
      (s.whyItMatters ? '<p class="why">'+esc(s.whyItMatters)+'</p>' : '')+
      '<div class="meta">'+s.memberRefs.length+' source(s): '+esc(sources)+'</div></div>';
  }).join('');
}

formatSel.onchange = load;
regionSel.onchange = load;
topicSel.onchange = load;
minutesInput.oninput = () => { minutesLabel.textContent = minutesInput.value + ' min'; };
minutesInput.onchange = load;
load();
</script>
</body>
</html>`;
}
