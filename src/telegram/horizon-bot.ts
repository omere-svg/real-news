import { parseCommand, type Command, type PrefsField } from './command.js';
import type { InlineButton, TelegramTransport, TelegramUpdate } from './telegram-transport.js';
import type { Synthesizer } from './synthesizer.js';
import type { RateLimiter } from './rate-limiter.js';
import type {
  ChatPreferencesRepo,
  ChatPreferences,
  PreviousPreferences,
} from '../db/chat-preferences-repo.js';
import type { StoryRepo } from '../db/story-repo.js';
import { utcDay, type UsageRepo } from '../db/usage-repo.js';
import type { WebAuthRepo } from '../db/web-auth-repo.js';
import type { Embedder } from '../embedding/embedder.js';
import type { Clock } from '../scheduler/clock.js';
import type { BriefRequest, QueryEngine } from '../presentation/query-engine.js';
import type { PresentationDefaults } from '../server/app.js';
import type {
  ConversationTurn,
  Discussant,
  FeedbackInterpreter,
  IntentRouter,
  PreferencesInterpreter,
  PrefsListChange,
  StoryContext,
} from '../llm/llm-client.js';
import type { WebSearch } from '../web/web-search.js';
import { applyFeedback, type PreferenceProfile } from '../preferences/feedback.js';
import { normalizeMinutes } from '../presentation/minutes.js';
import { TOPICS, type Topic } from '../domain/types.js';
import { canonical } from '../domain/vocab.js';

/**
 * The slice of the Story store the chat feature reads for grounding (ADR-0029).
 * `semanticSearch` is optional: when it AND an `embedder` are wired, chat grounds
 * on the Stories most *semantically* similar to the question (ADR-0045); otherwise
 * it falls back to the reader's top Stories by significance.
 */
export type StoryReader = Pick<StoryRepo, 'topStories'> &
  Partial<Pick<StoryRepo, 'semanticSearch'>>;

/** The slice of the web-auth store the bot needs to claim a pairing code (ADR-0040). */
export type WebLinker = Pick<WebAuthRepo, 'claim'>;

/**
 * Per-chat conversational state (ADR-0028/0029), held in memory. `idle` is the
 * pre-brief default (plain text ⇒ help); after a brief the chat enters `chat`
 * (plain text ⇒ questions about the news); the feedback button parks it in
 * `feedback` for one message (the next plain text ⇒ tuning).
 */
interface ChatSession {
  mode: 'idle' | 'chat' | 'feedback';
  history: ConversationTurn[];
  /** Last time this chat sent anything — for evicting idle sessions (ADR-0050). */
  lastSeen: number;
}

/** How many prior turns to carry as conversation context. */
const MAX_HISTORY_TURNS = 6;
/** Evict a chat's in-memory session after this much inactivity; under open access
 * every stranger's chat id would otherwise accumulate forever (ADR-0050). */
const SESSION_TTL_MS = 6 * 3600_000;
/**
 * Minimum cosine similarity for a Story to count as relevant chat grounding
 * (ADR-0047). Without a floor, semantic search always returns its top-k even
 * when nothing is actually about the question, so the model gets fed unrelated
 * stories and answers from noise. Below the floor we fall back to top-by-
 * significance (a sensible "here's today's news" default).
 */
const CHAT_MIN_SIMILARITY = 0.35;
/** Cap on stored memory length, to bound the prompt it's injected into. */
const MAX_MEMORY_CHARS = 2000;
/** The inline button that opens the per-answer feedback flow (ADR-0028). */
const FEEDBACK_BUTTON = { text: '✍️ Give feedback', data: 'fb' } as const;
/** The inline button that reopens the main menu (ADR-0030). */
const MENU_BUTTON = { text: '☰ Menu', data: 'menu' } as const;
/** The main menu: tap-to-run actions so no slash command is needed (ADR-0030). */
const MENU_BUTTONS = [
  { text: '📰 Brief', data: 'brief' },
  { text: '🎧 Podcast', data: 'podcast' },
  { text: '🔎 By topic', data: 'topics' },
  { text: '⚙️ Preferences', data: 'prefs' },
] as const;

/**
 * The Telegram bot dispatcher (ADR-0019) — a deep Presentation adapter. Maps a
 * chat command + the chat's preferences onto a BriefRequest, runs it through the
 * read-only QueryEngine, and sends the result (text, or synthesized audio for
 * podcasts). No network or model code lives here; everything is behind seams and
 * tested with fakes.
 */
/** Rate-limit + cost-quota knobs (ADR-0022). */
export interface BotLimits {
  readonly perMinute: number;
  readonly podcastPerDay: number;
  readonly commandsPerDay: number;
  readonly globalPodcastPerDay: number;
  /** Process-wide command ceiling per UTC day — the total-cost backstop (ADR-0031). */
  readonly globalCommandsPerDay: number;
}

