import { describe, expect, it } from 'vitest';
import * as vm from 'node:vm';
import { ago, emptyStateHtml, escHtml, fmtDuration, topicChips } from '../../src/server/ui-view.js';
import { renderUI } from '../../src/server/ui.js';
import { TOPICS } from '../../src/domain/types.js';

/**
 * Pulls a single top-level `const name = ...;` / `function name(...) {...}` /
 * `async function name(...) {...}` declaration out of the shipped `<script>`
 * source by name, using the declaration that follows it (`untilMarker`) as
 * the end boundary. This lets tests execute a real slice of the shipped
 * client script in a `vm` sandbox instead of merely grepping for substrings.
 */
function extractDecl(source: string, startMarker: string, untilMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`extractDecl: start marker not found: ${startMarker}`);
  const end = source.indexOf(untilMarker, start);
  if (end === -1) throw new Error(`extractDecl: end marker not found: ${untilMarker}`);
  return source.slice(start, end).trim();
}

describe('escHtml', () => {
  it('escapes a story title that carries a script tag', () => {
    expect(escHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes ampersands and quotes', () => {
    expect(escHtml(`Tom & Jerry's "show"`)).toBe('Tom &amp; Jerry\'s &quot;show&quot;');
  });

  it('coerces non-string input like the original client helper', () => {
    expect(escHtml(42 as unknown as string)).toBe('42');
  });
});

describe('emptyStateHtml — the viewer error/empty card', () => {
  it('renders a headline and body, HTML-escaped', () => {
    const html = emptyStateHtml('<b>No stories</b>', 'Check back <later>.');
    expect(html).toContain('class="empty"');
    expect(html).toContain('&lt;b&gt;No stories&lt;/b&gt;');
    expect(html).toContain('Check back &lt;later&gt;.');
  });
});

describe('topicChips', () => {
  const first = TOPICS[0] as string;

  it('renders one chip per topic and checks the pre-selected ones', () => {
    const html = topicChips([first]);
    for (const t of TOPICS) expect(html).toContain(`data-topic="${t}"`);
    expect(html).toContain(`value="${first}" checked`);
  });

  it('checks nothing when no defaults are given ("All")', () => {
    const html = topicChips([]);
    expect(html).not.toContain('checked');
  });
});

describe('ago / fmtDuration', () => {
  it('formats seconds, minutes, and hours', () => {
    expect(ago(0, 30_000)).toBe('30s ago');
    expect(ago(0, 5 * 60_000)).toBe('5m ago');
    expect(ago(0, 5 * 3600_000)).toBe('5h ago');
  });

  it('formats sub-second, second, and minute durations', () => {
    expect(fmtDuration(480)).toBe('480ms');
    expect(fmtDuration(12_400)).toBe('12.4s');
    expect(fmtDuration(248_000)).toBe('4m 08s');
  });
});

describe('renderUI — client script wiring (regression coverage)', () => {
  const html = renderUI({ minutes: 10, podcastEnabled: true });

  it('embeds the single-source-of-truth escHtml/emptyStateHtml helpers verbatim', () => {
    expect(html).toContain('const escHtml = function escHtml(s)');
    expect(html).toContain('const emptyStateHtml = function emptyStateHtml(headline, body)');
  });

  it('splices escHtml before emptyStateHtml — emptyStateHtml resolves escHtml as a free variable', () => {
    // emptyStateHtml is injected as standalone function source (not a closure),
    // so it only works in the browser if escHtml is declared earlier in the same
    // <script>. Guard the splice order.
    const escHtmlIdx = html.indexOf('const escHtml =');
    const emptyStateHtmlIdx = html.indexOf('const emptyStateHtml =');
    expect(escHtmlIdx).toBeGreaterThan(-1);
    expect(emptyStateHtmlIdx).toBeGreaterThan(escHtmlIdx);
  });

  it('offers only the Brief + Podcast formats (Stories + Topic outline removed, ADR-0060)', () => {
    expect(html).toContain('data-fmt="brief"');
    expect(html).toContain('data-fmt="podcast"');
    expect(html).not.toContain('data-fmt="stories"');
    expect(html).not.toContain('data-fmt="outline"');
    // No leftover Stories-only code paths.
    expect(html).not.toContain('loadStories');
    expect(html).not.toContain('editorsNote');
    expect(html).not.toContain('autoOutlineTopic');
    expect(html).not.toContain('/api/stories');
  });

  it('renders the empty/error state markup for docs and podcast-disabled', () => {
    expect(html).toContain('Ready when you are'); // Generate-gated empty state
    expect(html).toContain("Couldn't load that");
    expect(html).toContain('Podcast is not enabled here');
  });

  describe('behavioral: load() clears the skeletons on a bad brief payload', () => {
    // Extract the real shipped source for escHtml, emptyStateHtml, skeletons, the
    // renderers, and load() out of renderUI()'s output and execute them in a vm
    // sandbox with a stubbed fetch/list — this exercises the actual shipped guard
    // logic, not a grep of it.
    const escHtmlSrc = extractDecl(html, 'const escHtml =', '\nfunction esc(s)');
    const escFnSrc = extractDecl(html, 'function esc(s)', '\n// emptyStateHtml');
    const emptyStateHtmlSrc = extractDecl(html, 'const emptyStateHtml =', '\n// Only allow http(s) links');
    const safeUrlSrc = extractDecl(html, 'function safeUrl(u)', '\nfunction selectedTopics');
    const topicColorsSrc = extractDecl(html, 'const TOPIC_COLORS = {', '\ndocument.querySelectorAll');
    const hintsSrc = extractDecl(html, 'const HINTS = {', '\nconst DOC_FIELD');
    const docFieldSrc = extractDecl(html, 'const DOC_FIELD =', '\nlet format');
    const skeletonsSrc = extractDecl(html, 'function skeletons(n)', '\n\n// ---- Brief');
    const renderDocSrc = extractDecl(html, 'function renderDoc(format, text)', '\n// The web podcast');
    const renderPodcastSrc = extractDecl(html, 'function renderPodcast(script, audioB64)', '\n\nasync function load');
    const loadSrc = extractDecl(html, 'async function load() {', '\n\nseg.addEventListener');

    function makeSandbox(fetchImpl: (...args: unknown[]) => Promise<unknown>) {
      const list = { innerHTML: '<div class="skel"></div>' };
      const context = vm.createContext({
        list,
        fetch: fetchImpl,
        format: 'brief',
        hint: { textContent: '' },
        minutesInput: { value: '10' },
        minutesLabel: { textContent: '' },
        selectedTopics: () => [],
        location: { origin: 'https://horizon.example' },
        URL,
        URLSearchParams,
      });
      vm.runInContext(
        [
          escHtmlSrc, escFnSrc, emptyStateHtmlSrc, safeUrlSrc, topicColorsSrc,
          hintsSrc, docFieldSrc, skeletonsSrc, renderDocSrc, renderPodcastSrc, loadSrc,
        ].join('\n'),
        context,
      );
      return { context, list };
    }

    it('a rejected fetch (network failure) renders the load-error state instead of hanging on skeletons', async () => {
      const { context, list } = makeSandbox(async () => {
        throw new Error('network down');
      });
      await context.load();
      expect(list.innerHTML).not.toContain('class="skel"');
      expect(list.innerHTML).toContain("Couldn't load that");
    });

    it('renders the parsed brief as story cards, escaping fields', async () => {
      const brief = 'Horizon brief — 10 min, 1 story\n\n📰 <b>Big</b> news\nWhat happened here.\n💡 Why it counts\n🏷 AI · significance 7.0';
      const { context, list } = makeSandbox(async () => ({ json: async () => ({ brief }) }));
      await context.load();
      expect(list.innerHTML).not.toContain('class="skel"');
      expect(list.innerHTML).toContain('&lt;b&gt;Big&lt;/b&gt; news'); // title escaped
      expect(list.innerHTML).toContain('Why it counts');
    });
  });
});

describe('intent: a link back to every source (ADR-0027 provenance, web cards)', () => {
  // Execute the shipped renderBriefStories (and its helpers) in a vm sandbox to
  // prove each web card links back to the original outlet — the "read the full
  // piece / verify the summary" reliability promise — and that a feed-controlled
  // unsafe url is dropped, never rendered as a live link.
  const html = renderUI({ minutes: 10, podcastEnabled: true });
  const escHtmlSrc = extractDecl(html, 'const escHtml =', '\nfunction esc(s)');
  const escFnSrc = extractDecl(html, 'function esc(s)', '\n// emptyStateHtml');
  const safeUrlSrc = extractDecl(html, 'function safeUrl(u)', '\nfunction selectedTopics');
  const topicColorsSrc = extractDecl(html, 'const TOPIC_COLORS = {', '\ndocument.querySelectorAll');
  const srcLinkSrc = extractDecl(html, 'function srcLink(su)', '\nfunction scoreBar(label, value)');
  const scoreBarSrc = extractDecl(html, 'function scoreBar(label, value)', '\nfunction whyScoreHtml(s)');
  const whyScoreHtmlSrc = extractDecl(
    html, 'function whyScoreHtml(s)', '\nfunction renderBriefStories(header, stories)',
  );
  const renderBriefStoriesSrc = extractDecl(
    html, 'function renderBriefStories(header, stories)', '\n// The web podcast',
  );

  function render(story: Record<string, unknown>): string {
    const context = vm.createContext({ location: { origin: 'https://horizon.example' }, URL });
    vm.runInContext(
      [
        escHtmlSrc, escFnSrc, safeUrlSrc, topicColorsSrc,
        srcLinkSrc, scoreBarSrc, whyScoreHtmlSrc, renderBriefStoriesSrc,
      ].join('\n'),
      context,
    );
    return (context as { renderBriefStories: (h: string, s: unknown[]) => string })
      .renderBriefStories('Header', [{ topic: 'AI', significance: 9, tags: [], drivers: [], ...story }]);
  }

  it('renders a "Read the full article" link when the story has a safe url', () => {
    const out = render({ title: 'Alpha', url: 'https://example.com/a' });
    expect(out).toContain('Read the full article');
    expect(out).toContain('href="https://example.com/a"');
  });

  it('omits the source link when the story has no url', () => {
    const out = render({ title: 'Alpha', url: null });
    expect(out).not.toContain('Read the full article');
  });

  it('drops a feed-controlled unsafe (javascript:) url instead of linking it', () => {
    const out = render({ title: 'Alpha', url: 'javascript:alert(1)' });
    expect(out).not.toContain('Read the full article');
    expect(out).not.toContain('javascript:');
  });
});
