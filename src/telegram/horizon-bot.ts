import { parseCommand, type Command, type PrefsField } from './command.js';
import type { TelegramTransport, TelegramUpdate } from './telegram-transport.js';
import type { Synthesizer } from './synthesizer.js';
import type { RateLimiter } from './rate-limiter.js';
import type {
  ChatPreferencesRepo,
  ChatPreferences,
  PreviousPreferences,
} from '../db/chat-preferences-repo.js';
import type { UsageRepo } from '../db/usage-repo.js';
import type { Clock } from '../scheduler/clock.js';
import type { BriefRequest, QueryEngine } from '../presentation/query-engine.js';
import type { PresentationDefaults } from '../server/app.js';
import type { FeedbackInterpreter } from '../llm/llm-client.js';
import { applyFeedback, type PreferenceProfile } from '../preferences/feedback.js';
import { normalizeMinutes } from '../presentation/minutes.js';
import { REGIONS, TOPICS } from '../domain/types.js';

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
}

export interface HorizonBotDeps {
  readonly transport: TelegramTransport;
  readonly query: QueryEngine;
  readonly prefs: ChatPreferencesRepo;
  /** Interprets free-text feedback into preference changes (ADR-0026); omit to disable. */
  readonly feedback?: FeedbackInterpreter;
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
  /** Chat ids the bot answers; empty defers to `openAccess` (ADR-0022). */
  readonly allowedChatIds?: readonly number[];
  /** Answer everyone when the allowlist is empty. Default-deny when false. */
  readonly openAccess: boolean;
}

const LIMIT_MSG = {
  commands: 'Daily command limit reached. Try again tomorrow (UTC).',
  podcast: 'Daily podcast limit reached. Try again tomorrow (UTC).',
  global: 'The podcast service is busy right now. Please try again later.',
} as const;

const HELP = [
  '🌅 Horizon — your background news editor.',
  '',
  '/brief [minutes] — a time-budgeted text brief',
  '/outline <topic> [minutes] — a topic-focused outline',
  '/podcast [minutes] — a spoken podcast (audio)',
  '/prefs — show your preferences',
  '/prefs topics AI,Geopolitics — set preferred topics',
  '/prefs regions Israel — set preferred regions',
  '/prefs minutes 10 — set your default budget',
  '/prefs clear — reset preferences',
  '/feedback <text> — tune in plain English, e.g. "more AI, less sports, shorter"',
  '/feedback undo — revert your last feedback',
].join('\n');

export class HorizonBot {
  constructor(private readonly deps: HorizonBotDeps) {}