export interface HorizonBotDeps {
  readonly transport: TelegramTransport;
  readonly query: QueryEngine;
  readonly prefs: ChatPreferencesRepo;
  /** Interprets free-text feedback into preference changes (ADR-0026); omit to disable. */
  readonly feedback?: FeedbackInterpreter;
  /** Routes plain-text messages to an action (ADR-0030); omit for slash-only. */
  readonly router?: IntentRouter;
  /** Interprets plain-language preference edits (ADR-0030); omit to disable. */
  readonly prefsInterpreter?: PreferencesInterpreter;
  /** Answers chat questions grounded in the cache (ADR-0029); omit to disable chat. */
  readonly discussant?: Discussant;
  /** Reads Stories from the cache as chat grounding (ADR-0029); required for chat. */
  readonly storyRepo?: StoryReader;
  /**
   * Embeds a chat question for semantic retrieval over `story_vectors` (ADR-0045);
   * omit to ground chat on top-by-significance Stories instead. Needs a
   * `semanticSearch`-capable `storyRepo` to take effect.
   */
  readonly embedder?: Embedder;
  /** Live web fallback when the cache can't answer (ADR-0029); omit to stay cache-only. */
  readonly webSearch?: WebSearch;
  /** Claims web pairing codes to link a web session to this chat (ADR-0040); omit to disable. */
  readonly webLink?: WebLinker;
  /** TTS for podcast audio; null sends the script as text (ADR-0020). */
  readonly synthesizer: Synthesizer | null;
  /** Config-driven fallback when a chat has set nothing (ADR-0015). */
  readonly defaults: PresentationDefaults;
  /** Burst limiter (ADR-0022). */
  readonly limiter: RateLimiter;
  /** Durable daily cost-quota counters (ADR-0022). */
  readonly usage: UsageRepo;
  readonly clock: Clock;
  readonly limits: BotLimits;
  /** Hard cap on requested minutes (ADR-0023). */
  readonly maxMinutes: number;
  /** Tighter cap for the podcast (TTS) path (ADR-0023). */
  readonly maxPodcastMinutes: number;
  /** Chat ids the bot answers; empty defers to `openAccess` (ADR-0022). */
  readonly allowedChatIds?: readonly number[];
  /** Answer everyone when the allowlist is empty. Default-deny when false. */
  readonly openAccess: boolean;
}

const LIMIT_MSG = {
  commands:
    'You’ve hit today’s limit for briefs and questions — it resets at midnight UTC. ' +
    'Menus and preferences still work in the meantime.',
  podcast:
    'You’ve used today’s podcast allowance — it resets at midnight UTC. A text brief is ' +
    'still free anytime: /brief.',
  global:
    'The podcast service is busy right now (lots of listeners). Please try again shortly — ' +
    'a text brief works instantly: /brief.',
  globalCommands:
    'Horizon has reached its daily total across all readers — it resets at midnight UTC. ' +
    'Thanks for your patience.',
} as const;

/** Followable topics, newest-vocabulary order, minus the `Other` catch-all. */
const FOLLOWABLE_TOPICS = TOPICS.filter((t) => t !== 'Other').join(' · ');

const HELP = [
  '🌅 Horizon — your world, already read.',
  '',
  'I read thousands of items from official news APIs every few minutes and keep only ' +
    'what matters — scored, de-duplicated, and explained. Ask in plain English, or use a command:',
  '',
  '📰  A brief, sized to your time',
  '      “give me a 5-minute brief on AI”  ·  /brief 5',
  '🔎  A deep dive on one topic',
  '      “what’s happening in Israel?”  ·  /outline Israel',
  '🎧  A narrated podcast episode',
  '      “make me a 3-minute podcast”  ·  /podcast 3',
  '💬  Ask about the news',
  '      “why did markets drop today?”',
  '🎛  Tune it to you',
  '      “more AI, less sports, keep it short”  ·  /prefs',
  '🧠  Remember you',
  '      “remember I’m a backend dev in Tel Aviv”  ·  /forget',
  '',
  `I follow: ${FOLLOWABLE_TOPICS}`,
  '',
  'Tap a button to start 👇',
].join('\n');

export class HorizonBot {
  /** Per-chat conversational state (ADR-0028/0029). In-memory; transient by design. */
  private readonly sessions = new Map<number, ChatSession>();

  constructor(private readonly deps: HorizonBotDeps) {}

  async handle(update: TelegramUpdate): Promise<void> {
    const { chatId } = update;
    if (!this.allowed(chatId)) return; // default-deny (ADR-0022)

    const now = this.deps.clock.now();
    // Burst limit: silently drop, so spamming earns no reply and can't block the loop.
    if (!this.deps.limiter.allow(`burst:${chatId}`, now)) return;

    // Inline button taps (ADR-0028/0030): menu navigation and tap-to-run actions.
    if (update.callbackData !== undefined) return this.handleCallback(chatId, update, now);

    const session = this.session(chatId, now);
    const awaitingFeedback = session.mode === 'feedback';

    // Routing plain text is itself a cheap-tier LLM call. If the chat (or the
    // whole process) is already over the daily command budget, refuse BEFORE
    // spending the model — otherwise the global cap that makes open access safe
    // is bypassed one route call at a time (ADR-0049). Slash/known commands and
    // free navigation don't need this pre-gate; withinQuota still does the real
    // (single) accounting below.
    const willRoute =
      parseCommand(update.text).kind === 'unknown' && !awaitingFeedback && this.deps.router !== undefined;
    if (willRoute) {
      if (await this.overCommandQuota(chatId, now)) {
        await this.deps.transport.sendMessage(chatId, LIMIT_MSG.commands);
        return;
      }
    }

    const command = await this.interpret(session, update.text);
    if (!(await this.withinQuota(chatId, command, now))) return;

    // A routed message spent a cheap-tier LLM call even when it resolved to a
    // "free" command (help/prefs/remember). withinQuota didn't charge those, so
    // count the routing spend once here — else open access is uncapped for the
    // routing tier (ADR-0051). Non-free routes were already charged by withinQuota.
    if (willRoute && isFreeCommand(command.kind)) await this.chargeCommand(chatId, now);

    await this.dispatch(chatId, command, update.senderName);

    // A button-initiated feedback message returns the chat to conversation mode.
    if (awaitingFeedback && session.mode === 'feedback') session.mode = 'chat';
  }

