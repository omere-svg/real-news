import { describe, expect, it } from 'vitest';
import {
  HorizonBot,
  type BotLimits,
  type StoryReader,
  type WebLinker,
} from '../../src/telegram/horizon-bot.js';
import type { ClaimResult } from '../../src/db/web-auth-repo.js';
import { FixedWindowLimiter, type RateLimiter } from '../../src/telegram/rate-limiter.js';
import { createTestDb } from '../helpers/test-db.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { DrizzleChatPreferencesRepo } from '../../src/db/chat-preferences-repo.js';
import { DrizzleUsageRepo } from '../../src/db/usage-repo.js';
import type {
  SendAudioOptions,
  SendMessageOptions,
  TelegramTransport,
  TelegramUpdate,
} from '../../src/telegram/telegram-transport.js';
import type { BriefRequest, QueryEngine } from '../../src/presentation/query-engine.js';
import type { Synthesizer } from '../../src/telegram/synthesizer.js';
import type { Story, Topic } from '../../src/domain/types.js';
import { FakeLLM } from '../helpers/fake-llm.js';
import type {
  Discussant,
  DiscussResult,
  FeedbackInterpreter,
  FeedbackIntent,
  IntentRouter,
  PreferencesInterpreter,
  PrefsPatch,
  RouterIntent,
} from '../../src/llm/llm-client.js';
import type { WebSearch, WebResult } from '../../src/web/web-search.js';
import type { Embedder } from '../../src/embedding/embedder.js';
import { FakeEmbedder } from '../helpers/fake-embedder.js';
import type { SemanticQuery } from '../../src/db/story-repo.js';

class FakeTransport implements TelegramTransport {
  readonly messages: { chatId: number; text: string; opts?: SendMessageOptions }[] = [];
  readonly audios: { chatId: number; audio: Buffer; opts: SendAudioOptions | undefined }[] = [];
  readonly acked: string[] = [];
  async sendMessage(chatId: number, text: string, opts?: SendMessageOptions): Promise<void> {
    this.messages.push({ chatId, text, ...(opts ? { opts } : {}) });
  }
  async sendAudio(chatId: number, audio: Buffer, opts?: SendAudioOptions): Promise<void> {
    this.audios.push({ chatId, audio, opts });
  }
  async getUpdates(): Promise<{ updates: TelegramUpdate[] }> {
    return { updates: [] };
  }
  async answerCallback(id: string): Promise<void> {
    this.acked.push(id);
  }
}

/** A minimal StoryReader returning canned stories for chat grounding. */
function storyReaderOf(stories: Story[]): StoryReader {
  return { topStories: async () => stories };
}

