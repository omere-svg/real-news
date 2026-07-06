import { describe, expect, it } from 'vitest';
import { DrizzleWebAuthRepo } from '../../src/db/web-auth-repo.js';
import { createTestDb } from '../helpers/test-db.js';

const TTL = { sessionTtlMs: 30 * 24 * 3600_000, codeTtlMs: 10 * 60_000 };

async function repo() {
  return new DrizzleWebAuthRepo(await createTestDb());
}

describe('DrizzleWebAuthRepo (Log in with Telegram pairing)', () => {
  it('a fresh session resolves as pending (no chatId yet)', async () => {
    const r = await repo();
    await r.createPending({ token: 't1', code: 'ABC123', now: 1000, ...TTL });

    const s = await r.resolve('t1', 2000);
    expect(s).toEqual({ token: 't1', chatId: null, name: null });
  });

  it('claiming a code links it onto the session on the next resolve', async () => {
    const r = await repo();
    await r.createPending({ token: 't1', code: 'ABC123', now: 1000, ...TTL });

    expect(await r.claim('ABC123', 42, 'Omer', 2000)).toBe('linked');

    const s = await r.resolve('t1', 3000);
    expect(s).toEqual({ token: 't1', chatId: 42, name: 'Omer' });
  });

  it('once linked, the code is consumed and the session stays linked', async () => {
    const r = await repo();
    await r.createPending({ token: 't1', code: 'ABC123', now: 1000, ...TTL });
    await r.claim('ABC123', 42, 'Omer', 2000);
    await r.resolve('t1', 3000); // promotes + deletes the code

    // The code no longer exists; the session remains linked across polls.
    expect(await r.claim('ABC123', 99, 'Mallory', 4000)).toBe('unknown');
    expect(await r.resolve('t1', 5000)).toEqual({ token: 't1', chatId: 42, name: 'Omer' });
  });

  it('an expired code cannot be claimed', async () => {
    const r = await repo();
    await r.createPending({ token: 't1', code: 'ABC123', now: 1000, codeTtlMs: 60_000, sessionTtlMs: TTL.sessionTtlMs });

    expect(await r.claim('ABC123', 42, null, 1000 + 60_001)).toBe('expired');
    expect(await r.resolve('t1', 1000 + 60_002)).toEqual({ token: 't1', chatId: null, name: null });
  });

  it('an unknown code claim reports unknown', async () => {
    const r = await repo();
    expect(await r.claim('NOPE', 42, null, 1000)).toBe('unknown');
  });

  it('an expired session resolves to null', async () => {
    const r = await repo();
    await r.createPending({ token: 't1', code: 'ABC123', now: 1000, sessionTtlMs: 5000, codeTtlMs: 5000 });
    expect(await r.resolve('t1', 7000)).toBeNull();
  });

  it('logout drops the session and its code', async () => {
    const r = await repo();
    await r.createPending({ token: 't1', code: 'ABC123', now: 1000, ...TTL });
    await r.logout('t1');
    expect(await r.resolve('t1', 2000)).toBeNull();
    expect(await r.claim('ABC123', 42, null, 2000)).toBe('unknown');
  });

  it('resolve on an unknown token is null', async () => {
    const r = await repo();
    expect(await r.resolve('ghost', 1000)).toBeNull();
  });
});