  /** Charge one command against the per-chat + global daily counters (no gating —
   * used to bill a routed message whose resolved command is otherwise free, ADR-0051). */
  private async chargeCommand(chatId: number, now: number): Promise<void> {
    const day = utcDay(now);
    await this.deps.usage.incrementAndGet(`chat:${chatId}:cmd`, day);
    await this.deps.usage.incrementAndGet('global:cmd', day);
  }

  /** Read-only: is the chat or the process already at/over the daily command cap?
   * A pre-gate for the router LLM call; the real increment stays in withinQuota. */
  private async overCommandQuota(chatId: number, now: number): Promise<boolean> {
    const day = utcDay(now);
    const { usage, limits } = this.deps;
    const mine = await usage.peek(`chat:${chatId}:cmd`, day);
    if (mine >= limits.commandsPerDay) return true;
    const total = await usage.peek('global:cmd', day);
    return total >= limits.globalCommandsPerDay;
  }

  /** The session for a chat, created idle on first contact. */
  private session(chatId: number, now: number = this.deps.clock.now()): ChatSession {
    let s = this.sessions.get(chatId);
    if (!s) {
      this.evictIdle(now);
      s = { mode: 'idle', history: [], lastSeen: now };
      this.sessions.set(chatId, s);
    } else {
      s.lastSeen = now;
    }
    return s;
  }

  /** Drop sessions untouched for SESSION_TTL_MS, so open access can't grow the map
   * without bound (ADR-0050). Runs only when a new chat appears — cheap, amortized. */
  private evictIdle(now: number): void {
    for (const [id, s] of this.sessions) {
      if (now - s.lastSeen >= SESSION_TTL_MS) this.sessions.delete(id);
    }
  }

  /** Chat is available only when both an answerer and a Story reader are wired. */
  private chatEnabled(): boolean {
    return this.deps.discussant !== undefined && this.deps.storyRepo !== undefined;
  }

  /** Tap-to-run menus ride along only when natural-language routing is on (ADR-0030). */
  private menuEnabled(): boolean {
    return this.deps.router !== undefined;
  }

  /** The buttons under a generated reply: feedback (ADR-0028) then menu (ADR-0030). */
  private contentButtons(): InlineButton[] {
    return [
      ...(this.deps.feedback ? [FEEDBACK_BUTTON] : []),
      ...(this.menuEnabled() ? [MENU_BUTTON] : []),
    ];
  }

  /**
   * Resolve raw text to a Command. Slash-commands parse as usual. Plain text is
   * captured as tuning while awaiting feedback (ADR-0028); otherwise, when a
   * natural-language router is wired (ADR-0030), it classifies the message into
   * an action. With no router it falls back to the session-mode behavior: a news
   * question while in chat mode (ADR-0029), else the unknown→menu affordance.
   */
  private async interpret(session: ChatSession, text: string): Promise<Command> {
    const parsed = parseCommand(text);
    if (parsed.kind !== 'unknown') return parsed;
    if (session.mode === 'feedback') return { kind: 'feedback', text: parsed.text };
    if (this.deps.router) return this.route(parsed.text);
    if (session.mode === 'chat' && this.chatEnabled()) {
      return { kind: 'chat', text: parsed.text };
    }
    return parsed;
  }

  /** Map a routed intent (ADR-0030) onto an existing Command; free text is reused verbatim. */
  private async route(text: string): Promise<Command> {
    const intent = await this.deps.router!.routeIntent({ text });
    const minutes = intent.minutes ?? undefined;
    switch (intent.action) {
      case 'brief':
        return minutes === undefined ? { kind: 'brief' } : { kind: 'brief', minutes };
      case 'outline':
        return {
          kind: 'outline',
          ...(intent.topic ? { topic: intent.topic } : {}),
          ...(minutes === undefined ? {} : { minutes }),
        };
      case 'podcast':
        return minutes === undefined ? { kind: 'podcast' } : { kind: 'podcast', minutes };
      case 'question':
        return { kind: 'chat', text };
      case 'prefs':
        return { kind: 'prefsShow' };
      case 'setPrefs':
        return { kind: 'prefsNL', text };
      case 'clearPrefs':
        return { kind: 'prefsClear' };
      case 'feedback':
        return { kind: 'feedback', text };
      case 'remember':
        return { kind: 'remember', text };
      case 'forget':
        return { kind: 'forget' };
      case 'help':
        return { kind: 'help' };
    }
  }

