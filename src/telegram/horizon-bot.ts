import { parseCommand, type Command, type PrefsField } from './command.js';
import type { TelegramTransport, TelegramUpdate } from './telegram-transport.js';
import type { Synthesizer } from './synthesizer.js';
import type { ChatPreferencesRepo, ChatPreferences } from '../db/chat-preferences-repo.js';
import type { BriefRequest, QueryEngine } from '../presentation/query-engine.js';
import type { PresentationDefaults } from '../server/app.js';
import { REGIONS, TOPICS } from '../domain/types.js';

/**
 * The Telegram bot dispatcher (ADR-0019) — a deep Presentation adapter. Maps a
 * chat command + the chat's preferences onto a BriefRequest, runs it through the
 * read-only QueryEngine, and sends the result (text, or synthesized audio for
 * podcasts). No network or model code lives here; everything is behind seams and
 * tested with fakes.
 */
export interface HorizonBotDeps {
  readonly transport: TelegramTransport;
  readonly query: QueryEngine;
  readonly prefs: ChatPreferencesRepo;
  /** TTS for podcast audio; null sends the script as text (ADR-0020). */
  readonly synthesizer: Synthesizer | null;
  /** Config-driven fallback when a chat has set nothing (ADR-0015). */
  readonly defaults: PresentationDefaults;
  /** When non-empty, only these chat ids are answered (ADR-0019). */
  readonly allowedChatIds?: readonly number[];
}

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
].join('\n');

export class HorizonBot {
  constructor(private readonly deps: HorizonBotDeps) {}

  async handle(update: TelegramUpdate): Promise<void> {
    if (!this.allowed(update.chatId)) return;
    const command = parseCommand(update.text);
    await this.dispatch(update.chatId, command);
  }

  private allowed(chatId: number): boolean {
    const list = this.deps.allowedChatIds;
    return !list || list.length === 0 || list.includes(chatId);
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
    }
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
    const minutes = minutesOverride ?? p?.defaultMinutes ?? defaults.minutes;
    const regions = p?.regions ?? defaults.regions;
    const topics = p?.topics ?? defaults.topics;
    return {
      minutes,
      ...(regions?.length ? { regions } : {}),
      ...(topics?.length ? { topics } : {}),
    };
  }
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
  return lines.join('\n');
}
