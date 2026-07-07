import { describe, expect, it } from 'vitest';
import { isGroundedUrl } from '../../src/llm/url-guard.js';

/**
 * Shared output-URL guard (ADR-0053/0054, security audit follow-up): both the
 * reasoner's `discuss` and the chat agent's answer guard must ground on the
 * REAL host, not a raw string prefix — `startsWith` lets an attacker suffix
 * a grounded host (`good.example.evil.tld`) or lets a truncated fragment
 * (`https://e`) match anything.
 */
describe('isGroundedUrl', () => {
  it('rejects https://good.example.evil.tld when https://good.example is grounded', () => {
    expect(isGroundedUrl('https://good.example.evil.tld/steal', ['https://good.example/story'])).toBe(
      false,
    );
  });

  it('rejects a truncated fragment matching via the old g.startsWith(url) bug', () => {
    expect(isGroundedUrl('https://e', ['https://example.com/story'])).toBe(false);
  });

  it('rejects an unparseable URL', () => {
    expect(isGroundedUrl('not a url', ['https://example.com/story'])).toBe(false);
  });

  it('ignores an unparseable grounded entry instead of throwing', () => {
    expect(isGroundedUrl('https://example.com/story', ['not a url', 'https://example.com/story'])).toBe(
      true,
    );
  });

  it('accepts an exact match', () => {
    expect(isGroundedUrl('https://example.com/story', ['https://example.com/story'])).toBe(true);
  });

  it('matches the host case-insensitively', () => {
    expect(isGroundedUrl('https://EXAMPLE.com/story', ['https://example.com/story'])).toBe(true);
  });

  it('accepts a path that extends the grounded path on a segment boundary', () => {
    expect(isGroundedUrl('https://example.com/story/page2', ['https://example.com/story'])).toBe(true);
  });

  it('rejects a path that only shares a string prefix, not a segment boundary', () => {
    expect(isGroundedUrl('https://example.com/storyteller', ['https://example.com/story'])).toBe(false);
  });

  it('rejects a same-host different-path URL', () => {
    expect(isGroundedUrl('https://example.com/other', ['https://example.com/story'])).toBe(false);
  });

  it('rejects a different scheme on the same host/path', () => {
    expect(isGroundedUrl('http://example.com/story', ['https://example.com/story'])).toBe(false);
  });
});