  /**
   * An inline button tap (ADR-0028/0030). Navigation buttons (feedback flow,
   * menus) are cheap state changes with no command quota; tap-to-run action
   * buttons map to a Command and go through the same quota + dispatch path as a
   * typed command, so a tapped podcast is metered like a typed one.
   */
  private async handleCallback(
    chatId: number,
    update: TelegramUpdate,
    now: number,
  ): Promise<void> {
    const { transport } = this.deps;
    const data = update.callbackData ?? '';
    if (data === 'fb') {
      this.session(chatId).mode = 'feedback';
      await transport.sendMessage(
        chatId,
        'Tell me what to change — e.g. "more AI, less sports, shorter".',
      );
    } else if (data === 'menu') {
      await this.sendMenu(chatId);
    } else if (data === 'topics') {
      await this.sendTopicMenu(chatId);
    } else {
      const command = callbackCommand(data);
      if (command && (await this.withinQuota(chatId, command, now))) {
        await this.dispatch(chatId, command);
      }
    }
    if (update.callbackQueryId) await transport.answerCallback(update.callbackQueryId);
  }

  /** Default-deny: an explicit allowlist gates; an empty one defers to openAccess. */
  private allowed(chatId: number): boolean {
    const list = this.deps.allowedChatIds;
    if (list && list.length > 0) return list.includes(chatId);
    return this.deps.openAccess;
  }

  /**
   * Durable daily quotas (ADR-0022). Counts every command; podcasts also draw a
   * per-chat and a global ceiling. A chat can only spend up to its own podcast
   * budget against the global counter (per-chat checked first). Sends exactly one
   * notice when a limit is first crossed, then stays silent.
   */
  private async withinQuota(
    chatId: number,
    command: Command,
    now: number,
  ): Promise<boolean> {
    // Free, zero-cost navigation (menu/help, viewing/clearing prefs, pairing)
    // never draws down the daily command budget — only work that reads the cache
    // or hits the model does. Otherwise a few menu taps could burn a user's whole
    // allowance and lock them out of an actual brief (ADR-0047).
    if (isFreeCommand(command.kind)) return true;

    const day = utcDay(now);
    const { usage, transport, limits } = this.deps;

    const cmds = await usage.incrementAndGet(`chat:${chatId}:cmd`, day);
    if (cmds > limits.commandsPerDay) {
      if (cmds === limits.commandsPerDay + 1) await transport.sendMessage(chatId, LIMIT_MSG.commands);
      return false;
    }

    // Process-wide daily ceiling across all chats — the hard total-cost backstop
    // that makes openAccess safe (bounds the chat/discuss LLM spend too). ADR-0031.
    const totalCmds = await usage.incrementAndGet('global:cmd', day);
    if (totalCmds > limits.globalCommandsPerDay) {
      if (totalCmds === limits.globalCommandsPerDay + 1)
        await transport.sendMessage(chatId, LIMIT_MSG.globalCommands);
      return false;
    }

    if (command.kind === 'podcast') {
      // Check the global ceiling before charging this chat's personal podcast
      // counter, so a globally-blocked request doesn't waste the user's own daily
      // allowance (ADR-0051).
      if ((await usage.peek('global:podcast', day)) >= limits.globalPodcastPerDay) {
        await transport.sendMessage(chatId, LIMIT_MSG.global);
        return false;
      }
      const mine = await usage.incrementAndGet(`chat:${chatId}:podcast`, day);
      if (mine > limits.podcastPerDay) {
        if (mine === limits.podcastPerDay + 1) await transport.sendMessage(chatId, LIMIT_MSG.podcast);
        return false;
      }
      const global = await usage.incrementAndGet('global:podcast', day);
      if (global > limits.globalPodcastPerDay) {
        if (global === limits.globalPodcastPerDay + 1) await transport.sendMessage(chatId, LIMIT_MSG.global);
        return false;
      }
    }
    return true;
  }

  private async dispatch(
    chatId: number,
    command: Command,
    senderName?: string,
  ): Promise<void> {
    const { transport, query } = this.deps;
    switch (command.kind) {
      case 'start':
        // A `t.me/<bot>?start=link_<code>` deep link routes to web pairing (ADR-0040);
        // a bare /start is the normal welcome.
        if (command.payload?.startsWith('link_')) {
          return this.handleLink(chatId, command.payload.slice('link_'.length), senderName);
        }
        return this.sendMenu(chatId);

      case 'link':
        return this.handleLink(chatId, command.code, senderName);

      case 'help':
      case 'unknown':
        return this.sendMenu(chatId);

      case 'brief': {
        const req = await this.request(chatId, command.minutes);
        return this.sendContent(chatId, await query.textBrief(req));
      }

      case 'outline': {
        if (!command.topic) {
          return this.sendTopicMenu(chatId);
        }
        const topic = canonical(TOPICS, command.topic);
        if (!topic) {
          return transport.sendMessage(
            chatId,
            `I don’t follow “${command.topic}”. Pick one of: ${TOPICS.join(', ')} — ` +
              `e.g. /outline AI. Or just tap 🔎 By topic.`,
          );
        }
        const req = await this.request(chatId, command.minutes);
        return this.sendContent(chatId, await query.topicOutline(topic, req));
      }

      case 'podcast': {
        // Podcasts (TTS) get a tighter minute cap than text artifacts (ADR-0023).
        const podcastMax = Math.min(this.deps.maxMinutes, this.deps.maxPodcastMinutes);
        return this.sendPodcast(chatId, await this.request(chatId, command.minutes, podcastMax));
      }

      case 'prefsShow':
        return transport.sendMessage(
          chatId,
          formatPrefs(await this.deps.prefs.get(chatId), this.deps.defaults),
        );

      case 'prefsClear':
        await this.deps.prefs.clear(chatId);
        return transport.sendMessage(chatId, 'Preferences cleared — using defaults.');

      case 'prefsSet':
        return this.setPref(chatId, command.field, command.value);

      case 'prefsNL':
        return this.handlePrefsNL(chatId, command.text);

      case 'feedback':
        return this.handleFeedback(chatId, command.text);

      case 'feedbackUndo':
        return this.undoFeedback(chatId);

      case 'remember':
        return this.handleRemember(chatId, command.text);

      case 'forget':
        return this.handleForget(chatId);

      case 'chat':
        return this.handleChat(chatId, command.text);
    }
  }

