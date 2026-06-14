/** The single-page read-only viewer (ADR-0011). Plain HTML + fetch, no build step. */
export const UI_HTML = `<!doctype html>
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
  .filters { max-width:860px; margin:12px auto; padding:0 20px; display:flex; gap:8px; flex-wrap:wrap; }
  select { background:var(--card); color:var(--fg); border:1px solid #2a2f3a; border-radius:8px; padding:6px 10px; }
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
</style>
</head>
<body>
<header>
  <h1>🌅 Project Horizon</h1>
  <div class="sub">Background intelligence — stories scored, deduped, and explained.</div>
</header>
<div class="filters">
  <select id="region"><option value="">All regions</option><option>World</option><option>Israel</option></select>
  <select id="topic"><option value="">All topics</option><option>AI</option><option>Geopolitics</option><option>Politics</option><option>Sports</option><option>Business</option><option>Science</option><option>Other</option></select>
</div>
<main id="list"><div class="empty">Loading…</div></main>
<script>
const list = document.getElementById('list');
async function load() {
  const region = document.getElementById('region').value;
  const topic = document.getElementById('topic').value;
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
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
document.getElementById('region').onchange = load;
document.getElementById('topic').onchange = load;
load();
</script>
</body>
</html>`;
