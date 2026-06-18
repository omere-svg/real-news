import { describe, expect, it } from 'vitest';
import { HorizonBot, type BotLimits } from '../../src/telegram/horizon-bot.js';
import { FixedWindowLimiter, type RateLimiter } from '../../src/telegram/rate-limiter.js';
import { createTestDb } from '../helpers/test-db.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { DrizzleChatPreferencesRepo } from '../../src/db/chat-preferences-repo.js';
import { DrizzleUsageRepo } from '../../src/db/usage-repo.js';
import type {
  SendAudioOptions,
  TelegramTransport,
  TelegramUpdate,
} from '../../src/telegram/telegram-transport.js';
import type { BriefRequest, QueryEngine } from '../../src/presentation/query-engine.js';
import type { Synthesizer } from '../../src/telegram/synthesizer.js';
import type { Topic } from '../../src/domain/types.js';
import { FakeLLM } from '../helpers/fake-llm.js';
import type { FeedbackInterpreter, FeedbackIntent } from '../../src/llm/llm-client.js';

class FakeTransport implements TelegramTransport {
  readonly messages: { chatId: number; text: string }[] = [];
  readonly audios: { chatId: number; audio: Buffer; opts: SendAudioOptions | undefined }[] = [];
  async sendMessage(chatId: number, text: string): Promise<void> {
    this.messages.push({ chatId, text });
  }
  async sendAudio(chatId: number, audio: Buffer, opts?: SendAudioOptions): Promise<void> {
    this.audios.push({ chatId, audio, opts });
  }
  async getUpdates(): Promise<TelegramUpdate[]> {
    return [];
  }
}

class FakeQuery implements QueryEngine {
  lastRequest?: BriefRequest;
  lastTopic?: Topic;
  async textBrief(r: BriefRequest): Promise<string> {
    this.lastRequest = r;
    return `BRIEF[${r.minutes}]`;
  }
  async topicOutline(topic: Topic, r: BriefRequest): Promise<string> {
    this.lastTopic = topic;
    this.lastRequest = r;
    return `OUTLINE[${topic}]`;
  }
  async podcastScript(r: BriefRequest): Promise<string> {
    this.lastRequest = r;
    return `SCRIPT[${r.minutes}]`;
  }
}

const audioSynth: Synthesizer = { synthesize: async () => Buffer.from([1, 2, 3]) };
const nullSynth: Synthesizer = { synthesize: async () => null };

const GENEROUS: BotLimits = {
  perMinute: 1000,
  podcastPerDay: 1000,
  commandsPerDay: 1000,
  globalPodcastPerDay: 1000,
};

async function build(opts: {
  synthesizer?: Synthesizer | null;
  allowedChatIds?: number[];
  openAccess?: boolean;
  limits?: Partial<BotLimits>;
  limiter?: RateLimiter;
  maxMinutes?: number;
  feedback?: FeedbackInterpreter;
} = {}) {
  const transport = new FakeTransport();
  const query = new FakeQuery();
  const db = await createTestDb();
  const prefs = new DrizzleChatPreferencesRepo(db);
  const usage = new DrizzleUsageRepo(db);
  const clock = new FakeClock(0);
  const bot = new HorizonBot({
    transport,
    query,
    prefs,
    usage,
    clock,
    limiter: opts.limiter ?? new FixedWindowLimiter(1000, 60_000),
    limits: { ...GENEROUS, ...opts.limits },
    maxMinutes: opts.maxMinutes ?? 60,
    openAccess: opts.openAccess ?? true,
    synthesizer: opts.synthesizer === undefined ? audioSynth : opts.synthesizer,
    defaults: { minutes: 3 },
    ...(opts.feedback ? { feedback: opts.feedback } : {}),
    ...(opts.allowedChatIds ? { allowedChatIds: opts.allowedChatIds } : {}),
  });
  return { bot, transport, query, prefs, usage, clock };
}

/** A FeedbackInterpreter that returns a canned intent (the model is stubbed). */
function fakeInterpreter(intent: FeedbackIntent): FeedbackInterpreter {
  return new FakeLLM({ feedback: intent });
}

const update = (chatId: number, text: string): TelegramUpdate => ({
  updateId: 1,
  chatId,
  text,
});

