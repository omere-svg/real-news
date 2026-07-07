import { describe, expect, it } from 'vitest';
import { ago, breakdownHtml, emptyStateHtml, escHtml, fmtDuration, topicChips } from '../../src/server/ui-view.js';
import { renderUI } from '../../src/server/ui.js';
import { TOPICS } from '../../src/domain/types.js';

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

  it('embeds the single-source-of-truth escHtml/breakdownHtml helpers verbatim', () => {
    expect(html).toContain('const escHtml = function escHtml(s)');
    expect(html).toContain('const breakdownHtml = function breakdownHtml(b, open, labels)');
  });

  it('regression: a bad/error stories payload cannot leave the skeletons spinning forever', () => {
    // The original bug read `.stories.length` outside the try that fetches it, so
    // an error body without `.stories` threw an uncaught TypeError and the
    // skeleton loaders never cleared. This is client-side JS with no browser
    // harness in this suite, so the closest server-testable regression guard is
    // asserting the shipped script actually guards the shape *inside* the try
    // (a revert of the fix would fail this).
    expect(html).toContain('stories = Array.isArray(body.stories) ? body.stories : [];');
    const tryIdx = html.indexOf('const [res] = await Promise.all');
    const catchIdx = html.indexOf("Couldn\\'t load stories");
    const guardIdx = html.indexOf('stories = Array.isArray(body.stories)');
    expect(tryIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(tryIdx);
    expect(catchIdx).toBeGreaterThan(guardIdx);
  });

  it('renders the empty/error state markup for stories, docs, and podcast-disabled', () => {
    expect(html).toContain('No stories match yet');
    expect(html).toContain("Couldn\\'t load stories");
    expect(html).toContain('Podcast is not enabled here');
  });
});
