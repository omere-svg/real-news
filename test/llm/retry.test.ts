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

  it('gives up after `attempts` transient failures', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 429 });
    await expect(withRetry(fn, { attempts: 3, sleep: noSleep })).rejects.toMatchObject({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
