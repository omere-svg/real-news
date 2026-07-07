import { describe, expect, it, vi } from 'vitest';
import { withRetry, isRetryable } from '../../src/llm/retry.js';

const noSleep = async (): Promise<void> => undefined;

describe('isRetryable (ADR-0049)', () => {
  it('retries transient statuses (429, 5xx) and status-less network errors', () => {
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
    expect(isRetryable(new Error('fetch failed'))).toBe(true); // no status
  });

  it('does not retry permanent 4xx', () => {
    expect(isRetryable({ status: 401 })).toBe(false);
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable({ status: 404 })).toBe(false);
  });

  it('does not retry a programmer error with no status (TypeError etc.)', () => {
    expect(isRetryable(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isRetryable(new RangeError('oops'))).toBe(false);
  });

  it('retries recognizable network-ish status-less errors by code/name/message', () => {
    expect(isRetryable(Object.assign(new Error('boom'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isRetryable(Object.assign(new Error('boom'), { code: 'ETIMEDOUT' }))).toBe(true);
    expect(isRetryable(Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isRetryable(Object.assign(new Error('boom'), { code: 'EAI_AGAIN' }))).toBe(true);
    expect(isRetryable(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(true);
  });

  it('retries a JSON parse failure (truncated/garbled provider body)', () => {
    expect(isRetryable(new SyntaxError('Unexpected end of JSON input'))).toBe(true);
  });
});

describe('withRetry', () => {
  it('retries a transient error then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce('ok');
    expect(await withRetry(fn, { sleep: noSleep })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('fails fast on a permanent error — no wasted retries', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 401 });
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1); // not 3
  });

  it('does not retry a TypeError — a programmer bug fails fast', async () => {
    const err = new TypeError('boom');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1); // not 3
  });

  it('gives up after `attempts` transient failures', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 429 });
    await expect(withRetry(fn, { attempts: 3, sleep: noSleep })).rejects.toMatchObject({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('applies ±25% jitter to the exponential backoff delays', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 429 });
    const delays: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      delays.push(ms);
    };

    // random()=0 → the low edge (75%); random()=1 → the high edge (125%).
    await expect(
      withRetry(fn, { attempts: 3, baseDelayMs: 100, sleep, random: () => 0 }),
    ).rejects.toBeDefined();
    expect(delays).toEqual([75, 150]); // 100·2^n · 0.75

    delays.length = 0;
    await expect(
      withRetry(fn, { attempts: 3, baseDelayMs: 100, sleep, random: () => 1 }),
    ).rejects.toBeDefined();
    expect(delays).toEqual([125, 250]); // 100·2^n · 1.25
  });
});