  /**
   * Send a generated artifact (brief/outline/chat answer) and arm conversation:
   * attach the per-answer feedback button (ADR-0028) and the menu button
   * (ADR-0030), and put the chat into question mode so a plain follow-up is
   * treated as a news question (ADR-0029).
   */
  private async sendContent(chatId: number, text: string): Promise<void> {
    if (this.chatEnabled()) this.session(chatId).mode = 'chat';
    const buttons = this.contentButtons();
    await this.deps.transport.sendMessage(chatId, text, buttons.length ? { buttons } : undefined);
  }

  /** The welcome / catch-all: the help blurb with the tap-to-run main menu (ADR-0030). */
  private async sendMenu(chatId: number): Promise<void> {
    await this.deps.transport.sendMessage(chatId, HELP, { buttons: [...MENU_BUTTONS] });
  }

  /** A one-tap topic picker; each button runs an outline for that topic (ADR-0030). */
  private async sendTopicMenu(chatId: number): Promise<void> {
    const buttons = TOPICS.map((t) => ({ text: t, data: `outline:${t}` }));
    await this.deps.transport.sendMessage(chatId, 'Pick a topic for a focused outline:', {
      buttons,
    });
  }

  /**
   * Answer a question about the news (ADR-0029): ground it in the cache first,
   * and only if that comes up short escalate to a web search (when wired). The
   * user's remembered context (ADR-0028) is woven into both passes.
   */
  private async handleChat(chatId: number, question: string): Promise<void> {
    const { transport, discussant, storyRepo } = this.deps;
    const q = question.trim();

    if (!q) {
      if (this.chatEnabled()) this.session(chatId).mode = 'chat';
      return transport.sendMessage(
        chatId,
        this.chatEnabled()
          ? "Ask me anything about today's news."
          : 'Chat is not available right now.',
      );
    }
    if (!discussant || !storyRepo) {
      return transport.sendMessage(chatId, 'Chat is not available right now.');
    }

    const prefs = await this.deps.prefs.get(chatId);
    const stories = await this.storyContext(prefs, q);
    const memory = prefs?.memory;
    const history = this.session(chatId).history;
    const base = { question: q, history, stories, ...(memory ? { memory } : {}) };

    let result = await discussant.discuss(base);
    let sourcedFromWeb = false;
    if (!result.answeredFromNews && this.deps.webSearch) {
      const web = await this.deps.webSearch.search(q);
      if (web.length > 0) {
        sourcedFromWeb = true;
        result = await discussant.discuss({ ...base, web });
      }
    }

    this.remember(chatId, { role: 'user', content: q });
    this.remember(chatId, { role: 'assistant', content: result.answer });

    const note = sourcedFromWeb ? '\n\n(Sourced from a web search.)' : '';
    return this.sendContent(chatId, result.answer + note);
  }

  /**
   * Pull Stories from the cache as chat grounding (ADR-0029). When an embedder and
   * a semantic-capable reader are wired, retrieve the Stories most *relevant* to the
   * question via cosine over `story_vectors` (ADR-0045); otherwise fall back to the
   * chat's preferred top Stories by significance. Preference topics filter both.
   */
  private async storyContext(
    prefs: ChatPreferences | null,
    question?: string,
  ): Promise<StoryContext[]> {
    const topics = (prefs?.topics ?? this.deps.defaults.topics) as readonly Topic[] | undefined;
    const topicFilter = topics?.length ? { topic: topics } : {};
    const reader = this.deps.storyRepo!;

    const q = question?.trim();
    const search = reader.semanticSearch;
    const stories =
      q && this.deps.embedder && search
        ? await this.semanticStories(search.bind(reader), q, topicFilter)
        : await reader.topStories({ limit: 30, ...topicFilter });

    return stories.map((s) => ({
      title: s.title,
      summary: s.summary,
      whyItMatters: s.whyItMatters,
      topic: s.topic,
      significance: s.significance,
      url: s.url,
    }));
  }

