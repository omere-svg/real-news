import { describe, expect, it } from 'vitest';
import { QuotaGuard, isFreeCommand, type BotLimits } from '../../src/telegram/quota-guard.js';
import { DrizzleUsageRepo } from '../../src/db/usage-repo.js';
import { createTestDb } from '../helpers/test-db.js';
import type { TelegramTransport } from '../../src/telegram/telegram-transport.js';

const LIMITS: BotLimits = {
  perMinute: 100, podcastPerDay: 2, commandsPerDay: 3,
  globalPodcastPerDay: 5, globalCommandsPerDay: 100,
};

class RecordingTransport implements TelegramTransport {
  msgs: string[] = [];
  async sendMessage(_c: number, t: string): Promise<void> { this.msgs.push(t); }
  async sendAudio(): Promise<void> {}
  async getUpdates(): Promise<{ updates: [] }> { return { updates: [] }; }
  async answerCallback(): Promise<void> {}
}

async function guard(limits: Partial<BotLimits> = {}) {
  const usage = new DrizzleUsageRepo(await createTestDb());
  const transport = new RecordingTransport();
  return { g: new QuotaGuard(usage, { ...LIMITS, ...limits }, transport), usage, transport };
}

describe('QuotaGuard (ADR-0052)', () => {
  it('free commands never draw the budget', async () => {
    const { g } = await guard();
    for (let i = 0; i < 10; i += 1) expect(await g.withinQuota(1, { kind: 'help' }, 0)).toBe(true);
    expect(isFreeCommand('prefsShow')).toBe(true);
    expect(isFreeCommand('brief')).toBe(false);
  });

  it('blocks the (N+1)th costed command with exactly one notice', async () => {
    const { g, transport } = await guard({ commandsPerDay: 2 });
    expect(await g.withinQuota(1, { kind: 'brief' }, 0)).toBe(true);
    expect(await g.withinQuota(1, { kind: 'brief' }, 0)).toBe(true);
    expect(await g.withinQuota(1, { kind: 'brief' }, 0)).toBe(false); // over
    expect(await g.withinQuota(1, { kind: 'brief' }, 0)).toBe(false);
    expect(transport.msgs.filter((m) => /limit/i.test(m))).toHaveLength(1); // one notice only
  });

  it('overCommandQuota peeks without charging', async () => {
    const { g, usage } = await guard({ commandsPerDay: 1 });
    expect(await g.overCommandQuota(1, 0)).toBe(false);
    expect(await usage.peek('chat:1:cmd', '1970-01-01')).toBe(0); // peek didn't increment
    await g.chargeCommand(1, 0);
    expect(await g.overCommandQuota(1, 0)).toBe(true); // now at the cap
  });

  it('checks the global podcast ceiling before charging the personal counter', async () => {
    const { g, usage } = await guard({ globalPodcastPerDay: 0 });
    expect(await g.withinQuota(1, { kind: 'podcast' }, 0)).toBe(false); // global blocks
    expect(await usage.peek('chat:1:podcast', '1970-01-01')).toBe(0); // personal untouched
  });
});
