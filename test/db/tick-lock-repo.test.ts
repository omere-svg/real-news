import { describe, expect, it } from 'vitest';
import { DrizzleTickLock } from '../../src/db/tick-lock-repo.js';
import { tickLock } from '../../src/db/schema.js';
import { createTestDb } from '../helpers/test-db.js';

describe('DrizzleTickLock (cross-process tick lock, ADR-0047)', () => {
  it('grants the lock to one holder and blocks the other', async () => {
    const db = await createTestDb();
    const a = new DrizzleTickLock(db);
    const b = new DrizzleTickLock(db);

    expect(await a.acquire(1000, 5000)).toBe(true); // free → a holds it until 6000
    expect(await b.acquire(1000, 5000)).toBe(false); // still held
    expect(await b.acquire(5999, 5000)).toBe(false); // still held just before expiry
  });

  it('a held lock expires after its TTL so a crash cannot wedge the loop', async () => {
    const db = await createTestDb();
    const a = new DrizzleTickLock(db);
    const b = new DrizzleTickLock(db);

    expect(await a.acquire(1000, 5000)).toBe(true); // locked until 6000
    expect(await b.acquire(6001, 5000)).toBe(true); // expired → b takes over
  });

  it('release frees the lock immediately, but only for the holder', async () => {
    const db = await createTestDb();
    const a = new DrizzleTickLock(db);
    const b = new DrizzleTickLock(db);

    expect(await a.acquire(1000, 5000)).toBe(true);
    await b.release(); // b does not hold it → no-op
    expect(await b.acquire(2000, 5000)).toBe(false); // still a's

    await a.release();
    expect(await b.acquire(2000, 5000)).toBe(true); // now free
  });

  it('the same holder re-acquiring is idempotent (renews its own lock)', async () => {
    const db = await createTestDb();
    const a = new DrizzleTickLock(db);
    expect(await a.acquire(1000, 5000)).toBe(true);
    expect(await a.acquire(2000, 5000)).toBe(true); // renew before expiry
  });

  it('re-acquires after the lock row is deleted out-of-band (QA wipe, ADR-0048)', async () => {
    const db = await createTestDb();
    const a = new DrizzleTickLock(db);

    expect(await a.acquire(1000, 5000)).toBe(true);
    await db.delete(tickLock); // a DB wipe removes the singleton row mid-hold
    expect(await a.acquire(7000, 5000)).toBe(true); // must self-heal, not wedge forever
  });
});