  async handle(update: TelegramUpdate): Promise<void> {
    const { chatId, text } = update;
    if (!this.allowed(chatId)) return; // default-deny (ADR-0022)

    const now = this.deps.clock.now();
    // Burst limit: silently drop, so spamming earns no reply and can't block the loop.
    if (!this.deps.limiter.allow(`burst:${chatId}`, now)) return;

    const command = parseCommand(text);
    if (!(await this.withinQuota(chatId, command, now))) return;

    await this.dispatch(chatId, command);
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
    const day = utcDay(now);
    const { usage, transport, limits } = this.deps;

    const cmds = await usage.incrementAndGet(`chat:${chatId}:cmd`, day);
    if (cmds > limits.commandsPerDay) {
      if (cmds === limits.commandsPerDay + 1) await transport.sendMessage(chatId, LIMIT_MSG.commands);
      return false;
    }

    if (command.kind === 'podcast') {
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

  private async dispatch(chatId: number, command: Command): Promise<void> {
    const { transport, query } = this.deps;
    switch (command.kind) {
      case 'start':
      case 'help':
      case 'unknown':
        return transport.sendMessage(chatId, HELP);

      case 'brief': {
        const req = await this.request(chatId, command.minutes);
        return transport.sendMessage(chatId, await query.textBrief(req));
      }

      case 'outline': {
        if (!command.topic) {
          return transport.sendMessage(chatId, 'Usage: /outline <topic> [minutes]');
        }
        const topic = canonical(TOPICS, command.topic);
        if (!topic) {
          return transport.sendMessage(
            chatId,
            `Unknown topic. Try one of: ${TOPICS.join(', ')}.`,
          );
        }
        const req = await this.request(chatId, command.minutes);
        return transport.sendMessage(chatId, await query.topicOutline(topic, req));
      }

      case 'podcast':
        return this.sendPodcast(chatId, await this.request(chatId, command.minutes));

      case 'prefsShow':
        return transport.sendMessage(chatId, formatPrefs(await this.deps.prefs.get(chatId)));

      case 'prefsClear':
        await this.deps.prefs.clear(chatId);
        return transport.sendMessage(chatId, 'Preferences cleared — using defaults.');

      case 'prefsSet':
        return this.setPref(chatId, command.field, command.value);

      case 'feedback':
        return this.handleFeedback(chatId, command.text);

      case 'feedbackUndo':
        return this.undoFeedback(chatId);
    }
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
    if (intent.topics.length === 0 && intent.regions.length === 0 && intent.length === null) {
      return transport.sendMessage(
        chatId,
        "I couldn't map that to a preference. Try e.g. 'more AI, less sports, shorter'.",
      );
    }

    const profile: PreferenceProfile = {
      topicWeights: p?.topicWeights ?? {},
      regionWeights: p?.regionWeights ?? {},
      ...(p?.defaultMinutes !== undefined ? { minutes: p.defaultMinutes } : {}),
    };
    const next = applyFeedback(profile, intent, {
      minutesFallback: p?.defaultMinutes ?? defaults.minutes,
      maxMinutes: this.deps.maxMinutes,
    });

    const prev: PreviousPreferences = {
      ...(p?.topicWeights ? { topicWeights: p.topicWeights } : {}),
      ...(p?.regionWeights ? { regionWeights: p.regionWeights } : {}),
      ...(p?.defaultMinutes !== undefined ? { defaultMinutes: p.defaultMinutes } : {}),
    };
    await prefs.set(chatId, {
      topicWeights: next.topicWeights,
      regionWeights: next.regionWeights,
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
      regionWeights: p.prev.regionWeights,
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
    if (audio) {
      await this.deps.transport.sendAudio(chatId, audio, {
        title: 'Horizon podcast',
        filename: 'horizon.mp3',
        caption: `~${req.minutes} min`,
      });
    } else {
      await this.deps.transport.sendMessage(chatId, script);
    }
  }

  private async setPref(chatId: number, field: PrefsField, value: string): Promise<void> {
    const { prefs, transport } = this.deps;
    if (field === 'minutes') {
      const minutes = Number(value);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return transport.sendMessage(chatId, 'Minutes must be a positive number.');
      }
      await prefs.set(chatId, { defaultMinutes: minutes });
      return transport.sendMessage(chatId, `Default budget set to ${minutes} min.`);
    }

    if (field === 'topics') {
      const topics = parseList(TOPICS, value);
      if (topics.length === 0) {
        return transport.sendMessage(chatId, `No valid topics. Choose from: ${TOPICS.join(', ')}.`);
      }
      await prefs.set(chatId, { topics });
      return transport.sendMessage(chatId, `Preferred topics: ${topics.join(', ')}.`);
    }

    // field === 'regions'
    const regions = parseList(REGIONS, value);
    if (regions.length === 0) {
      return transport.sendMessage(chatId, `No valid regions. Choose from: ${REGIONS.join(', ')}.`);
    }
    await prefs.set(chatId, { regions });
    return transport.sendMessage(chatId, `Preferred regions: ${regions.join(', ')}.`);
  }

  /** Merge the chat's saved preferences over the config defaults into a BriefRequest. */
  private async request(chatId: number, minutesOverride?: number): Promise<BriefRequest> {
    const p = await this.deps.prefs.get(chatId);
    const { defaults } = this.deps;
    const minutes = normalizeMinutes(
      minutesOverride ?? p?.defaultMinutes ?? defaults.minutes,
      this.deps.maxMinutes,
    );
    const regions = p?.regions ?? defaults.regions;
    const topics = p?.topics ?? defaults.topics;
    return {
      minutes,
      ...(regions?.length ? { regions } : {}),
      ...(topics?.length ? { topics } : {}),
      ...(hasWeights(p?.topicWeights) ? { topicWeights: p!.topicWeights } : {}),
      ...(hasWeights(p?.regionWeights) ? { regionWeights: p!.regionWeights } : {}),
    };
  }
}

/** True if a weight map has at least one entry (an empty map ≡ neutral). */
function hasWeights(w: Record<string, number> | undefined): boolean {
  return w !== undefined && Object.keys(w).length > 0;
}

/** The UTC day key (YYYY-MM-DD) for a quota bucket. */
function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The canonical vocabulary member matching `raw` (case-insensitive), or null. */
function canonical<T extends string>(vocab: readonly T[], raw: string): T | null {
  const needle = raw.trim().toLowerCase();
  return vocab.find((v) => v.toLowerCase() === needle) ?? null;
}

/** Parse a comma list against a controlled vocabulary, dropping invalid entries. */
function parseList<T extends string>(vocab: readonly T[], value: string): T[] {
  return value
    .split(',')
    .map((s) => canonical(vocab, s))
    .filter((v): v is T => v !== null);
}

function formatPrefs(p: ChatPreferences | null): string {
  if (!p) return 'No preferences set — using defaults. See /prefs to set them.';
  const lines = ['Your preferences:'];
  lines.push(`• topics: ${p.topics?.join(', ') ?? '(default)'}`);
  lines.push(`• regions: ${p.regions?.join(', ') ?? '(default)'}`);
  lines.push(`• default budget: ${p.defaultMinutes ?? '(default)'} min`);
  const weights = formatWeights(p.topicWeights) || formatWeights(p.regionWeights);
  if (weights) lines.push(`• tuning: ${[formatWeights(p.topicWeights), formatWeights(p.regionWeights)].filter(Boolean).join(', ')}`);
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
