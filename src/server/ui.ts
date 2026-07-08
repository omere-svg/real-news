import type { TickRecord } from '../db/tick-report-repo.js';
import type { TickReflection } from '../db/tick-reflection-repo.js';
import { ago, emptyStateHtml, escHtml, fmtDuration, topicChips } from './ui-view.js';

/** Defaults the viewer seeds its controls from (ADR-0015). */
export interface UiDefaults {
  readonly minutes: number;
  /** Pre-checked topics; empty/omitted means none checked ("All"). */
  readonly topics?: readonly string[];
  /** Show the Podcast format tab (web podcast is off by default — ADR-0023). */
  readonly podcastEnabled?: boolean;
  /** When true, expose the "Log in with Telegram" flow (ADR-0040); else guest-only. */
  readonly authEnabled?: boolean;
  /** Bot username (no `@`) for a one-tap `t.me` deep link; absent ⇒ show the code only. */
  readonly botUsername?: string;
}

/**
 * The single-page read-only viewer (ADR-0011/0014). Plain HTML + fetch, no build
 * step. Controls are seeded from the configured presentation defaults (ADR-0015);
 * per-visitor choices (name, topics, minutes, format, theme) persist client-side
 * in localStorage — a lightweight "profile" with no server/DB dependency.
 */
export function renderUI(defaults: UiDefaults): string {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Project Horizon — everything that matters, one place, no agenda</title>
<style>
  :root {
    --bg:#0b0d12; --bg2:#0f1218; --card:#14171f; --card2:#181c25;
    --line:#232833; --line2:#2c3340; --muted:#8b93a7; --fg:#e9edf6; --fg-dim:#c3cad9;
    --accent:#e0a458; --accent2:#f0c07a; --accent-soft:rgba(224,164,88,.14);
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.28);
    --radius:16px;
  }
  html[data-theme="light"] {
    --bg:#f6f7fb; --bg2:#eef1f7; --card:#ffffff; --card2:#f7f9fc;
    --line:#e4e8f0; --line2:#d6dce7; --muted:#697086; --fg:#1a1f2b; --fg-dim:#3b4252;
    --accent:#c6862f; --accent2:#a96f22; --accent-soft:rgba(198,134,47,.12);
    --shadow:0 1px 2px rgba(16,24,40,.06), 0 10px 30px rgba(16,24,40,.08);
  }
  * { box-sizing:border-box; }
  html, body { margin:0; }
  body {
    background:
      radial-gradient(1100px 520px at 78% -8%, var(--accent-soft), transparent 60%),
      linear-gradient(180deg, var(--bg2), var(--bg) 340px);
    background-attachment:fixed;
    color:var(--fg);
    font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .wrap { max-width:900px; margin:0 auto; padding:0 20px; }

  /* Top bar */
  .topbar { position:sticky; top:0; z-index:20; backdrop-filter:blur(10px);
    background:color-mix(in srgb, var(--bg) 72%, transparent);
    border-bottom:1px solid var(--line); }
  .topbar-in { display:flex; align-items:center; justify-content:space-between; height:60px; }
  .brand { display:flex; align-items:center; gap:10px; font-weight:700; letter-spacing:.2px; font-size:16px; }
  .brand .logo { font-size:20px; filter:saturate(1.1); }
  .brand .tag { color:var(--muted); font-weight:500; font-size:12px; }
  .top-actions { display:flex; align-items:center; gap:8px; }
  .icon-btn, .ghost-btn {
    display:inline-flex; align-items:center; gap:7px; cursor:pointer;
    background:var(--card); color:var(--fg); border:1px solid var(--line);
    border-radius:999px; padding:7px 13px; font-size:13.5px; font-weight:600;
    transition:border-color .15s, background .15s, transform .05s;
  }
  .icon-btn { padding:8px 10px; }
  .icon-btn:hover, .ghost-btn:hover { border-color:var(--line2); background:var(--card2); }
  .icon-btn:active, .ghost-btn:active { transform:translateY(1px); }
  .ghost-btn .who { max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  /* "Try the bot" CTA — an outbound t.me link, deliberately distinct from the
     Connect-Telegram login button next to it. */
  a.ghost-btn { text-decoration:none; }
  .bot-cta { border-color:color-mix(in srgb, var(--accent) 45%, var(--line)); }
  .bot-cta:hover { border-color:var(--accent); }
  @media (max-width:680px){ .bot-cta .bot-label { display:none; } }

  /* Hero */
  .hero { padding:40px 0 8px; }
  .hero h1 { margin:0; font-size:clamp(26px,4.4vw,40px); line-height:1.12; letter-spacing:-.4px; font-weight:800; }
  .hero h1 .grad { background:linear-gradient(92deg, var(--accent2), var(--accent)); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .hero p { color:var(--fg-dim); font-size:clamp(15px,1.8vw,17px); margin:14px 0 0; max-width:620px; }
  .hero .greet { color:var(--accent); font-weight:700; }

  /* How-it-works strip */
  .how { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:22px 0 4px; }
  .how .step { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:13px 15px; }
  .how .step h3 { margin:0; font-size:13.5px; display:flex; align-items:center; gap:8px; }
  .how .step h3 .n { display:inline-grid; place-items:center; width:22px; height:22px; border-radius:7px;
    background:var(--accent-soft); color:var(--accent); font-size:12px; font-weight:800; }
  .how .step p { margin:7px 0 0; color:var(--muted); font-size:12.5px; line-height:1.5; }
  .how .under { grid-column:1/-1; color:var(--muted); font-size:12.5px; text-align:center; padding:6px 0 0; }
  .how .under b { color:var(--fg-dim); font-weight:700; }
  @media (max-width:640px){ .how { grid-template-columns:1fr; } }

  /* Controls */
  .controls { position:sticky; top:60px; z-index:15;
    background:color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter:blur(8px);
    padding:16px 0 12px; margin-top:24px; }
  .seg { display:inline-flex; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:4px; gap:2px; flex-wrap:wrap; }
  .seg button { border:0; background:transparent; color:var(--muted); cursor:pointer;
    font:600 13.5px/1 inherit; padding:8px 14px; border-radius:9px; transition:color .15s, background .15s; }
  .seg button:hover { color:var(--fg); }
  .seg button[aria-pressed="true"] { background:var(--accent); color:#1a1205; }
  html[data-theme="light"] .seg button[aria-pressed="true"] { color:#fff; }
  .hint { color:var(--muted); font-size:13px; margin:10px 2px 0; min-height:18px; }
  .subctl { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:12px; }
  .topics { display:flex; gap:7px; flex-wrap:wrap; align-items:center; }
  .chip { position:relative; display:inline-flex; align-items:center; gap:7px; cursor:pointer;
    font-size:13px; font-weight:600; color:var(--muted); background:var(--card);
    border:1px solid var(--line); border-radius:999px; padding:6px 12px; user-select:none;
    transition:border-color .15s, color .15s, background .15s; }
  .chip:hover { border-color:var(--line2); color:var(--fg); }
  .chip input { position:absolute; opacity:0; pointer-events:none; }
  .chip .dot { width:8px; height:8px; border-radius:50%; background:var(--td,#8b93a7); opacity:.6; transition:opacity .15s; }
  .chip:has(input:checked) { color:var(--fg); border-color:color-mix(in srgb, var(--td) 55%, var(--line));
    background:color-mix(in srgb, var(--td) 14%, var(--card)); }
  .chip:has(input:checked) .dot { opacity:1; }
  .budget { display:inline-flex; align-items:center; gap:10px; color:var(--muted); font-size:13px;
    background:var(--card); border:1px solid var(--line); border-radius:999px; padding:6px 14px; margin-left:auto; }
  .budget input[type=range]{ accent-color:var(--accent); width:130px; }
  .budget b { color:var(--fg); font-variant-numeric:tabular-nums; }

  /* Content */
  main { padding:6px 0 80px; }
  .count { color:var(--muted); font-size:12.5px; margin:6px 2px 12px; text-transform:uppercase; letter-spacing:.5px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:var(--radius);
    padding:18px; margin:12px 0; box-shadow:var(--shadow); transition:border-color .15s, transform .12s; }
  .story:hover { border-color:var(--line2); transform:translateY(-1px); }
  .row { display:flex; justify-content:space-between; gap:14px; align-items:flex-start; }
  .title { font-size:17.5px; font-weight:700; margin:0; line-height:1.35; letter-spacing:-.15px; }
  .title a { color:var(--fg); text-decoration:none; }
  .title a:hover { color:var(--accent); }
  .scorepill { display:inline-flex; align-items:baseline; gap:2px; white-space:nowrap;
    background:var(--accent-soft); color:var(--accent); font-weight:800; font-variant-numeric:tabular-nums;
    border-radius:10px; padding:4px 9px; font-size:15px; }
  .scorepill .max { font-size:11px; opacity:.7; font-weight:600; }
  .badges { margin:11px 0 0; display:flex; gap:7px; flex-wrap:wrap; align-items:center; }
  .badge { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:var(--fg-dim);
    border:1px solid var(--line); border-radius:999px; padding:3px 10px; }
  .badge .dot { width:7px; height:7px; border-radius:50%; background:var(--td,#8b93a7); }
  .stag { font-size:11.5px; font-weight:600; color:var(--accent); background:var(--accent-soft);
    border-radius:999px; padding:3px 9px; }
  .why { color:var(--fg-dim); margin:12px 0 0; }
  .why-score { margin-top:12px; font-size:13px; color:var(--muted); }
  .why-score summary { cursor:pointer; color:var(--accent); list-style:none; font-weight:600; width:max-content; }
  .why-score summary::-webkit-details-marker { display:none; }
  .why-score summary::before { content:'▸ '; }
  .why-score[open] summary::before { content:'▾ '; }
  /* "Why this score?" breakdown bars (ADR-0064): the exact scoring math per card. */
  .why-score .drv { display:flex; align-items:center; gap:9px; margin:7px 0; }
  .why-score .drv .lbl { flex:0 0 118px; color:var(--fg-dim); font-size:12.5px; }
  .why-score .drv .track { flex:1; height:7px; background:var(--card2); border:1px solid var(--line); border-radius:999px; overflow:hidden; }
  .why-score .drv .fill { display:block; height:100%; background:linear-gradient(90deg,var(--accent2),var(--accent)); }
  .why-score .drv .val { flex:0 0 38px; text-align:right; color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
  .why-score .sc-meta { margin-top:9px; color:var(--muted); font-size:12px; }
  .empty { color:var(--muted); text-align:center; padding:56px 20px; }
  .empty .big { font-size:16px; color:var(--fg-dim); }
  .skel { height:118px; border-radius:var(--radius); border:1px solid var(--line);
    background:linear-gradient(100deg,var(--card) 30%,var(--card2) 50%,var(--card) 70%);
    background-size:220% 100%; animation:sh 1.3s ease-in-out infinite; margin:12px 0; }
  @keyframes sh { from{background-position:180% 0} to{background-position:-40% 0} }
  pre.doc { white-space:pre-wrap; word-wrap:break-word; font:15.5px/1.7 ui-sans-serif,system-ui,sans-serif; margin:0; color:var(--fg-dim); }
  .script-hd { font-weight:700; font-size:13px; color:var(--accent); margin-bottom:8px; }
  .script-p { margin:0 0 13px; color:var(--fg-dim); font-size:16px; line-height:1.7; }
  .script-p:last-child { margin-bottom:0; }
  .why b { color:var(--fg); font-weight:700; }
  /* Per-story source link (ADR-0027 provenance) — a compact pill, not a raw URL. */
  .src-link { display:inline-flex; align-items:center; gap:6px; margin-top:13px; font-size:12.5px; font-weight:700;
    color:var(--accent); text-decoration:none; border:1px solid color-mix(in srgb, var(--accent) 38%, var(--line));
    border-radius:999px; padding:5px 12px; transition:border-color .15s, background .15s, transform .05s; }
  .src-link:hover { border-color:var(--accent); background:var(--accent-soft); }
  .src-link:active { transform:translateY(1px); }
  .src-link .arr { font-size:11px; opacity:.85; }

  /* Profile popover + modal */
  .pop { position:fixed; inset:0; z-index:50; display:none; align-items:flex-start; justify-content:center; }
  .pop.open { display:flex; }
  .pop .scrim { position:absolute; inset:0; background:rgba(3,5,10,.55); backdrop-filter:blur(2px); }
  .sheet { position:relative; margin-top:14vh; width:min(420px,92vw); background:var(--card); border:1px solid var(--line);
    border-radius:18px; box-shadow:var(--shadow); padding:22px; }
  .sheet h2 { margin:0 0 4px; font-size:19px; }
  .sheet p { margin:0 0 16px; color:var(--muted); font-size:13.5px; }
  .field label { display:block; font-size:12.5px; color:var(--muted); margin-bottom:6px; font-weight:600; }
  .field input[type=text] { width:100%; background:var(--card2); border:1px solid var(--line2); color:var(--fg);
    border-radius:11px; padding:11px 13px; font-size:15px; }
  .field input[type=text]:focus { outline:none; border-color:var(--accent); }
  .sheet-actions { display:flex; gap:10px; margin-top:18px; }
  .btn-primary { flex:1; border:0; cursor:pointer; background:linear-gradient(92deg,var(--accent2),var(--accent));
    color:#1a1205; font-weight:800; font-size:14.5px; border-radius:11px; padding:12px; }
  html[data-theme="light"] .btn-primary { color:#fff; }
  .btn-text { border:0; background:transparent; color:var(--muted); cursor:pointer; font-size:13.5px; font-weight:600; padding:12px; }
  .btn-text:hover { color:var(--fg); }
  .note { color:var(--muted); font-size:11.5px; margin-top:14px; line-height:1.5; }
  .note.err { color:var(--bad,#e06c75); }
  a.btn-primary { text-decoration:none; text-align:center; display:block; }
  .btn-primary[disabled] { opacity:.6; cursor:progress; }
  .hidden { display:none !important; }
  /* Close (✕) button on the login/connected sheet */
  .sheet-close { position:absolute; top:12px; right:12px; width:30px; height:30px; display:grid;
    place-items:center; border:0; border-radius:9px; background:transparent; color:var(--muted);
    font-size:16px; line-height:1; cursor:pointer; transition:background .15s, color .15s; }
  .sheet-close:hover { background:var(--card2); color:var(--fg); }
  /* Generate button — explicit, so choosing a format/topic never auto-spends the model */
  .gen-btn { display:inline-flex; align-items:center; gap:7px; cursor:pointer; border:0;
    background:linear-gradient(92deg,var(--accent2),var(--accent)); color:#1a1205; font-weight:800;
    font-size:13.5px; border-radius:999px; padding:8px 16px; transition:transform .05s, opacity .15s; }
  html[data-theme="light"] .gen-btn { color:#fff; }
  .gen-btn:active { transform:translateY(1px); }
  .gen-btn[disabled] { opacity:.6; cursor:progress; }
  /* Web podcast audio player */
  .pod-audio { width:100%; margin:6px 0 14px; }
  /* Connect-Telegram states */
  .ok-badge { font-size:40px; text-align:center; line-height:1; margin-bottom:6px; }
  .code { font:800 24px/1 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:5px;
    text-align:center; background:var(--card2); border:1px dashed var(--line2); border-radius:12px;
    padding:15px; color:var(--fg); user-select:all; margin:6px 0; }
  .waiting { display:flex; align-items:center; gap:9px; color:var(--muted); font-size:12.5px; margin-top:14px; }
  .spinner { width:15px; height:15px; border:2px solid var(--line2); border-top-color:var(--accent);
    border-radius:50%; animation:spin .8s linear infinite; flex:none; }
  @keyframes spin { to { transform:rotate(360deg); } }
  /* Compact hero for a returning / linked reader */
  .hero.compact { padding:26px 0 4px; }
  .hero.compact h1 { font-size:clamp(21px,3vw,28px); }
  .hero.compact p { display:none; }
  /* Visible keyboard focus (accessibility) */
  :focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:8px; }
</style>
</head>
<body>
<div class="topbar">
  <div class="wrap topbar-in">
    <div class="brand"><span class="logo">🌅</span> Project Horizon <span class="tag">executive editor</span></div>
    <div class="top-actions">
      ${defaults.botUsername ? `<a class="ghost-btn bot-cta" href="https://t.me/${defaults.botUsername}" target="_blank" rel="noopener" title="Chat with Horizon on Telegram">💬 <span class="bot-label">Chat with Horizon on Telegram</span></a>` : ''}
      <button class="icon-btn" id="themeBtn" title="Toggle light / dark" aria-label="Toggle theme">🌙</button>
      ${defaults.authEnabled ? '<button class="ghost-btn" id="profileBtn">✈️ <span class="who" id="whoLabel">Connect Telegram</span></button>' : ''}
    </div>
  </div>
</div>

<div class="wrap">
  <section class="hero">
    <h1 id="heroTitle">Everything that matters. <span class="grad">One place, no agenda.</span></h1>
    <p id="heroSub">The AI, geopolitics, sports, Israeli politics — and everything else you follow — in one place, so you're not hopping between apps and outlets. Horizon pulls from 20+ official sources every few minutes and ranks each story by real-world importance, not by any single outlet's agenda. Reading across all of them together means you don't miss what one source buried or never covered. No feed to scroll. No noise. Just what matters, sized to the time you have.</p>
  </section>

  <section class="how" id="how">
    <div class="step"><h3><span class="n">1</span> Scored 0–10</h3><p>Every story gets an impact-first significance score — real-world consequence, corroboration, and source newsworthiness. Open <em>Why this score?</em> for the exact math.</p></div>
    <div class="step"><h3><span class="n">2</span> Cross-checked</h3><p>The same event from many sources becomes one story, corroborated across all of them — so no single outlet decides what you see, and nothing important slips through.</p></div>
    <div class="step"><h3><span class="n">3</span> Explained</h3><p>Each story says <em>why it matters</em> in one line, sized to the minutes you have.</p></div>
    <div class="under" id="under">From <b>20+ official news &amp; data APIs</b> · <b>zero scraping</b> · re-read every few minutes<span id="freshness"></span></div>
  </section>

  <section class="controls">
    <div class="seg" id="format" role="tablist" aria-label="Format">
      <button data-fmt="brief" aria-pressed="true">Brief</button>
      ${defaults.podcastEnabled ? '<button data-fmt="podcast" aria-pressed="false">Podcast</button>' : ''}
    </div>
    <div class="hint" id="hint"></div>
    <div class="subctl">
      <div class="topics" id="topics">${topicChips(defaults.topics ?? [])}</div>
      <label class="budget" id="budgetCtl">⏱ Time <input id="minutes" type="range" min="1" max="30" value="${defaults.minutes}" /> <b id="minutesLabel">${defaults.minutes} min</b></label>
      ${defaults.podcastEnabled ? '<button class="gen-btn hidden" id="genBtn" type="button">✨ Generate</button>' : ''}
    </div>
  </section>

  <main id="list"></main>
</div>

<!-- Log in with Telegram (ADR-0040) -->
<div class="pop" id="pop">
  <div class="scrim" data-close></div>
  <div class="sheet">
    <button class="sheet-close" id="popClose" type="button" aria-label="Close">✕</button>
    <div id="stateStart">
      <h2>Log in with Telegram</h2>
      <p>Connect your Telegram account so your topics and reading time follow you across the web app and the bot. It's free — no password, no phone number, nothing to install.</p>
      <div class="sheet-actions">
        <button class="btn-primary" id="startPair">Generate my link</button>
      </div>
      <div class="note">We never see your phone number. Connecting simply proves it's you via your Telegram account.</div>
    </div>

    <div id="statePending" class="hidden">
      <h2>Confirm in Telegram</h2>
      <p id="pendingSub">Tap the button to open the bot, then press <b>Start</b> to connect.</p>
      <a class="btn-primary" id="deepLink" target="_blank" rel="noopener">Open Telegram</a>
      <p class="note">No button, or on another device? Message the bot:<br>send <b id="codeCmd">/link CODE</b></p>
      <div class="code" id="codeBox">------</div>
      <div class="waiting"><span class="spinner"></span> Waiting for you to confirm…</div>
      <div class="sheet-actions"><button class="btn-text" id="cancelPair">Cancel</button></div>
    </div>

    <div id="stateLinked" class="hidden">
      <div class="ok-badge">✅</div>
      <h2 id="linkedTitle">Connected</h2>
      <p>Your preferences now sync between this web app and Telegram. Change your topics and reading time in either place — they stay in step.</p>
      <div class="sheet-actions"><button class="btn-text" id="signOut">Disconnect</button></div>
    </div>

    <div id="pairErr" class="note err hidden"></div>
  </div>
</div>

<script>
const CFG = { authEnabled: ${defaults.authEnabled ? 'true' : 'false'}, podcastEnabled: ${defaults.podcastEnabled ? 'true' : 'false'} };
const list = document.getElementById('list');
const seg = document.getElementById('format');
const topicsBox = document.getElementById('topics');
const minutesInput = document.getElementById('minutes');
const minutesLabel = document.getElementById('minutesLabel');
const genBtn = document.getElementById('genBtn');
const hint = document.getElementById('hint');
const heroEl = document.querySelector('.hero');
const heroTitle = document.getElementById('heroTitle');
const howEl = document.getElementById('how');

// Restrained, consistent topic palette (one hue per topic aids scanning).
const TOPIC_COLORS = {
  AI:'#7aa2f7', Geopolitics:'#e0a458', Politics:'#bb9af7', Sports:'#5fd38d',
  Business:'#f7b955', Science:'#7dcfff', Health:'#ff85c0', Climate:'#73daca',
  Israel:'#82aaff', Other:'#9aa3b6'
};
document.querySelectorAll('.chip').forEach(c => c.style.setProperty('--td', TOPIC_COLORS[c.dataset.topic] || '#8b93a7'));

const HINTS = {
  brief: 'A tight, bulleted summary sized to the minutes you pick — updates as you choose.',
  podcast: 'A short narrated audio episode of your top stories — press ✨ Generate to produce it.'
};
const DOC_FIELD = { brief: 'brief' };
let format = 'brief';
// The Brief is a DETERMINISTIC cache read — no model call — so it loads on first
// paint and on any topic/time change, giving the reader something immediately
// (ADR-0064). The Podcast DOES cost a model call (+ TTS), so it stays behind an
// explicit ✨ Generate press — the model is never spent until asked (ADR-0058).
function promptGenerate(){
  hint.textContent = HINTS[format] || '';
  list.innerHTML = emptyStateHtml('Ready when you are', 'Choose your topics and time, then press ✨ Generate.');
}
// Brief auto-loads (free); Podcast re-arms the explicit Generate prompt.
function render(){ if (format === 'brief') { void load(); } else { promptGenerate(); } }

// Single source of truth with the server (ui-view.ts, unit-tested there) —
// injected verbatim so the browser runs the exact same escaping code.
// NOTE splice order matters: emptyStateHtml below calls escHtml as a free
// variable (it's spliced as standalone function source, not a closure), so
// escHtml MUST be defined first in the shipped script.
const escHtml = ${escHtml.toString()};
function esc(s){ return escHtml(s); }
// emptyStateHtml is injected verbatim from ui-view.ts (unit-tested there) — one
// implementation, shipped unchanged to the browser (same pattern as escHtml above).
// Depends on escHtml already being defined above (see NOTE).
const emptyStateHtml = ${emptyStateHtml.toString()};
// Only allow http(s) links; a feed-controlled url must never reach an href raw
// (a " breaks out of the attribute; a javascript: scheme runs on click). Returns
// a safe absolute url or null (drop the link, keep the title).
function safeUrl(u){ try { const p = new URL(u, location.origin); return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : null; } catch { return null; } }
function selectedTopics(){ return [...topicsBox.querySelectorAll('input[name="topic"]:checked')].map(c => c.value); }
function setTopics(list){ const set = new Set(list || []); topicsBox.querySelectorAll('input[name="topic"]').forEach(i => { i.checked = set.has(i.value); }); }
// The Brief auto-loads for free, so the explicit ✨ Generate button is only
// meaningful for the Podcast (the one format that spends the model + TTS). Show
// it only while Podcast is the selected format; hide it otherwise.
function setFormat(f){ if(f && seg.querySelector('button[data-fmt="'+f+'"]')) format = f; seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fmt === format))); if (genBtn) genBtn.classList.toggle('hidden', format !== 'podcast'); }

// ---- Preferences persistence ----
// Guests: everything is cached in this browser (localStorage). Once linked to
// Telegram, topics + minutes are the shared server-side prefs (ADR-0040); theme
// and format stay a local UI convenience either way.
const LS = 'horizon.prefs.v2';
function readLS(){ try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } }
function cacheLocal(){
  localStorage.setItem(LS, JSON.stringify({
    topics: selectedTopics(), minutes: Number(minutesInput.value),
    format, theme: document.documentElement.dataset.theme,
  }));
}
let authed = false;
let pushTimer = null;
function pushServerSoon(){
  if (!authed) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    fetch('/api/preferences', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topics: selectedTopics(), minutes: Number(minutesInput.value) }),
    }).catch(() => {});
  }, 400);
}
function onPrefChanged(){ cacheLocal(); pushServerSoon(); render(); }

// ---- Theme (always a local preference) ----
function syncThemeIcon(){ document.getElementById('themeBtn').textContent = document.documentElement.dataset.theme === 'light' ? '☀️' : '🌙'; }
document.getElementById('themeBtn').onclick = () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  syncThemeIcon(); cacheLocal();
};

// ---- "Log in with Telegram" (ADR-0040) ----
const pop = document.getElementById('pop');
const profileBtn = document.getElementById('profileBtn');
function setWho(text){ const w = document.getElementById('whoLabel'); if (w) w.textContent = text; }
function compactHero(name){ heroEl.classList.add('compact'); howEl.classList.add('hidden'); if (name) heroTitle.innerHTML = 'Welcome back, <span class="grad">' + esc(name) + '.</span>'; }
function expandHero(){ heroEl.classList.remove('compact'); howEl.classList.remove('hidden'); heroTitle.innerHTML = 'Everything that matters. <span class="grad">One place, no agenda.</span>'; }

function showState(which){
  for (const id of ['stateStart','statePending','stateLinked']) document.getElementById(id).classList.toggle('hidden', id !== which);
  document.getElementById('pairErr').classList.add('hidden');
}
function showPairError(msg){ const e = document.getElementById('pairErr'); e.textContent = msg; e.classList.remove('hidden'); }
function openPop(){ pop.classList.add('open'); showState(authed ? 'stateLinked' : 'stateStart'); }
function closePop(){ pop.classList.remove('open'); stopPolling(); }

let pollTimer = null, pollDeadline = 0;
function stopPolling(){ clearTimeout(pollTimer); pollTimer = null; }
async function poll(){
  if (Date.now() > pollDeadline){ showState('stateStart'); showPairError('That code expired. Generate a new one.'); return; }
  try {
    const r = await fetch('/api/auth/status');
    const j = await r.json();
    if (j.authenticated) return onLinked(j.name);
  } catch (e) { /* transient — keep polling */ }
  pollTimer = setTimeout(poll, 2500);
}

async function startPair(){
  const btn = document.getElementById('startPair');
  btn.disabled = true;
  try {
    const res = await fetch('/api/auth/start', { method: 'POST' });
    const j = await res.json();
    document.getElementById('codeBox').textContent = j.code;
    document.getElementById('codeCmd').textContent = '/link ' + j.code;
    const dl = document.getElementById('deepLink');
    const sub = document.getElementById('pendingSub');
    if (j.deepLink) { dl.href = j.deepLink; dl.classList.remove('hidden'); sub.innerHTML = 'Tap the button to open the bot, then press <b>Start</b> to connect.'; }
    else { dl.classList.add('hidden'); sub.innerHTML = 'Open your Telegram bot and send it the code below.'; }
    showState('statePending');
    pollDeadline = Date.now() + (j.expiresInSec * 1000);
    poll();
  } catch (e) {
    showState('stateStart'); showPairError('Could not start — please try again.');
  } finally { btn.disabled = false; }
}

async function onLinked(name){
  stopPolling();
  authed = true;
  setWho(name || 'Telegram');
  compactHero(name);
  document.getElementById('linkedTitle').textContent = name ? ('Connected, ' + name) : 'Connected';
  showState('stateLinked');
  await loadServerPrefs();
  render();
}

async function loadServerPrefs(){
  try {
    const r = await fetch('/api/preferences');
    if (!r.ok) return;
    const p = await r.json();
    setTopics(p.topics);
    if (p.minutes) { minutesInput.value = p.minutes; minutesLabel.textContent = p.minutes + ' min'; }
    cacheLocal();
  } catch (e) { /* stay with cached prefs */ }
}

async function refreshAuth(){
  try {
    const r = await fetch('/api/auth/status');
    const j = await r.json();
    if (j.authenticated){ authed = true; setWho(j.name || 'Telegram'); compactHero(j.name); await loadServerPrefs(); }
  } catch (e) { /* offline — run as guest */ }
}

async function signOut(){
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
  authed = false; setWho('Connect Telegram'); expandHero(); closePop();
}

if (CFG.authEnabled) {
  if (profileBtn) profileBtn.onclick = openPop;
  pop.querySelector('[data-close]').onclick = closePop;
  document.getElementById('popClose').onclick = closePop;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });
  document.getElementById('startPair').onclick = startPair;
  document.getElementById('cancelPair').onclick = () => { stopPolling(); showState('stateStart'); };
  document.getElementById('signOut').onclick = signOut;
}

function skeletons(n){ let h=''; for(let i=0;i<n;i++) h+='<div class="skel"></div>'; return h; }

// ---- Brief as cards, not a monospace blob ----
// The server render is deterministic (📰 title / summary / 💡 why / 🏷 topic·sig·tags
// / 🔗 url per story, blank-line separated), so we parse it back into scannable cards.
function renderDoc(format, text){
  const parts = text.split('\\n\\n');
  const header = (parts.shift() || '').trim();
  const cards = parts.map(block => {
    let title='', summary='', why='', descriptor='', url='';
    for (const ln of block.split('\\n')) {
      if (ln.startsWith('📰')) title = ln.slice(2).trim();
      else if (ln.startsWith('💡')) why = ln.slice(2).trim();
      else if (ln.startsWith('🏷')) descriptor = ln.slice(2).trim();
      else if (ln.startsWith('🔗')) url = ln.slice(2).trim();
      else if (ln.trim()) summary += (summary ? ' ' : '') + ln.trim();
    }
    if (!title) return '';
    const su = safeUrl(url);
    const titleHtml = su ? '<a href="'+esc(su)+'" target="_blank" rel="noopener">'+esc(title)+'</a>' : esc(title);
    const bits = descriptor.split('·').map(s => s.trim()).filter(Boolean);
    const topic = bits[0] || '';
    const sigBit = bits.find(b => /significance/i.test(b));
    const sig = sigBit ? sigBit.replace(/significance/i,'').trim() : '';
    const color = TOPIC_COLORS[topic] || '#8b93a7';
    const tags = bits.filter(b => b !== topic && b !== sigBit && b.toLowerCase() !== 'high public interest').map(t => '<span class="stag">'+esc(t)+'</span>').join('');
    const pill = sig ? '<span class="scorepill">'+esc(sig)+'<span class="max">/10</span></span>' : '';
    return '<div class="card story"><div class="row"><p class="title">'+titleHtml+'</p>'+pill+'</div>'+
      '<div class="badges"><span class="badge" style="--td:'+color+'"><span class="dot"></span>'+esc(topic)+'</span>'+tags+'</div>'+
      (summary ? '<p class="why">'+esc(summary)+'</p>' : '')+
      (why ? '<p class="why"><b>Why it matters — </b>'+esc(why)+'</p>' : '')+
      srcLink(su)+'</div>';
  }).join('');
  if (!cards.trim()) return emptyStateHtml(header || text, '');
  return '<div class="count">'+esc(header)+'</div>'+cards;
}

// ---- Structured brief cards with the "Why this score?" breakdown (ADR-0064) ----
// Preferred path: the server now returns brief stories as structured JSON, so we
// render the exact scoring math (per-axis bars + recency/corroboration/nudge) in
// an expandable panel — the transparency the how-strip promises. renderDoc above
// stays as the text fallback if a response ever lacks the structured stories.
// A compact "Read the full article ↗" pill linking to the story's canonical
// source (ADR-0027). Takes an already-safe url (or null → renders nothing), so
// a feed-controlled link can never reach the href unchecked.
function srcLink(su){ return su ? '<a class="src-link" href="'+esc(su)+'" target="_blank" rel="noopener">Read the full article <span class="arr">↗</span></a>' : ''; }
function scoreBar(label, value){
  const pct = Math.max(0, Math.min(100, Math.round((Number(value)||0)*100)));
  return '<div class="drv"><span class="lbl">'+esc(label)+'</span>'+
    '<span class="track"><span class="fill" style="width:'+pct+'%"></span></span>'+
    '<span class="val">'+pct+'%</span></div>';
}
function whyScoreHtml(s){
  if (!Array.isArray(s.drivers) || !s.drivers.length) return '';
  const bars = s.drivers.map(d => scoreBar(d.label, d.value)).join('');
  const nudge = Number(s.signalNudge) || 0;
  const nudgeStr = (nudge > 0 ? '+' : '') + nudge.toFixed(2);
  const n = Number(s.corroboration) || 0;
  const meta = 'Recency ×' + (Number(s.recencyFactor)||0).toFixed(2) +
    ' · ' + n + ' source' + (n === 1 ? '' : 's') +
    ' · signal nudge ' + nudgeStr;
  return '<details class="why-score"><summary>Why this score?</summary>'+
    bars + '<div class="sc-meta">'+esc(meta)+'</div></details>';
}
function renderBriefStories(header, stories){
  const cards = stories.map(s => {
    if (!s || !s.title) return '';
    const su = safeUrl(s.url);
    const titleHtml = su ? '<a href="'+esc(su)+'" target="_blank" rel="noopener">'+esc(s.title)+'</a>' : esc(s.title);
    const color = TOPIC_COLORS[s.topic] || '#8b93a7';
    const tags = (s.tags||[]).map(t => '<span class="stag">'+esc(t)+'</span>').join('');
    const sig = (typeof s.significance === 'number') ? s.significance.toFixed(1) : '';
    const pill = sig ? '<span class="scorepill">'+esc(sig)+'<span class="max">/10</span></span>' : '';
    return '<div class="card story"><div class="row"><p class="title">'+titleHtml+'</p>'+pill+'</div>'+
      '<div class="badges"><span class="badge" style="--td:'+color+'"><span class="dot"></span>'+esc(s.topic||'')+'</span>'+tags+'</div>'+
      (s.summary ? '<p class="why">'+esc(s.summary)+'</p>' : '')+
      (s.whyItMatters ? '<p class="why"><b>Why it matters — </b>'+esc(s.whyItMatters)+'</p>' : '')+
      srcLink(su)+
      whyScoreHtml(s)+'</div>';
  }).join('');
  if (!cards.trim()) return emptyStateHtml(header || 'Nothing to show yet', '');
  return '<div class="count">'+esc(header)+'</div>'+cards;
}
// The web podcast is now real narrated audio (ADR-0020): an <audio> player, with
// the script kept one tap away as a transcript. If TTS was unavailable the server
// returns no audio and we fall back to showing the script to read.
function renderPodcast(script, audioB64){
  const player = audioB64
    ? '<audio class="pod-audio" controls autoplay src="data:audio/mpeg;base64,'+audioB64+'"></audio>'
    : '<p class="why">Audio couldn’t be generated just now — here’s the script to read.</p>';
  const paras = (script || '').split(/\\n{2,}/).map(p => p.trim()).filter(Boolean);
  const body = (paras.length ? paras : [script]).map(p => '<p class="script-p">'+esc(p)+'</p>').join('');
  return '<div class="card"><div class="script-hd">🎧 Podcast</div>'+player+
    '<details class="why-score"><summary>Show transcript</summary><div class="script">'+body+'</div></details></div>';
}

async function load() {
  const topics = selectedTopics();
  hint.textContent = HINTS[format] || '';
  minutesLabel.textContent = minutesInput.value + ' min';
  list.innerHTML = skeletons(1);
  try {
    const params = new URLSearchParams({ minutes: minutesInput.value });
    for (const t of topics) params.append('topic', t);
    const res = await fetch('/api/' + format + '?' + params);
    if (format === 'podcast' && res.status === 404) {
      list.innerHTML = emptyStateHtml('Podcast is not enabled here', 'The narrated podcast runs on the Telegram bot. Try the Brief on the web.');
      return;
    }
    const body = await res.json();
    if (format === 'podcast') {
      const script = body.script || '';
      if (!script.trim() && !body.audio) { list.innerHTML = emptyStateHtml('Nothing to narrate yet', 'The worker fills the cache on each tick — check back shortly.'); return; }
      list.innerHTML = renderPodcast(script, body.audio);
      return;
    }
    const text = body[DOC_FIELD[format]] || '';
    // Preferred: render the structured stories with the inspectable score
    // breakdown (ADR-0064). Fall back to parsing the text brief if a response
    // ever omits them (older server, or an empty selection).
    if (Array.isArray(body.stories) && body.stories.length) {
      const header = (text.split('\\n\\n')[0] || '').trim() || (body.stories.length + ' stories');
      list.innerHTML = renderBriefStories(header, body.stories);
      return;
    }
    if (!text.trim()) { list.innerHTML = emptyStateHtml('Nothing to show yet', 'The worker fills the cache on each tick — check back shortly.'); return; }
    list.innerHTML = renderDoc(format, text);
  } catch (e) {
    list.innerHTML = emptyStateHtml("Couldn't load that", 'Check your connection and try again.');
  }
}

seg.addEventListener('click', e => {
  const btn = e.target.closest('button[data-fmt]'); if (!btn) return;
  setFormat(btn.dataset.fmt);
  cacheLocal(); // format is a local UI preference, not a synced one
  render();
});
// The only place a doc format actually generates — an explicit, deliberate
// spend. Present only for the Podcast (the Brief auto-loads for free).
if (genBtn) genBtn.onclick = async () => {
  genBtn.disabled = true;
  try { await load(); } finally { genBtn.disabled = false; }
};
topicsBox.addEventListener('change', onPrefChanged);
minutesInput.oninput = () => { minutesLabel.textContent = minutesInput.value + ' min'; };
minutesInput.onchange = onPrefChanged;

// ---- Latest tick: the "updated Nm ago" freshness stat in the how-strip. ----
let lastTickAtCache = null; // ms epoch of the most recent tick, fetched once
async function getLastTickAt(){
  if (lastTickAtCache !== null) return lastTickAtCache;
  try {
    const t = (await (await fetch('/api/ticks?limit=1')).json()).ticks?.[0];
    lastTickAtCache = t ? t.ranAt : 0;
  } catch (e) { lastTickAtCache = 0; }
  return lastTickAtCache;
}
function agoStr(ms){
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 90 ? s+'s' : s < 5400 ? Math.round(s/60)+'m' : Math.round(s/3600)+'h';
}
async function loadFreshness(){
  const at = await getLastTickAt();
  if (!at) return;
  const el = document.getElementById('freshness');
  if (el) el.textContent = ' · updated ' + agoStr(at) + ' ago';
}

// ---- Init: seed controls from cache, then let the server (if linked) win. ----
(async function init(){
  const cached = readLS();
  if (cached.theme) document.documentElement.dataset.theme = cached.theme;
  syncThemeIcon();
  // Saved prefs (guest or synced) win; a FIRST-TIME visitor gets no topic filter
  // ("All" — no chips checked), so the globally top-scored story is never hidden
  // behind the server's preferred-topics default.
  if (Array.isArray(cached.topics)) setTopics(cached.topics);
  else setTopics([]);
  if (cached.minutes) { minutesInput.value = cached.minutes; }
  setFormat(cached.format || 'brief');
  minutesLabel.textContent = minutesInput.value + ' min';
  if (CFG.authEnabled) await refreshAuth(); // may override topics/minutes from the linked account
  loadFreshness();
  render();
})();
</script>
</body>
</html>`;
}

// --- Observability dashboard (ADR-0033) ---

/**
 * Expected worker cadence (~one tick). A last tick older than ~2× this means the
 * worker is presumably stuck or dead — the only tick-timing state that is truly
 * red. Kept slightly above the configured interval so a long tick isn't a false
 * alarm.
 */
const EXPECTED_TICK_MS = 25 * 60_000;

/**
 * The server-rendered observability dashboard (ADR-0033): a health banner plus a
 * table of recent tick outcomes. Data is passed in (no client fetch); the page
 * self-refreshes. `nowMs` is injected for testable "age" rendering.
 */
export function renderDashboard(
  ticks: readonly TickRecord[],
  reflections: readonly TickReflection[] = [],
  nowMs = Date.now(),
): string {
  const last = ticks[0];
  const issues = (t: TickRecord): number =>
    t.failed.length + t.signalsFailed.length + t.skipped.length + t.signalsSkipped.length;
  // Health triage: red only when the last tick itself FAILED or the worker looks
  // stuck (no tick for ~2× the expected cadence). A successful tick with some
  // failed/skipped sources is amber — degraded inputs, not a down system.
  const overdue = last !== undefined && nowMs - last.ranAt > 2 * EXPECTED_TICK_MS;
  const nIssues = last ? issues(last) : 0;
  const level = !last ? 'warn' : !last.ok || overdue ? 'bad' : nIssues > 0 ? 'warn' : 'ok';
  const headline = !last
    ? ''
    : !last.ok
      ? 'Last tick FAILED'
      : overdue
        ? 'OVERDUE — worker may be stuck'
        : nIssues > 0
          ? `OK — ${nIssues} source${nIssues === 1 ? '' : 's'} degraded`
          : 'Healthy';
  const banner = !last
    ? 'No ticks recorded yet — the worker writes one on each cycle.'
    : `${headline} · last tick ${ago(last.ranAt, nowMs)} · ${last.storiesUpserted} stories · ${last.extracted} items`;

  const reflectionHtml = reflections.length
    ? `<section class="reflect">
    <h2>🧠 Reflection advisories <span class="muted">(ADR-0042 · last ${reflections.length})</span></h2>
    ${reflections
      .map(
        (r) =>
          `<article class="advisory"><div class="meta">${ago(r.createdAt, nowMs)} · over ${r.ticksCovered} ticks</div>` +
          `<pre>${escHtml(r.text)}</pre></article>`,
      )
      .join('')}
  </section>`
    : '';

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
        `<td class="num">${fmtDuration(t.durationMs)}</td>` +
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
  .banner.ok { color:var(--ok); } .banner.warn { color:var(--accent); } .banner.bad { color:var(--bad); }
  .stats { max-width:1000px; margin:0 auto 4px; padding:0 20px; display:grid;
           grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; }
  .stat { background:var(--card); border:1px solid #2a2f3a; border-radius:10px; padding:10px 14px; }
  .stat b { display:block; font-size:20px; font-variant-numeric:tabular-nums; }
  .stat span { color:var(--muted); font-size:12px; }
  .stats-note { grid-column:1/-1; color:var(--muted); font-size:12px; padding:0 2px; }
  main { max-width:1000px; margin:0 auto; padding:8px 20px 60px; }
  table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
  th, td { text-align:left; padding:7px 10px; border-bottom:1px solid #232833; }
  th { color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.4px; }
  td.num { text-align:right; } td.c { text-align:center; } td.muted { color:var(--muted); font-size:13px; }
  .empty { color:var(--muted); text-align:center; padding:40px 0; }
  a { color:var(--accent); }
  .reflect { margin:0 0 22px; }
  .reflect h2 { font-size:15px; margin:0 0 10px; }
  .reflect h2 .muted { color:var(--muted); font-weight:400; font-size:12px; }
  .advisory { background:var(--card); border:1px solid #2a2f3a; border-radius:10px; padding:12px 16px; margin:8px 0; }
  .advisory .meta { color:var(--muted); font-size:12px; margin-bottom:6px; }
  .advisory pre { margin:0; white-space:pre-wrap; font:14px/1.5 ui-sans-serif,system-ui,sans-serif; }
</style>
</head>
<body>
<header>
  <h1>🌅 Horizon — Operations</h1>
  <div class="sub">Tick observability (ADR-0033) · auto-refreshes every 60s · <a href="/">viewer</a> · <a href="/api/ticks">JSON</a></div>
</header>
<div class="banner ${level}">${escHtml(banner)}</div>
<section class="stats" id="stats" hidden>
  <div class="stat"><b id="stStories">–</b><span>stories accumulated</span></div>
  <div class="stat"><b id="stMulti">–</b><span>multi-source stories</span></div>
  <div class="stat"><b id="stSignals">–</b><span>signal observations</span></div>
  <div class="stat"><b id="stDays">–</b><span>days of signal history</span></div>
  <div class="stat"><b id="stTokens">–</b><span>LLM tokens today</span></div>
  <div class="stats-note" id="statsNote"></div>
</section>
<main>
  ${reflectionHtml}
  ${
    ticks.length === 0
      ? '<div class="empty">No ticks recorded yet.</div>'
      : `<table>
    <thead><tr><th>When</th><th>OK</th><th>Duration</th><th>Items</th><th>Stories</th><th>Signals</th><th>Skipped</th><th>Errors</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
  }
</main>
<script>
// Accumulation strip (/api/stats): evidence the Story cache and Signal history
// grow across ticks. Decorative — a fetch failure never breaks the ops page.
(async () => {
  try {
    const s = await (await fetch('/api/stats')).json();
    const set = (id, v) => { document.getElementById(id).textContent = String(v); };
    set('stStories', s.stories);
    set('stMulti', s.multiSourceStories);
    set('stSignals', s.signalObservations);
    set('stDays', s.oldestSignalAt ? Math.max(1, Math.ceil((Date.now() - s.oldestSignalAt) / 86400000)) : 0);
    set('stTokens', s.tokens ? s.tokens.total.toLocaleString() : 0);
    const tail = s.storiesUpdatedAcrossTicks + ' stories updated across ticks · ' + s.ticksRecorded + ' recent ticks recorded'
      + (s.tokens ? ' · tokens today: cheap ' + s.tokens.cheap.toLocaleString() + ' / deep ' + s.tokens.deep.toLocaleString() : '');
    set('statsNote', (s.oldestSignalAt ? 'Accumulated since ' + new Date(s.oldestSignalAt).toLocaleDateString() + ' · ' : '') + tail);
    document.getElementById('stats').hidden = false;
  } catch (e) { /* stats strip is optional */ }
})();
</script>
</body>
</html>`;
}
