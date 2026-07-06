import { describe, expect, it } from 'vitest';
import { DrizzleWebAuthRepo } from '../../src/db/web-auth-repo.js';
import { createTestDb } from '../helpers/test-db.js';

const CODE_TTL = 10 * 60_000;
const SESSION_TTL = 30 * 24 * 3600_000;

async function repo() {
  return new DrizzleWebAuthRepo(await createTestDb());
}

describe('DrizzleWebAuthRepo (Log in with Telegram pairing)', () => {
  it('a fresh session resolves as pending (no chatId yet)', async () => {
    const r = await repo();
    await r.createPending({ token: 't1', code: 'ABC123', now: 1000, codeTtlMs: CODE_TTL });

    const s = await r.resolve('t1', 2000, SESSION_TTL);
    expect(s).toEqual({ token: 't1', chatId: null, name: null });
  });

  it('claiming a code links it onto the session on the next resolve', async () => {
    const r = await repo();
    await r.createPending({ token: 't1', code: 'ABC123', now: 1000, codeTtlMs: CODE_TTL });

    expect(await r.claim('ABC123', 42, 'Omer', 2000)).toBe('linked');

    const s = await r.resolve('t1', 3000, SESSION_TTL);
    expect(s).toEqual({ token: 't1', chatId: 42, name: 'Omer' });
  });

  it('once linked, the code is consumed and the session stays linked', async () => {
    const r = await repo();
    await r.createPending({ token: 't1', code: 'ABC123', now: 1000, codeTtlMs: CODE_TTL });
    await r.claim('ABC123', 42, 'Omer', 2000);
    await r.resolve('t1', 3000, SESSION_TTL); // promotes + deletes the code

    // The code no longer exists; the session remains linked across polls.
    expect(await r.claim('ABC123', 99, 'Mallory', 4000)).toBe('unknown');
    expect(await r.resolve('t1', 5000, SESSION_TTL)).toEqual({ token: 't1', chatId: 42, name: 'Omer' });
  });

  it('an expired code cannot be claimed, and its pending session dies with it (ADR-0048)', async () => {
    const r = await repo();
    await r.createPending({ token: 't1', code: 'ABC123', now: 1000, codeTtlMs: 60_000 });

    expect(await r.claim('ABC123', 42, null, 1000 + 60_001)).toBe('expired');
    // The pending session must not outlive its code: nothing can ever link it.
    expect(await r.resolve('t1', 1000 + 60_002, SESSION_TTL)).toBeNull();
  });

  it('an unknown code claim reports unknown', async () => {
    const r = await repo();
    expect(await r.claim('NOPE', 42, null, 1000)).toBe('unknown');
  });

  it('a code already claimed by one chat cannot be hijacked by another (ADR-0047)', async () => {
    const r = await repo();
    await r.createPending({ token: 't1', code: 'ABC123', now: 1000, codeTtlMs: CODE_TTL });

    expect(await r.claim('ABC123', 42, 'Omer', 2000)).toBe('linked');
    // A second chat must NOT be able to steal the pending session before resolve.
    expect(await r.claim('ABC123', 99, 'Mallory', 2500)).toBe('unknown');
    // Re-claiming by the original chat is still idempotent.
    expect(await r.claim('ABC123', 42, 'Omer', 2600)).toBe('linked');

    const s = await r.resolve('t1', 3000, SESSION_TTL);
    expect(s).toEqual({ token: 't1', chatId: 42, name: 'Omer' }); // the rightful owner
  });

  it('a pending session expires with its code when never claimed (ADR-0048)', async () => {
    const r = await repo();
    await r.createPending({ token: 't1', code: 'C1', now: 1000, codeTtlMs: 10_000 });
    expect(await r.resolve('t1', 12_000, 100_000)).toBeNull(); // dead after code TTL
  });

  it('a claimed session is extended to the full session TTL on promote (ADR-0048)', async () => {
    const r = await repo();
    await r.createPending({ token: 't2', code: 'C2', now: 1000, codeTtlMs: 10_000 });
    expect(await r.claim('C2', 42, 'Omer', 2000)).toBe('linked');
    const s = await r.resolve('t2', 3000, 100_000); // promote extends to now+100s
    expect(s?.chatId).toBe(42);
    expect(await r.resolve('t2', 90_000, 100_000)).not.toBeNull(); // alive well past code TTL
  });

  it('logout drops the session and its code', async () => {
    const r = await repo();
    await r.createPending({ token: 't1', code: 'ABC123', now: 1000, codeTtlMs: CODE_TTL });
    await r.logout('t1');
    expect(await r.resolve('t1', 2000, SESSION_TTL)).toBeNull();
    expect(await r.claim('ABC123', 42, null, 2000)).toBe('unknown');
  });

  it('resolve on an unknown token is null', async () => {
    const r = await repo();
    expect(await r.resolve('ghost', 1000, SESSION_TTL)).toBeNull();
  });

  it('pruneExpired sweeps stale sessions and codes but keeps live ones (ADR-0040)', async () => {
    const r = await repo();
    // A pairing whose code (and thus pending session, ADR-0048) expires in 60s.
    await r.createPending({ token: 'old', code: 'OLD123', now: 1000, codeTtlMs: 60_000 });
    // A fully live pairing.
    await r.createPending({ token: 'new', code: 'NEW456', now: 1000, codeTtlMs: CODE_TTL });

    // At t = 1000 + 61s: 'old' session AND its code are expired.
    const removed = await r.pruneExpired(1000 + 61_000);
    expect(removed).toBeGreaterThanOrEqual(2);

    expect(await r.resolve('old', 1000 + 61_000, SESSION_TTL)).toBeNull(); // swept
    expect(await r.claim('OLD123', 1, null, 1000 + 61_000)).toBe('unknown'); // code swept
    expect(await r.resolve('new', 1000 + 61_000, SESSION_TTL)).toEqual({ token: 'new', chatId: null, name: null }); // kept
    expect(await r.claim('NEW456', 7, 'Live', 1000 + 61_000)).toBe('linked'); // live code kept
  });
});
