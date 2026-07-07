import { describe, expect, it } from 'vitest';
import * as vm from 'node:vm';
import { ago, breakdownHtml, emptyStateHtml, escHtml, fmtDuration, topicChips } from '../../src/server/ui-view.js';
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

const LABELS = { impact: 'Real-world impact', corroboration: 'Corroboration' };

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

describe('breakdownHtml — the "Why this score?" widget', () => {
  const breakdown = {
    components: [
      { key: 'impact', value: 0.8 },
      { key: '<script>', value: 0.3 }, // an unknown key falls back to itself, must still be escaped
      { key: 'corroboration', value: 0.6 },
    ],
    signals: { corroboration: 3 },
    recencyFactor: 0.95,
    signalNudge: 0.2,
  };

  it('renders a bar per component with its label, escaped', () => {
    const html = breakdownHtml(breakdown, false, LABELS);
    expect(html).toContain('<div class="bars">');
    expect(html).toContain('Real-world impact');
    expect(html).toContain('width:80%');
    expect(html).toContain('&lt;script&gt;'); // unknown-key fallback label is escaped
    expect(html).not.toContain('<script>value');
  });

  it('opens the <details> when told to (top story default-open)', () => {
    expect(breakdownHtml(breakdown, true, LABELS)).toContain('<details class="why-score" open>');
    expect(breakdownHtml(breakdown, false, LABELS)).toContain('<details class="why-score">');
  });

  it('surfaces corroboration count and recency in the facts line', () => {
    const html = breakdownHtml(breakdown, false, LABELS);
    expect(html).toContain('3 sources');
    expect(html).toContain('recency 95%');
  });

  it('omits the "0 sources" phrase — it is noise, not a fact', () => {
    const single = { ...breakdown, signals: { corroboration: 0 } };
    const html = breakdownHtml(single, false, LABELS);
    expect(html).not.toMatch(/0 source/);
    expect(html).toContain('recency 95%');
  });

  it('renders nothing for a missing breakdown (pre-ADR-0032 stories)', () => {
    expect(breakdownHtml(null, false, LABELS)).toBe('');
    expect(breakdownHtml(undefined, true, LABELS)).toBe('');
  });

  it('renders the corroboration bar for a multi-source story', () => {
    const html = breakdownHtml(breakdown, false, LABELS);
    expect(html).toContain('Corroboration');
    expect(html).toContain('width:60%');
  });

  it('single-source story renders no corroboration bar', () => {
    const single = {
      ...breakdown,
      components: [
        { key: 'impact', value: 0.8 },
        { key: 'corroboration', value: 0 },
      ],
      signals: { corroboration: 1 },
    };
    const html = breakdownHtml(single, false, LABELS);
    expect(html).not.toContain('Corroboration');
    expect(html).not.toContain('width:0%');
    expect(html).toContain('Real-world impact'); // other bars still render
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
  const html = renderUI({ minutes: 10 });

  it('embeds the single-source-of-truth escHtml/breakdownHtml/emptyStateHtml helpers verbatim', () => {
    expect(html).toContain('const escHtml = function escHtml(s)');
    expect(html).toContain('const breakdownHtml = function breakdownHtml(b, open, labels)');
    expect(html).toContain('const emptyStateHtml = function emptyStateHtml(headline, body)');
  });

  it('splices escHtml before breakdownHtml — breakdownHtml resolves escHtml as a free variable, not a closure', () => {
    // Unenforced-by-the-type-system dependency: breakdownHtml (and
    // emptyStateHtml) are injected as standalone function source, not
    // closures, so they only work in the browser if escHtml has already
    // been declared earlier in the same <script>. Guard the splice order.
    const escHtmlIdx = html.indexOf('const escHtml =');
    const emptyStateHtmlIdx = html.indexOf('const emptyStateHtml =');
    const breakdownHtmlIdx = html.indexOf('const breakdownHtml =');
    expect(escHtmlIdx).toBeGreaterThan(-1);
    expect(emptyStateHtmlIdx).toBeGreaterThan(escHtmlIdx);
    expect(breakdownHtmlIdx).toBeGreaterThan(escHtmlIdx);
  });

  it('regression: a bad/error stories payload cannot leave the skeletons spinning forever', () => {
    // The original bug read `.stories.length` outside the try that fetches it, so
    // an error body without `.stories` threw an uncaught TypeError and the
    // skeleton loaders never cleared. Source-position check as a cheap smoke
    // test; the behavioral guard below actually executes the shipped code.
    expect(html).toContain('stories = Array.isArray(body.stories) ? body.stories : [];');
    const tryIdx = html.indexOf('const [res] = await Promise.all');
    const catchIdx = html.indexOf("Couldn't load stories");
    const guardIdx = html.indexOf('stories = Array.isArray(body.stories)');
    expect(tryIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(tryIdx);
    expect(catchIdx).toBeGreaterThan(guardIdx);
  });

  it('renders the empty/error state markup for stories, docs, and podcast-disabled', () => {
    expect(html).toContain('No stories match yet');
    expect(html).toContain("Couldn't load stories");
    expect(html).toContain('Podcast is not enabled here');
  });

  describe('behavioral: loadStories actually clears the skeletons on a bad payload', () => {
    // Extract the real shipped source for escHtml, emptyStateHtml, skeletons,
    // and loadStories out of renderUI()'s output and execute them in a vm
    // sandbox with a stubbed fetch/list — this exercises the actual shipped
    // guard logic (not a grep of it), the technique proven during review.
    const escHtmlSrc = extractDecl(html, 'const escHtml =', '\nfunction esc(s)');
    const emptyStateHtmlSrc = extractDecl(html, 'const emptyStateHtml =', '\n// Only allow http(s) links');
    const skeletonsSrc = extractDecl(html, 'function skeletons(n)', '\n\n// ---- Brief');
    const loadStoriesSrc = extractDecl(html, 'async function loadStories(topics) {', '\n\nseg.addEventListener');

    function makeSandbox(fetchImpl: (...args: unknown[]) => Promise<unknown>) {
      const list = { innerHTML: '<div class="skel"></div>' };
      const context = vm.createContext({
        list,
        fetch: fetchImpl,
        getLastTickAt: async () => null,
        URLSearchParams,
      });
      vm.runInContext(
        `${escHtmlSrc}\n${emptyStateHtmlSrc}\n${skeletonsSrc}\n${loadStoriesSrc}`,
        context,
      );
      return { context, list };
    }

    it('a non-2xx JSON error body with no .stories renders the empty state instead of hanging on skeletons', async () => {
      const { context, list } = makeSandbox(async () => ({
        json: async () => ({ error: 'boom' }),
      }));
      await context.loadStories([]);
      expect(list.innerHTML).not.toContain('class="skel"');
      expect(list.innerHTML).toContain('No stories match yet');
    });

    it('a rejected fetch (network failure) renders the load-error state instead of hanging on skeletons', async () => {
      const { context, list } = makeSandbox(async () => {
        throw new Error('network down');
      });
      await context.loadStories([]);
      expect(list.innerHTML).not.toContain('class="skel"');
      expect(list.innerHTML).toContain("Couldn't load stories");
    });
  });

  describe('behavioral: loadStories prefers displayTitle over the raw title (Task 20)', () => {
    // Same vm-sandbox technique as above, but this time execute the full
    // shipped card-rendering path (TOPIC_COLORS, safeUrl, breakdownHtml,
    // SCORE_LABELS too) so the assertion exercises the real shipped
    // `s.displayTitle || s.title` logic, not a re-implementation of it.
    const escHtmlSrc = extractDecl(html, 'const escHtml =', '\nfunction esc(s)');
    const escFnSrc = extractDecl(html, 'function esc(s)', '\n// emptyStateHtml');
    const emptyStateHtmlSrc = extractDecl(html, 'const emptyStateHtml =', '\n// Only allow http(s) links');
    const safeUrlSrc = extractDecl(html, 'function safeUrl(u)', '\nfunction selectedTopics');
    const topicColorsSrc = extractDecl(html, 'const TOPIC_COLORS = {', '\ndocument.querySelectorAll');
    const scoreLabelsSrc = extractDecl(html, 'const SCORE_LABELS =', '\nconst breakdownHtml =');
    const breakdownHtmlSrc = extractDecl(html, 'const breakdownHtml =', '\n\nfunction skeletons');
    const skeletonsSrc = extractDecl(html, 'function skeletons(n)', '\n\n// ---- Brief');
    const loadStoriesSrc = extractDecl(html, 'async function loadStories(topics) {', '\n\nseg.addEventListener');

    function makeSandbox(stories: unknown[]) {
      const list = { innerHTML: '<div class="skel"></div>' };
      const context = vm.createContext({
        list,
        fetch: async () => ({ json: async () => ({ stories }) }),
        getLastTickAt: async () => null,
        editorsNote: () => '',
        location: { origin: 'https://horizon.example' },
        URL,
        URLSearchParams,
      });
      vm.runInContext(
        [
          escHtmlSrc,
          escFnSrc,
          emptyStateHtmlSrc,
          safeUrlSrc,
          topicColorsSrc,
          scoreLabelsSrc,
          breakdownHtmlSrc,
          skeletonsSrc,
          loadStoriesSrc,
        ].join('\n'),
        context,
      );
      return { context, list };
    }

    const baseStory = {
      title: 'Boğaziçi Köprüsü açıldı',
      url: null,
      topic: 'AI',
      significance: 5,
      whyItMatters: null,
      scoreBreakdown: null,
      scoreTags: [],
      memberRefs: [{ source: 'hackernews', externalId: '1' }],
    };

    it('renders displayTitle when the deep tier set one, not the raw source title', async () => {
      const { context, list } = makeSandbox([
        { ...baseStory, displayTitle: 'The Bosphorus Bridge opened' },
      ]);
      await context.loadStories([]);
      expect(list.innerHTML).toContain('The Bosphorus Bridge opened');
      expect(list.innerHTML).not.toContain('Boğaziçi Köprüsü açıldı');
    });

    it('falls back to the cleaned original title when displayTitle is null (below top-N)', async () => {
      const { context, list } = makeSandbox([{ ...baseStory, displayTitle: null }]);
      await context.loadStories([]);
      expect(list.innerHTML).toContain('Boğaziçi Köprüsü açıldı');
    });

    it('HTML-escapes a displayTitle the same as any other rendered field', async () => {
      const { context, list } = makeSandbox([
        { ...baseStory, displayTitle: '<script>alert(1)</script>' },
      ]);
      await context.loadStories([]);
      expect(list.innerHTML).not.toContain('<script>alert(1)</script>');
      expect(list.innerHTML).toContain('&lt;script&gt;');
    });
  });
});