  /**
   * Embed the question and retrieve the most semantically similar Stories (ADR-0045).
   * A degenerate/empty embedding can't rank anything — fall back to significance.
   */
  private async semanticStories(
    search: NonNullable<StoryReader['semanticSearch']>,
    question: string,
    topicFilter: { topic?: readonly Topic[] },
  ): Promise<Awaited<ReturnType<StoryReader['topStories']>>> {
    const [vector] = await this.deps.embedder!.embed([question]);
    // A missing or all-zero embedding can't rank anything (cosine is 0 everywhere).
    if (!vector || vector.length === 0 || vector.every((v) => v === 0)) {
      return this.deps.storyRepo!.topStories({ limit: 30, ...topicFilter });
    }
    // Only ground on genuinely-relevant matches (ADR-0047); if nothing clears the
    // floor, fall back to today's top stories rather than feeding the model noise.
    const relevant = await search({
      vector,
      limit: 12,
      minSimilarity: CHAT_MIN_SIMILARITY,
      ...topicFilter,
    });
    if (relevant.length > 0) return relevant;
    return this.deps.storyRepo!.topStories({ limit: 30, ...topicFilter });
  }

  /** Append a turn to the session, keeping only the most recent ones. */
  private remember(chatId: number, turn: ConversationTurn): void {
    const s = this.session(chatId);
    s.history.push(turn);
    if (s.history.length > MAX_HISTORY_TURNS) {
      s.history.splice(0, s.history.length - MAX_HISTORY_TURNS);
    }
  }

  /** Persist personal context the LLM weaves into every reply (ADR-0028). */
  private async handleRemember(chatId: number, text: string): Promise<void> {
    const { transport, prefs } = this.deps;
    const t = text.trim();
    if (!t) {
      return transport.sendMessage(
        chatId,
        'Usage: /remember <what matters to you> — e.g. /remember I trade commodities and follow shipping.',
      );
    }
    const existing = (await prefs.get(chatId))?.memory;
    const merged = (existing ? `${existing}\n${t}` : t).slice(0, MAX_MEMORY_CHARS);
    await prefs.set(chatId, { memory: merged });
    return transport.sendMessage(
      chatId,
      "Saved — I'll keep that in mind. (/prefs to view · /forget to clear)",
    );
  }

  /**
   * Link this Telegram chat to a web session via a pairing code (ADR-0040). The
   * code originates on the web ("Connect Telegram"); claiming it here proves the
   * visitor controls this account, so the web app can share this chat's
   * preferences. Free and SMS-less — Telegram itself is the identity.
   */
  private async handleLink(chatId: number, code: string, senderName?: string): Promise<void> {
    const { transport, webLink, clock } = this.deps;
    if (!webLink) {
      return transport.sendMessage(chatId, 'Connecting the web app is not available right now.');
    }
    const c = code.trim();
    if (!c) {
      return transport.sendMessage(
        chatId,
        'Usage: /link <code> — get the code from the web app’s “Connect Telegram” button.',
      );
    }
    const result = await webLink.claim(c, chatId, senderName ?? null, clock.now());
    switch (result) {
      case 'linked':
        return transport.sendMessage(
          chatId,
          '✅ Connected! Your web app is now linked to this chat — your topics, brief length, ' +
            'and remembered interests are shared across both. Change them here or on the web anytime.',
        );
      case 'expired':
        return transport.sendMessage(
          chatId,
          'That link code has expired. Open the web app and tap “Connect Telegram” for a fresh one.',
        );
      case 'unknown':
        return transport.sendMessage(
          chatId,
          'I don’t recognize that link code. Double-check it, or generate a new one on the web.',
        );
    }
  }

  /** Clear the chat's remembered context (ADR-0028). */
  private async handleForget(chatId: number): Promise<void> {
    const { transport, prefs } = this.deps;
    if (!(await prefs.get(chatId))?.memory) {
      return transport.sendMessage(chatId, 'Nothing remembered.');
    }
    await prefs.set(chatId, { memory: undefined });
    return transport.sendMessage(chatId, 'Cleared what I was remembering about you.');
  }

  /**
   * Interpret free-text feedback into preference weight changes (ADR-0026):
   * the model names directions, `applyFeedback` does the (clamped) math, and we
   * snapshot the prior state for one-level undo before persisting.
   */
  private async handleFeedback(chatId: number, text: string): Promise<void> {
    const { transport, feedback, prefs, defaults } = this.deps;
    if (!text.trim()) {
      return transport.sendMessage(
        chatId,
        'Tell me what to change — e.g. /feedback more AI, less sports, shorter.',
      );
    }
    if (!feedback) {
      return transport.sendMessage(chatId, 'Feedback tuning is not available right now.');
    }

    const p = await prefs.get(chatId);
    const intent = await feedback.interpretFeedback({ text });
    if (intent.topics.length === 0 && intent.length === null) {
      return transport.sendMessage(
        chatId,
        "I couldn't map that to a preference. Try e.g. 'more AI, less sports, shorter'.",
      );
    }

    const profile: PreferenceProfile = {
      topicWeights: p?.topicWeights ?? {},
      ...(p?.defaultMinutes !== undefined ? { minutes: p.defaultMinutes } : {}),
    };
    const next = applyFeedback(profile, intent, {
      minutesFallback: p?.defaultMinutes ?? defaults.minutes,
      maxMinutes: this.deps.maxMinutes,
    });

    const prev: PreviousPreferences = {
      ...(p?.topicWeights ? { topicWeights: p.topicWeights } : {}),
      ...(p?.defaultMinutes !== undefined ? { defaultMinutes: p.defaultMinutes } : {}),
    };
    await prefs.set(chatId, {
      topicWeights: next.topicWeights,
      defaultMinutes: next.minutes,
      prev,
    });

    const confirm = intent.summary.trim() || 'Updated your preferences.';
    return transport.sendMessage(chatId, `${confirm}\n(/prefs to view · /feedback undo to revert)`);
  }