function makeStory(over: Partial<Story> = {}): Story {
  return {
    id: 's',
    title: 'A story',
    url: null,
    topic: 'AI',
    significance: 5,
    summary: null,
    whyItMatters: null,
    scoreBreakdown: null,
    memberRefs: [],
    firstSeenAt: 0,
    updatedAt: 0,
    ...over,
  };
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

/** A WebLinker that records claims and returns a configured result (ADR-0040). */
class FakeWebLink implements WebLinker {
  readonly calls: { code: string; chatId: number; name: string | null }[] = [];
  constructor(private readonly result: ClaimResult = 'linked') {}
  async claim(code: string, chatId: number, name: string | null): Promise<ClaimResult> {
    this.calls.push({ code, chatId, name });
    return this.result;
  }
}

const GENEROUS: BotLimits = {
  perMinute: 1000,
  podcastPerDay: 1000,
  commandsPerDay: 1000,
  globalPodcastPerDay: 1000,
  globalCommandsPerDay: 1000,
};

async function build(opts: {
  synthesizer?: Synthesizer | null;
  allowedChatIds?: number[];
  openAccess?: boolean;
  limits?: Partial<BotLimits>;
  limiter?: RateLimiter;
  maxMinutes?: number;
  maxPodcastMinutes?: number;
  feedback?: FeedbackInterpreter;
  discussant?: Discussant;
  storyRepo?: StoryReader;
  webSearch?: WebSearch;
  router?: IntentRouter;
  prefsInterpreter?: PreferencesInterpreter;
  webLink?: WebLinker;
  embedder?: Embedder;
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
    maxPodcastMinutes: opts.maxPodcastMinutes ?? 20,
    openAccess: opts.openAccess ?? true,
    synthesizer: opts.synthesizer === undefined ? audioSynth : opts.synthesizer,
    defaults: { minutes: 3 },
    ...(opts.feedback ? { feedback: opts.feedback } : {}),
    ...(opts.discussant ? { discussant: opts.discussant } : {}),
    ...(opts.storyRepo ? { storyRepo: opts.storyRepo } : {}),
    ...(opts.webSearch ? { webSearch: opts.webSearch } : {}),
    ...(opts.router ? { router: opts.router } : {}),
    ...(opts.prefsInterpreter ? { prefsInterpreter: opts.prefsInterpreter } : {}),
    ...(opts.allowedChatIds ? { allowedChatIds: opts.allowedChatIds } : {}),
    ...(opts.webLink ? { webLink: opts.webLink } : {}),
    ...(opts.embedder ? { embedder: opts.embedder } : {}),
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

  it('evicts idle in-memory sessions so open access cannot grow the map forever (ADR-0050)', async () => {
    const { bot, clock } = await build();
    const sessions = (bot as unknown as { sessions: Map<number, unknown> }).sessions;
    await bot.handle(update(1, '/brief'));
    expect(sessions.has(1)).toBe(true);
    // 7 hours later (past the 6h TTL) a different chat arrives → chat 1 is swept.
    clock.advance(7 * 3600_000);
    await bot.handle(update(2, '/brief'));
    expect(sessions.has(1)).toBe(false);
    expect(sessions.has(2)).toBe(true);
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

  it('/prefs always shows a concrete brief length, never a blank default', async () => {
    const { bot, transport } = await build(); // defaults.minutes = 3, no prefs set
    await bot.handle(update(5, '/prefs'));
    const text = transport.messages.at(-1)?.text ?? '';
    expect(text).toMatch(/Brief length: 3 min \(default\)/);
    expect(text).not.toMatch(/\(default\) min/); // the bug: no number before "min"
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
    const notices = transport.messages.filter((m) => /podcast allowance/i.test(m.text));
    expect(notices).toHaveLength(1); // notified exactly once
  });

  it('global podcast ceiling protects the bill across chats', async () => {
    const { bot, transport } = await build({ limits: { globalPodcastPerDay: 1 } });
    await bot.handle(update(5, '/podcast')); // chat 5: ok (global=1)
    await bot.handle(update(6, '/podcast')); // chat 6: global exceeded
    expect(transport.audios).toHaveLength(1);
  });

  it('global daily command ceiling caps total spend across all chats (open-access bill guard)', async () => {
    const { bot, transport } = await build({ limits: { globalCommandsPerDay: 1 } });
    await bot.handle(update(5, '/brief')); // chat 5: ok (global cmd = 1)
    await bot.handle(update(6, '/brief')); // chat 6: global cmd exceeded → blocked
    await bot.handle(update(7, '/brief')); // chat 7: still over — no second notice

    const notices = transport.messages.filter((m) => /across all readers/i.test(m.text));
    expect(notices).toHaveLength(1); // notified exactly once, then silent
    expect(notices[0]?.chatId).toBe(6);
  });

  it('clamps an oversized minutes request to maxMinutes', async () => {
    const { bot, query } = await build({ maxMinutes: 5 });
    await bot.handle(update(5, '/brief 100'));
    expect(query.lastRequest?.minutes).toBe(5);
  });

  it('clamps a podcast to maxPodcastMinutes, tighter than the brief cap', async () => {
    const { bot, query } = await build({ maxMinutes: 60, maxPodcastMinutes: 20 });

    await bot.handle(update(5, '/podcast 45')); // over the podcast cap
    expect(query.lastRequest?.minutes).toBe(20); // clamped to maxPodcastMinutes

    await bot.handle(update(5, '/brief 45')); // a brief still gets the looser cap
    expect(query.lastRequest?.minutes).toBe(45);
  });

  describe('/feedback (ADR-0026)', () => {
    const intent: FeedbackIntent = {
      topics: [
        { topic: 'AI', direction: 'more' },
        { topic: 'Sports', direction: 'mute' },
      ],
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
      const empty: FeedbackIntent = { topics: [], length: null, summary: '' };
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

  // --- Per-chat memory (ADR-0028) ---

  describe('/remember and /forget', () => {
    it('saves, appends, shows in /prefs, and clears memory', async () => {
      const { bot, transport, prefs } = await build();

      await bot.handle(update(5, '/remember I trade commodities'));
      expect((await prefs.get(5))?.memory).toBe('I trade commodities');

      await bot.handle(update(5, '/remember and follow shipping'));
      expect((await prefs.get(5))?.memory).toBe('I trade commodities\nand follow shipping');

      await bot.handle(update(5, '/prefs'));
      expect(transport.messages.at(-1)?.text).toMatch(/Remembered: I trade commodities; and follow shipping/);

      await bot.handle(update(5, '/forget'));
      expect((await prefs.get(5))?.memory).toBeUndefined();
      expect(transport.messages.at(-1)?.text).toMatch(/cleared/i);
    });

    it('empty /remember shows usage', async () => {
      const { bot, transport } = await build();
      await bot.handle(update(5, '/remember'));
      expect(transport.messages.at(-1)?.text).toMatch(/usage/i);
    });

    it('/remember is a free command — works even past the daily command quota (ADR-0049)', async () => {
      const { bot, prefs } = await build({ limits: { commandsPerDay: 0 } });
      await bot.handle(update(5, '/remember I trade commodities'));
      expect((await prefs.get(5))?.memory).toBe('I trade commodities'); // not blocked
    });

    it('passes the saved memory into the podcast request (ADR-0028)', async () => {
      const { bot, query, prefs } = await build({ synthesizer: nullSynth });
      await prefs.set(5, { memory: 'I care about shipping.' });
      await bot.handle(update(5, '/podcast'));
      expect(query.lastRequest?.memory).toBe('I care about shipping.');
    });
  });

  // --- Chat about the news (ADR-0029) ---

  describe('chat mode', () => {
    const callback = (chatId: number, data: string): TelegramUpdate => ({
      updateId: 1,
      chatId,
      text: '',
      callbackData: data,
      callbackQueryId: 'cq1',
    });

    function chatBuild(over: Parameters<typeof build>[0] = {}) {
      return build({
        discussant: new FakeLLM(),
        storyRepo: storyReaderOf([makeStory({ title: 'Cache story', significance: 7 })]),
        ...over,
      });
    }

    it('plain text is help before a brief, but a question after one (ADR-0029)', async () => {
      const { bot, transport } = await chatBuild();

      await bot.handle(update(5, 'what is happening?')); // idle ⇒ help
      expect(transport.messages.at(-1)?.text).toMatch(/brief/i);

      await bot.handle(update(5, '/brief')); // arms chat mode
      await bot.handle(update(5, 'what is happening?')); // now a question
      expect(transport.messages.at(-1)?.text).toContain('Answer to: what is happening?');
    });

    it('/chat answers immediately and grounds in cache stories', async () => {
      const llm = new FakeLLM();
      const { bot, transport } = await chatBuild({ discussant: llm });
      await bot.handle(update(5, '/chat tell me about AI'));
      expect(transport.messages.at(-1)?.text).toContain('Answer to: tell me about AI');
      expect(llm.lastDiscuss?.stories[0]?.title).toBe('Cache story');
    });

    it('grounds chat on semantically-relevant stories when an embedder is wired (ADR-0045)', async () => {
      const semanticCalls: SemanticQuery[] = [];
      let topCalls = 0;
      const reader: StoryReader = {
        topStories: async () => {
          topCalls += 1;
          return [makeStory({ title: 'By significance', significance: 9 })];
        },
        semanticSearch: async (q) => {
          semanticCalls.push(q);
          return [makeStory({ title: 'Semantically relevant', significance: 2 })];
        },
      };
      const embedder = new FakeEmbedder({ 'tell me about AI': [1, 0, 0] });
      const llm = new FakeLLM();
      const { bot } = await chatBuild({ discussant: llm, storyRepo: reader, embedder });

      await bot.handle(update(5, '/chat tell me about AI'));

      expect(semanticCalls).toHaveLength(1);
      expect(semanticCalls[0]?.vector).toEqual([1, 0, 0]);
      expect(topCalls).toBe(0); // semantic path used, not significance
      expect(llm.lastDiscuss?.stories[0]?.title).toBe('Semantically relevant');
    });

    it('falls back to top-by-significance when the embedding is empty (ADR-0045)', async () => {
      let topCalls = 0;
      const reader: StoryReader = {
        topStories: async () => {
          topCalls += 1;
          return [makeStory({ title: 'By significance' })];
        },
        semanticSearch: async () => {
          throw new Error('should not be reached with an empty embedding');
        },
      };
      // Unknown text ⇒ FakeEmbedder returns a zero vector; the bot must fall back.
      const embedder = new FakeEmbedder({});
      const llm = new FakeLLM();
      const { bot } = await chatBuild({ discussant: llm, storyRepo: reader, embedder });

      await bot.handle(update(5, '/chat something'));
      expect(topCalls).toBe(1);
      expect(llm.lastDiscuss?.stories[0]?.title).toBe('By significance');
    });

    it('escalates to web search only when the cache cannot answer (ADR-0029)', async () => {
      const fromNews: DiscussResult = { answer: 'cache answer', answeredFromNews: true };
      const notInNews: DiscussResult = { answer: 'I need to look that up', answeredFromNews: false };
      const webAnswer: DiscussResult = { answer: 'web answer', answeredFromNews: true };

      const web: WebResult[] = [{ title: 'Hit', url: 'https://x', snippet: 'fresh' }];
      const searched: string[] = [];
      const webSearch: WebSearch = {
        search: async (q) => {
          searched.push(q);
          return web;
        },
      };

      // Case 1: cache answers ⇒ no web search.
      {
        const { bot, transport } = await chatBuild({
          discussant: new FakeLLM({ discuss: fromNews }),
          webSearch,
        });
        await bot.handle(update(5, '/chat in the cache?'));
        expect(searched).toHaveLength(0);
        expect(transport.messages.at(-1)?.text).toContain('cache answer');
      }

      // Case 2: cache can't ⇒ web search, then a second discuss pass with web context.
      {
        let calls = 0;
        const llm = new FakeLLM({
          discuss: (input) => {
            calls += 1;
            return input.web ? webAnswer : notInNews;
          },
        });
        const { bot, transport } = await chatBuild({ discussant: llm, webSearch });
        await bot.handle(update(5, '/chat what is the latest?'));
        expect(searched).toContain('what is the latest?');
        expect(calls).toBe(2); // first pass (cache) + second pass (web)
        expect(transport.messages.at(-1)?.text).toContain('web answer');
        expect(transport.messages.at(-1)?.text).toMatch(/web search/i); // provenance note
      }
    });

    it('weaves remembered context into the chat prompt (ADR-0028)', async () => {
      const llm = new FakeLLM();
      const { bot, prefs } = await chatBuild({ discussant: llm });
      await prefs.set(5, { memory: 'I run a port in Haifa.' });
      await bot.handle(update(5, '/chat any shipping news?'));
      expect(llm.lastDiscuss?.memory).toBe('I run a port in Haifa.');
    });

    it('the feedback button parks the chat, then the next message tunes prefs', async () => {
      const intent: FeedbackIntent = {
        topics: [{ topic: 'AI', direction: 'more' }],
        length: null,
        summary: 'More AI.',
      };
      const { bot, transport, prefs } = await chatBuild({ feedback: fakeInterpreter(intent) });

      await bot.handle(update(5, '/brief')); // arms chat, attaches feedback button
      const briefMsg = transport.messages.at(-1);
      expect(briefMsg?.opts?.buttons?.[0]?.data).toBe('fb'); // button present

      await bot.handle(callback(5, 'fb')); // tap → awaiting feedback
      expect(transport.acked).toContain('cq1');
      expect(transport.messages.at(-1)?.text).toMatch(/what to change/i);

      await bot.handle(update(5, 'more ai please')); // plain text now = feedback
      expect((await prefs.get(5))?.topicWeights?.AI).toBeGreaterThan(1);

      await bot.handle(update(5, 'and what else happened?')); // back to chat mode
      expect(transport.messages.at(-1)?.text).toContain('Answer to: and what else happened?');
    });
  });

  // --- Natural-language routing + buttons (ADR-0030) ---

  describe('natural-language routing', () => {
    const intentRouter = (intent: RouterIntent): IntentRouter => new FakeLLM({ route: intent });
    const help = (): RouterIntent => ({ action: 'help', minutes: null, topic: null });

    it('routes a plain-text request to a brief with the asked-for minutes', async () => {
      const router = intentRouter({ action: 'brief', minutes: 8, topic: null });
      const { bot, query, transport } = await build({ router });

      await bot.handle(update(5, 'can I get a quick 8 minute catch-up?'));
      expect(query.lastRequest?.minutes).toBe(8);
      expect(transport.messages.at(-1)?.text).toBe('BRIEF[8]');
    });

    it('routes a plain-text topic request to an outline', async () => {
      const router = intentRouter({ action: 'outline', minutes: null, topic: 'AI' });
      const { bot, query } = await build({ router });

      await bot.handle(update(5, 'tell me everything about AI today'));
      expect(query.lastTopic).toBe('AI');
    });

    it('routes a plain-text question to chat when chat is wired', async () => {
      const router = intentRouter({ action: 'question', minutes: null, topic: null });
      const { bot, transport } = await build({
        router,
        discussant: new FakeLLM(),
        storyRepo: storyReaderOf([makeStory()]),
      });

      await bot.handle(update(5, 'what happened with the merger?'));
      expect(transport.messages.at(-1)?.text).toContain('Answer to: what happened with the merger?');
    });

    it('routes plain-text feedback, reusing the raw message as the tuning text', async () => {
      const intent: FeedbackIntent = {
        topics: [{ topic: 'AI', direction: 'more' }],
        length: null,
        summary: 'More AI.',
      };
      const router = intentRouter({ action: 'feedback', minutes: null, topic: null });
      const { bot, prefs } = await build({ router, feedback: fakeInterpreter(intent) });

      await bot.handle(update(5, 'show me a lot more AI please'));
      expect((await prefs.get(5))?.topicWeights?.AI).toBeGreaterThan(1);
    });

    it('routes a plain-text "remember" to memory', async () => {
      const router = intentRouter({ action: 'remember', minutes: null, topic: null });
      const { bot, prefs } = await build({ router });

      await bot.handle(update(5, 'remember I trade commodities'));
      expect((await prefs.get(5))?.memory).toBe('remember I trade commodities');
    });

    it('shows the menu (with action buttons) for a routed help intent', async () => {
      const { bot, transport } = await build({ router: intentRouter(help()) });

      await bot.handle(update(5, 'hey there, what is this?'));
      const last = transport.messages.at(-1);
      expect(last?.text).toMatch(/Horizon/);
      expect(last?.opts?.buttons?.map((b) => b.data)).toEqual([
        'brief',
        'podcast',
        'topics',
        'prefs',
      ]);
    });

    it('slash commands still win over the router (power-user shortcut)', async () => {
      const router = intentRouter({ action: 'podcast', minutes: null, topic: null });
      const fake = router as FakeLLM;
      const { bot, query } = await build({ router });

      await bot.handle(update(5, '/brief 4'));
      expect(query.lastRequest?.minutes).toBe(4);
      expect(fake.routeCalls).toBe(0); // a slash command never hits the router
    });

    it('does NOT spend the router LLM once the daily command quota is exhausted (ADR-0049)', async () => {
      const router = intentRouter({ action: 'brief', minutes: null, topic: null });
      const fake = router as FakeLLM;
      const { bot, transport } = await build({ router, limits: { commandsPerDay: 1 } });

      await bot.handle(update(5, 'give me the news')); // 1st: allowed, routes
      const callsAfterFirst = fake.routeCalls;
      await bot.handle(update(5, 'and again please')); // 2nd: over quota
      expect(fake.routeCalls).toBe(callsAfterFirst); // router NOT called again
      expect(transport.messages.at(-1)?.text).toMatch(/limit/i);
    });

    it('attaches the menu button under generated content when routing is on', async () => {
      const { bot, transport } = await build({ router: intentRouter(help()) });
      await bot.handle(update(5, '/brief'));
      expect(transport.messages.at(-1)?.opts?.buttons?.map((b) => b.data)).toContain('menu');
    });

    it('routes "reset my preferences" to an actual clear (ADR-0030)', async () => {
      const router = intentRouter({ action: 'clearPrefs', minutes: null, topic: null });
      const { bot, prefs } = await build({ router });
      await prefs.set(5, { topics: ['AI'] });

      await bot.handle(update(5, 'can you reset my preferences?'));
      expect(await prefs.get(5)).toBeNull(); // actually cleared, not just shown
    });

    it('adds a topic and sets the budget from one plain-text request (ADR-0030)', async () => {
      const router = intentRouter({ action: 'setPrefs', minutes: null, topic: null });
      const patch: PrefsPatch = {
        topics: { mode: 'add', values: ['Politics'] },
        minutes: 5,
        summary: 'Added Politics and set your budget to 5 min.',
      };
      const { bot, prefs, transport } = await build({
        router,
        prefsInterpreter: new FakeLLM({ prefs: patch }),
      });
      await prefs.set(5, { topics: ['AI'] });

      await bot.handle(update(5, 'add politics and change it to 5 min'));
      const saved = await prefs.get(5);
      expect(saved?.topics).toEqual(['AI', 'Politics']); // merged, not replaced
      expect(saved?.defaultMinutes).toBe(5);
      expect(transport.messages.at(-1)?.text).toMatch(/Politics/);
    });

    it('replaces topics for an "only X" request, dropping invalid values', async () => {
      const router = intentRouter({ action: 'setPrefs', minutes: null, topic: null });
      const patch: PrefsPatch = {
        topics: { mode: 'replace', values: ['AI', 'Weather'] }, // Weather is not a Topic
        minutes: null,
        summary: 'Now showing only AI.',
      };
      const { bot, prefs } = await build({
        router,
        prefsInterpreter: new FakeLLM({ prefs: patch }),
      });
      await prefs.set(5, { topics: ['Sports', 'Business'] });

      await bot.handle(update(5, 'only show me AI'));
      expect((await prefs.get(5))?.topics).toEqual(['AI']);
    });

    it('says so when a preference change maps to nothing valid', async () => {
      const router = intentRouter({ action: 'setPrefs', minutes: null, topic: null });
      const patch: PrefsPatch = {
        topics: { mode: 'add', values: ['Weather'] }, // nothing valid
        minutes: null,
        summary: '',
      };
      const { bot, prefs, transport } = await build({
        router,
        prefsInterpreter: new FakeLLM({ prefs: patch }),
      });

      await bot.handle(update(5, 'follow the weather'));
      expect(await prefs.get(5)).toBeNull(); // nothing persisted
      expect(transport.messages.at(-1)?.text).toMatch(/couldn't tell what to change/i);
    });
  });

  describe('tap-to-run buttons (ADR-0030)', () => {
    const callback = (chatId: number, data: string): TelegramUpdate => ({
      updateId: 1,
      chatId,
      text: '',
      callbackData: data,
      callbackQueryId: 'cq1',
    });
    const router: IntentRouter = new FakeLLM({ route: { action: 'help', minutes: null, topic: null } });

    it('a Brief button tap runs a brief and is acknowledged', async () => {
      const { bot, query, transport } = await build({ router });
      await bot.handle(callback(5, 'brief'));
      expect(query.lastRequest).toBeDefined();
      expect(transport.acked).toContain('cq1');
    });

    it('a Podcast button tap draws the podcast quota like a typed command', async () => {
      const { bot, transport } = await build({ router, limits: { podcastPerDay: 1 } });
      await bot.handle(callback(5, 'podcast'));
      await bot.handle(callback(5, 'podcast')); // over quota
      expect(transport.audios).toHaveLength(1);
      const notices = transport.messages.filter((m) => /podcast allowance/i.test(m.text));
      expect(notices).toHaveLength(1);
    });

    it('the By-topic button opens a topic picker, and a topic button runs its outline', async () => {
      const { bot, query, transport } = await build({ router });

      await bot.handle(callback(5, 'topics'));
      const picker = transport.messages.at(-1);
      expect(picker?.text).toMatch(/topic/i);
      const aiButton = picker?.opts?.buttons?.find((b) => b.data === 'outline:AI');
      expect(aiButton).toBeDefined();

      await bot.handle(callback(5, aiButton!.data));
      expect(query.lastTopic).toBe('AI');
    });

    it('the Menu button reopens the main menu without drawing quota', async () => {
      const { bot, transport } = await build({ router, limits: { commandsPerDay: 1 } });
      await bot.handle(callback(5, 'menu'));
      await bot.handle(callback(5, 'menu')); // navigation is free — still answered
      expect(transport.messages.filter((m) => /Horizon/.test(m.text)).length).toBe(2);
    });
  });

  describe('web pairing (ADR-0040)', () => {
    it('/link <code> claims the code for this chat and confirms', async () => {
      const webLink = new FakeWebLink('linked');
      const { bot, transport } = await build({ webLink });
      await bot.handle({ updateId: 1, chatId: 5, text: '/link ABC123', senderName: 'Omer' });
      expect(webLink.calls).toEqual([{ code: 'ABC123', chatId: 5, name: 'Omer' }]);
      expect(transport.messages.at(-1)?.text).toMatch(/Connected/i);
    });

    it('a t.me deep link (/start link_<code>) routes to pairing', async () => {
      const webLink = new FakeWebLink('linked');
      const { bot } = await build({ webLink });
      await bot.handle({ updateId: 1, chatId: 5, text: '/start link_XYZ789' });
      expect(webLink.calls).toEqual([{ code: 'XYZ789', chatId: 5, name: null }]);
    });

    it('a bare /start still shows the menu (no pairing)', async () => {
      const webLink = new FakeWebLink('linked');
      const { bot, transport } = await build({ webLink });
      await bot.handle(update(5, '/start'));
      expect(webLink.calls).toHaveLength(0);
      expect(transport.messages.at(-1)?.text).toMatch(/Horizon/);
    });

    it('reports an expired code', async () => {
      const { bot, transport } = await build({ webLink: new FakeWebLink('expired') });
      await bot.handle(update(5, '/link OLD'));
      expect(transport.messages.at(-1)?.text).toMatch(/expired/i);
    });

    it('reports an unrecognized code', async () => {
      const { bot, transport } = await build({ webLink: new FakeWebLink('unknown') });
      await bot.handle(update(5, '/link NOPE'));
      expect(transport.messages.at(-1)?.text).toMatch(/recognize/i);
    });

    it('when web linking is not wired, /link says it is unavailable', async () => {
      const { bot, transport } = await build();
      await bot.handle(update(5, '/link ABC'));
      expect(transport.messages.at(-1)?.text).toMatch(/not available/i);
    });
  });
});
