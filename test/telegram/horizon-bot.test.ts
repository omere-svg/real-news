import { describe, expect, it } from 'vitest';
import { HorizonBot } from '../../src/telegram/horizon-bot.js';
import { createTestDb } from '../helpers/test-db.js';
import { DrizzleChatPreferencesRepo } from '../../src/db/chat-preferences-repo.js';
import type {
  SendAudioOptions,
  TelegramTransport,
  TelegramUpdate,
} from '../../src/telegram/telegram-transport.js';
import type { BriefRequest, QueryEngine } from '../../src/presentation/query-engine.js';
import type { Synthesizer } from '../../src/telegram/synthesizer.js';
import type { Topic } from '../../src/domain/types.js';

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

async function build(opts: {
  synthesizer?: Synthesizer | null;
  allowedChatIds?: number[];
} = {}) {
  const transport = new FakeTransport();
  const query = new FakeQuery();
  const prefs = new DrizzleChatPreferencesRepo(await createTestDb());
  const bot = new HorizonBot({
    transport,
    query,
    prefs,
    synthesizer: opts.synthesizer === undefined ? audioSynth : opts.synthesizer,
    defaults: { minutes: 3 },
    ...(opts.allowedChatIds ? { allowedChatIds: opts.allowedChatIds } : {}),
  });
  return { bot, transport, query, prefs };
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
});