  /** Revert the most recent feedback change from the saved snapshot (ADR-0026). */
  private async undoFeedback(chatId: number): Promise<void> {
    const { transport, prefs } = this.deps;
    const p = await prefs.get(chatId);
    if (!p?.prev) {
      return transport.sendMessage(chatId, 'Nothing to undo.');
    }
    await prefs.set(chatId, {
      topicWeights: p.prev.topicWeights, // undefined ⇒ cleared back to neutral
      defaultMinutes: p.prev.defaultMinutes,
      prev: undefined, // one-level undo: forget the snapshot
    });
    return transport.sendMessage(chatId, 'Reverted your last feedback change.');
  }

  private async sendPodcast(chatId: number, req: BriefRequest): Promise<void> {
    const script = await this.deps.query.podcastScript(req);
    const audio = this.deps.synthesizer
      ? await this.deps.synthesizer.synthesize(script)
      : null;
    if (!audio) {
      return this.sendContent(chatId, script); // arms chat + feedback button
    }
    await this.deps.transport.sendAudio(chatId, audio, {
      title: 'Horizon podcast',
      filename: 'horizon.mp3',
    });
    // Audio can't carry buttons; follow with the chat/feedback/menu affordance when any is wired.
    if (this.chatEnabled()) this.session(chatId).mode = 'chat';
    const buttons = this.contentButtons();
    if (this.chatEnabled() || buttons.length) {
      const parts = [
        ...(this.chatEnabled() ? ['ask me about any story'] : []),
        ...(this.deps.feedback ? ['give feedback'] : []),
        ...(this.menuEnabled() ? ['open the menu'] : []),
      ];
      const hint = parts.length ? `You can ${humanJoin(parts)}.` : 'Tap below.';
      await this.deps.transport.sendMessage(chatId, hint, buttons.length ? { buttons } : undefined);
    }
  }

  private async setPref(chatId: number, field: PrefsField, value: string): Promise<void> {
    const { prefs, transport } = this.deps;
    if (field === 'minutes') {
      const raw = Number(value);
      if (!Number.isFinite(raw) || raw <= 0) {
        return transport.sendMessage(chatId, 'Minutes must be a positive number.');
      }
      // Clamp to maxMinutes like the NL and web-PUT paths do, so `/prefs minutes
      // 100000` can't store (and then display) an absurd budget (ADR-0049).
      const minutes = normalizeMinutes(raw, this.deps.maxMinutes);
      await prefs.set(chatId, { defaultMinutes: minutes });
      return transport.sendMessage(chatId, `Default budget set to ${minutes} min.`);
    }

    // field === 'topics'
    const topics = parseList(TOPICS, value);
    if (topics.length === 0) {
      return transport.sendMessage(chatId, `No valid topics. Choose from: ${TOPICS.join(', ')}.`);
    }
    await prefs.set(chatId, { topics });
    return transport.sendMessage(chatId, `Preferred topics: ${topics.join(', ')}.`);
  }

  /**
   * Apply a plain-language preference edit (ADR-0030): the model names the
   * change (set/add/remove topics, a new default budget), the bot validates the
   * values against the controlled vocabulary, merges them onto the chat's hard
   * filters, and echoes the resulting preferences back.
   */
  private async handlePrefsNL(chatId: number, text: string): Promise<void> {
    const { transport, prefsInterpreter, prefs } = this.deps;
    if (!prefsInterpreter) {
      return transport.sendMessage(chatId, 'Changing preferences in plain text is not available right now.');
    }

    const patch = await prefsInterpreter.interpretPrefs({ text });
    const current = await prefs.get(chatId);
    const update: {
      topics?: Topic[] | undefined;
      defaultMinutes?: number;
    } = {};
    let changed = false;

    if (patch.topics) {
      const next = applyListChange(TOPICS, current?.topics, patch.topics);
      if (next !== undefined) {
        // An empty result clears the filter back to the config default (ADR-0015).
        update.topics = next.length ? next : undefined;
        changed = true;
      }
    }
    if (patch.minutes !== null && patch.minutes > 0) {
      update.defaultMinutes = normalizeMinutes(patch.minutes, this.deps.maxMinutes);
      changed = true;
    }

    if (!changed) {
      return transport.sendMessage(
        chatId,
        'I couldn\'t tell what to change. Try e.g. "add Politics", "only AI and Israel", or "set my budget to 5 minutes".',
      );
    }

    const saved = await prefs.set(chatId, update);
    const confirm = patch.summary.trim() || 'Updated your preferences.';
    return transport.sendMessage(chatId, `${confirm}\n\n${formatPrefs(saved, this.deps.defaults)}`);
  }

