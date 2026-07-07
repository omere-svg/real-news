import { describe, expect, it, vi } from 'vitest';
import { makeFetchJson, rateLimitByHost } from '../../src/sources/http.js';

function response(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers });
}

describe('fetchJson (hardened)', () => {
  it('parses JSON and passes an abort signal (timeout)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response('{"ok":true}'));
    const fetchJson = makeFetchJson(fetchImpl, { timeoutMs: 5000, maxBytes: 1_000_000 });

    expect(await fetchJson('https://x/api')).toEqual({ ok: true });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('requests JSON by default but */* for text feeds (some RSS servers 406 on application/json)', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => response('{"ok":true}'));
    const fetchJson = makeFetchJson(fetchImpl, { timeoutMs: 5000, maxBytes: 1_000_000 });

    await fetchJson('https://x/api');
    expect((fetchImpl.mock.calls[0]?.[1].headers as Record<string, string>).accept).toBe(
      'application/json',
    );

    await fetchJson('https://x/feed', { as: 'text' });
    expect((fetchImpl.mock.calls[1]?.[1].headers as Record<string, string>).accept).toBe('*/*');

    // An explicit caller header still wins.
    await fetchJson('https://x/feed', { as: 'text', headers: { accept: 'application/rss+xml' } });
    expect((fetchImpl.mock.calls[2]?.[1].headers as Record<string, string>).accept).toBe(
      'application/rss+xml',
    );
  });

  it('sends a descriptive User-Agent by default, overridable by the caller (ADR-0049)', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => response('{"ok":true}'));
    const fetchJson = makeFetchJson(fetchImpl, { timeoutMs: 5000, maxBytes: 1_000_000 });

    await fetchJson('https://x/api');
    const ua = (fetchImpl.mock.calls[0]?.[1].headers as Record<string, string>)['user-agent'];
    expect(ua).toMatch(/project-horizon/);

    await fetchJson('https://x/api', { headers: { 'user-agent': 'custom/1' } });
    expect((fetchImpl.mock.calls[1]?.[1].headers as Record<string, string>)['user-agent']).toBe('custom/1');
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }));
    const fetchJson = makeFetchJson(fetchImpl, { timeoutMs: 5000, maxBytes: 1_000_000 });
    await expect(fetchJson('https://x/api')).rejects.toThrow(/503/);
  });

  it('rejects an oversized body (size cap)', async () => {
    const big = 'x'.repeat(2000);
    const fetchImpl = vi.fn().mockResolvedValue(
      response(big, { 'content-length': String(big.length) }),
    );
    const fetchJson = makeFetchJson(fetchImpl, { timeoutMs: 5000, maxBytes: 1000 });
    await expect(fetchJson('https://x/api', { as: 'text' })).rejects.toThrow(/too large/i);
  });
});

describe('rateLimitByHost (ADR-0047)', () => {
  it('serializes and spaces requests to a rate-limited host', async () => {
    const at: number[] = [];
    const inner = vi.fn(async (url: string) => {
      at.push(Date.now());
      return { url };
    });
    const limited = rateLimitByHost(inner, { 'api.gdeltproject.org': 50 });

    const start = Date.now();
    // Two concurrent calls to the limited host — mirrors the story feed + tone
    // signal firing in the same tick.
    await Promise.all([
      limited('https://api.gdeltproject.org/a'),
      limited('https://api.gdeltproject.org/b'),
    ]);

    expect(inner).toHaveBeenCalledTimes(2);
    // The second call waited at least the min interval after the first.
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(45);
    expect(at[0]! - start).toBeLessThan(45); // the first went out immediately
  });

  it('does not throttle other hosts', async () => {
    const inner = vi.fn(async (url: string) => ({ url }));
    const limited = rateLimitByHost(inner, { 'api.gdeltproject.org': 5000 });
    const start = Date.now();
    await Promise.all([limited('https://example.com/1'), limited('https://example.com/2')]);
    expect(Date.now() - start).toBeLessThan(100); // no added latency for unlisted hosts
  });

  it('a failed call does not wedge the host queue', async () => {
    let n = 0;
    const inner = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('boom');
      return { ok: true };
    });
    const limited = rateLimitByHost(inner, { 'api.gdeltproject.org': 10 });
    await expect(limited('https://api.gdeltproject.org/x')).rejects.toThrow(/boom/);
    // The next request still runs rather than hanging on the broken chain.
    expect(await limited('https://api.gdeltproject.org/y')).toEqual({ ok: true });
  });
});
