import { describe, expect, it, vi } from 'vitest';
import { makeFetchJson } from '../../src/sources/http.js';

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