describe('HorizonBot', () => {
  it('/brief uses the requested minutes and replies with the brief', async () => {
    const { bot, transport, query } = await build();
    await bot.handle(update(5, '/brief 7'));
    expect(query.lastRequest?.minutes).toBe(7);
    expect(transport.messages.at(-1)).toEqual({ chatId: 5, text: 'BRIEF[7]' });
  });

  it('/brief falls back to the chat default minutes, then config default', async () => {
    const { bot, query, prefs } = await build();
    await bot.handle(update(5, '/brief'));
    expect(query.lastRequest?.minutes).toBe(3); // config default

    await prefs.set(5, { defaultMinutes: 9 });
    await bot.handle(update(5, '/brief'));
    expect(query.lastRequest?.minutes).toBe(9); // chat default wins
  });

  it('/podcast sends an audio file when synthesis succeeds', async () => {
    const { bot, transport } = await build({ synthesizer: audioSynth });
    await bot.handle(update(5, '/podcast 20'));
    expect(transport.audios).toHaveLength(1);
    expect(transport.audios[0]?.audio).toEqual(Buffer.from([1, 2, 3]));
    expect(transport.messages).toHaveLength(0);
  });

  it('/podcast falls back to the text script when synthesis returns null', async () => {
    const { bot, transport } = await build({ synthesizer: nullSynth });
    await bot.handle(update(5, '/podcast'));
    expect(transport.audios).toHaveLength(0);
    expect(transport.messages.at(-1)?.text).toBe('SCRIPT[3]');
  });

  it('/outline canonicalizes the topic and queries it', async () => {
    const { bot, transport, query } = await build();
    await bot.handle(update(5, '/outline ai')); // lowercase
    expect(query.lastTopic).toBe('AI');
    expect(transport.messages.at(-1)?.text).toBe('OUTLINE[AI]');
  });

  it('/outline rejects an unknown topic without querying', async () => {
    const { bot, transport, query } = await build();
    await bot.handle(update(5, '/outline Weather'));
    expect(query.lastTopic).toBeUndefined();
    expect(transport.messages.at(-1)?.text).toMatch(/topic/i);
  });

  it('/prefs topics sets per-chat topics, then briefs use them', async () => {
    const { bot, query, prefs } = await build();
    await bot.handle(update(5, '/prefs topics AI, Politics, weather'));
    expect((await prefs.get(5))?.topics).toEqual(['AI', 'Politics']); // invalid dropped

    await bot.handle(update(5, '/brief'));
    expect(query.lastRequest?.topics).toEqual(['AI', 'Politics']);
  });

  it('ignores chats outside the allowlist', async () => {
    const { bot, transport } = await build({ allowedChatIds: [99] });
    await bot.handle(update(5, '/brief'));
    expect(transport.messages).toHaveLength(0);
    expect(transport.audios).toHaveLength(0);
  });

  it('replies with help for /start and unknown input', async () => {
    const { bot, transport } = await build();
    await bot.handle(update(5, '/start'));
    await bot.handle(update(5, 'gibberish'));
    expect(transport.messages).toHaveLength(2);
    expect(transport.messages[0]?.text).toMatch(/brief/i);
  });

  // --- Hardening (ADR-0022/0023) ---

  it('default-deny: ignores everyone when allowlist empty and openAccess false', async () => {
    const { bot, transport } = await build({ openAccess: false });
    await bot.handle(update(5, '/brief'));
    expect(transport.messages).toHaveLength(0);
  });

  it('ignores chats outside the allowlist even when openAccess is true', async () => {
    const { bot, transport } = await build({ allowedChatIds: [99], openAccess: true });
    await bot.handle(update(5, '/brief'));
    expect(transport.messages).toHaveLength(0);
  });

  it('burst limiter silently drops commands over the per-minute cap', async () => {
    const { bot, transport } = await build({ limiter: new FixedWindowLimiter(2, 60_000) });
    await bot.handle(update(5, '/brief'));
    await bot.handle(update(5, '/brief'));
    await bot.handle(update(5, '/brief')); // 3rd in window → dropped
    expect(transport.messages).toHaveLength(2);
  });

  it('per-chat daily podcast quota blocks after the cap, with one notice', async () => {
    const { bot, transport } = await build({ limits: { podcastPerDay: 1 } });
    await bot.handle(update(5, '/podcast'));
    await bot.handle(update(5, '/podcast')); // over quota
    await bot.handle(update(5, '/podcast')); // still over — no second notice

    expect(transport.audios).toHaveLength(1); // only the first delivered
    const notices = transport.messages.filter((m) => /podcast limit/i.test(m.text));
    expect(notices).toHaveLength(1); // notified exactly once
  });

  it('global podcast ceiling protects the bill across chats', async () => {
    const { bot, transport } = await build({ limits: { globalPodcastPerDay: 1 } });
    await bot.handle(update(5, '/podcast')); // chat 5: ok (global=1)
    await bot.handle(update(6, '/podcast')); // chat 6: global exceeded
    expect(transport.audios).toHaveLength(1);
  });

  it('clamps an oversized minutes request to maxMinutes', async () => {
    const { bot, query } = await build({ maxMinutes: 5 });
    await bot.handle(update(5, '/brief 100'));
    expect(query.lastRequest?.minutes).toBe(5);
  });

  describe('/feedback (ADR-0026)', () => {
    const intent: FeedbackIntent = {
      topics: [
        { topic: 'AI', direction: 'more' },
        { topic: 'Sports', direction: 'mute' },
      ],
      regions: [],
      length: 'shorter',
      summary: 'More AI, no Sports, shorter briefs.',
    };

    it('interprets feedback, persists weights + minutes, and confirms', async () => {
      const { bot, transport, prefs } = await build({ feedback: fakeInterpreter(intent) });

      await bot.handle(update(5, '/feedback love AI, hide sports, keep it short'));

      const saved = await prefs.get(5);
      expect(saved?.topicWeights?.AI).toBeGreaterThan(1); // boosted
      expect(saved?.topicWeights?.Sports).toBe(0); // muted
      expect(saved?.defaultMinutes).toBeLessThan(3); // "shorter" nudged below the default
      expect(transport.messages.at(-1)?.text).toContain('More AI, no Sports'); // the summary
    });

    it('feeds the saved weights into the next brief request', async () => {
      const { bot, query, prefs } = await build({ feedback: fakeInterpreter(intent) });
      await bot.handle(update(5, '/feedback more ai, mute sports'));

      await bot.handle(update(5, '/brief'));
      expect(query.lastRequest?.topicWeights?.AI).toBeGreaterThan(1);
      expect(query.lastRequest?.topicWeights?.Sports).toBe(0);
    });

    it('undo reverts to the pre-feedback state', async () => {
      const { bot, transport, prefs } = await build({ feedback: fakeInterpreter(intent) });
      await bot.handle(update(5, '/feedback more ai, mute sports'));
      expect((await prefs.get(5))?.topicWeights?.AI).toBeGreaterThan(1);

      await bot.handle(update(5, '/feedback undo'));
      const reverted = await prefs.get(5);
      expect(reverted?.topicWeights?.AI).toBeUndefined(); // back to neutral
      expect(transport.messages.at(-1)?.text).toMatch(/reverted/i);
    });

    it('undo with nothing to revert says so', async () => {
      const { bot, transport } = await build({ feedback: fakeInterpreter(intent) });
      await bot.handle(update(5, '/feedback undo'));
      expect(transport.messages.at(-1)?.text).toMatch(/nothing to undo/i);
    });

    it('an unmappable feedback changes nothing and says so', async () => {
      const empty: FeedbackIntent = { topics: [], regions: [], length: null, summary: '' };
      const { bot, transport, prefs } = await build({ feedback: fakeInterpreter(empty) });

      await bot.handle(update(5, '/feedback blah blah'));
      expect(await prefs.get(5)).toBeNull(); // nothing persisted
      expect(transport.messages.at(-1)?.text).toMatch(/couldn't map/i);
    });

    it('empty /feedback shows usage; with no interpreter wired it is unavailable', async () => {
      const withInterp = await build({ feedback: fakeInterpreter(intent) });
      await withInterp.bot.handle(update(5, '/feedback'));
      expect(withInterp.transport.messages.at(-1)?.text).toMatch(/tell me what to change/i);

      const noInterp = await build(); // feedback dep omitted
      await noInterp.bot.handle(update(5, '/feedback more ai'));
      expect(noInterp.transport.messages.at(-1)?.text).toMatch(/not available/i);
    });
  });
});