  /**
   * Merge the chat's saved preferences over the config defaults into a BriefRequest.
   * `maxMinutes` defaults to the global cap; the podcast path passes a tighter one.
   */
  private async request(
    chatId: number,
    minutesOverride?: number,
    maxMinutes: number = this.deps.maxMinutes,
  ): Promise<BriefRequest> {
    const p = await this.deps.prefs.get(chatId);
    const { defaults } = this.deps;
    const minutes = normalizeMinutes(
      minutesOverride ?? p?.defaultMinutes ?? defaults.minutes,
      maxMinutes,
    );
    const topics = p?.topics ?? defaults.topics;
    return {
      minutes,
      ...(topics?.length ? { topics } : {}),
      ...(hasWeights(p?.topicWeights) ? { topicWeights: p!.topicWeights } : {}),
      ...(p?.memory ? { memory: p.memory } : {}),
    };
  }
}

/** True if a weight map has at least one entry (an empty map ≡ neutral). */
function hasWeights(w: Record<string, number> | undefined): boolean {
  return w !== undefined && Object.keys(w).length > 0;
}

/** Join phrases for prose: "a", "a or b", "a, b, or c". */
function humanJoin(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} or ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, or ${parts.at(-1)}`;
}

/**
 * Map a tap-to-run button's callback data to a Command (ADR-0030), or null for
 * a navigation-only tap. `outline:<topic>` carries the picked topic; the topic
 * is validated by the dispatcher like a typed one.
 */
function callbackCommand(data: string): Command | null {
  switch (data) {
    case 'brief':
      return { kind: 'brief' };
    case 'podcast':
      return { kind: 'podcast' };
    case 'prefs':
      return { kind: 'prefsShow' };
  }
  if (data.startsWith('outline:')) {
    const topic = data.slice('outline:'.length);
    return topic ? { kind: 'outline', topic } : null;
  }
  return null;
}

/**
 * Commands that cost nothing (no model call, no cache render) and so are exempt
 * from the daily command quota (ADR-0047): menu/help, pairing, and viewing or
 * changing settings. Everything else (brief/outline/podcast/chat/feedback)
 * still counts.
 */
const FREE_COMMANDS: ReadonlySet<Command['kind']> = new Set([
  'start',
  'link',
  'help',
  'unknown',
  'prefsShow',
  'prefsSet',
  'prefsClear',
  'feedbackUndo',
  'remember',
  'forget',
]);

function isFreeCommand(kind: Command['kind']): boolean {
  return FREE_COMMANDS.has(kind);
}

/** Parse a comma list against a controlled vocabulary, dropping invalid entries. */
function parseList<T extends string>(vocab: readonly T[], value: string): T[] {
  return value
    .split(',')
    .map((s) => canonical(vocab, s))
    .filter((v): v is T => v !== null);
}

/** Order-preserving de-duplication. */
function dedupe<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/**
 * Apply a plain-language list change (ADR-0030) to a chat's current list-valued
 * filter. Values are validated against the controlled vocabulary; an edit with
 * no recognizable values is a no-op (returns undefined). `replace` sets exactly
 * the values, `add` unions them onto the current list, `remove` drops them.
 */
function applyListChange<T extends string>(
  vocab: readonly T[],
  current: readonly T[] | undefined,
  change: PrefsListChange,
): T[] | undefined {
  const values = change.values
    .map((v) => canonical(vocab, v))
    .filter((v): v is T => v !== null);
  if (values.length === 0) return undefined;
  const base = current ?? [];
  switch (change.mode) {
    case 'replace':
      return dedupe(values);
    case 'add':
      return dedupe([...base, ...values]);
    case 'remove':
      return base.filter((v) => !values.includes(v));
  }
}

/**
 * Render a chat's effective preferences. Always shows a concrete value: a field
 * the chat hasn't set falls back to the config default and is marked `(default)`,
 * so there is never a blank like "budget: (default) min".
 */
function formatPrefs(p: ChatPreferences | null, defaults: PresentationDefaults): string {
  const topics = p?.topics?.length
    ? p.topics.join(', ')
    : `${defaults.topics?.length ? defaults.topics.join(', ') : 'all topics'} (default)`;
  const minutes = p?.defaultMinutes ?? defaults.minutes;
  const minutesIsDefault = p?.defaultMinutes === undefined;

  const lines = ['⚙️ Your preferences:'];
  lines.push(`• Topics: ${topics}`);
  lines.push(`• Brief length: ${minutes} min${minutesIsDefault ? ' (default)' : ''}`);
  const weights = formatWeights(p?.topicWeights);
  if (weights) lines.push(`• Tuning: ${weights}`);
  if (p?.memory) lines.push(`• Remembered: ${p.memory.replace(/\n/g, '; ')}`);
  lines.push('');
  lines.push('Tell me e.g. “only AI and Israel” or “default to 5 minutes” to change these.');
  return lines.join('\n');
}

/** Render a weight map as e.g. "AI↑, Sports muted"; empty ⇒ "" (ADR-0026). */
function formatWeights(w: Record<string, number> | undefined): string {
  if (!w) return '';
  return Object.entries(w)
    .map(([k, v]) => (v === 0 ? `${k} muted` : v > 1 ? `${k}↑` : v < 1 ? `${k}↓` : ''))
    .filter(Boolean)
    .join(', ');
}
