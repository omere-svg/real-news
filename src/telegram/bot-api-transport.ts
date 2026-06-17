import type {
  SendAudioOptions,
  TelegramTransport,
  TelegramUpdate,
} from './telegram-transport.js';

/**
 * Telegram Bot API transport (ADR-0019) over `fetch` — zero dependencies. The
 * thin provider half: no command logic lives here. `toUpdates` (the raw→domain
 * mapping) is pure and separately tested; the network calls are not unit-tested.
 */
export interface BotApiTransportDeps {
  /** Bot token from `TELEGRAM_BOT_TOKEN` (env, never config). */
  readonly token: string;
}

/** Map a raw getUpdates payload to domain updates, keeping only text messages. */
export function toUpdates(raw: unknown): TelegramUpdate[] {
  const result = (raw as { result?: unknown[] } | null)?.result;
  if (!Array.isArray(result)) return [];

  const updates: TelegramUpdate[] = [];
  for (const entry of result) {
    const e = entry as {
      update_id?: number;
      message?: { chat?: { id?: number }; text?: string };
    };
    const chatId = e.message?.chat?.id;
    const text = e.message?.text;
    if (typeof e.update_id === 'number' && typeof chatId === 'number' && typeof text === 'string') {
      updates.push({ updateId: e.update_id, chatId, text });
    }
  }
  return updates;
}

export class BotApiTransport implements TelegramTransport {
  private readonly base: string;

  constructor(deps: BotApiTransportDeps) {
    this.base = `https://api.telegram.org/bot${deps.token}`;
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    await this.post('sendMessage', { chat_id: chatId, text });
  }

  async sendAudio(
    chatId: number,
    audio: Buffer,
    opts: SendAudioOptions = {},
  ): Promise<void> {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (opts.title) form.append('title', opts.title);
    if (opts.caption) form.append('caption', opts.caption);
    form.append(
      'audio',
      new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }),
      opts.filename ?? 'horizon.mp3',
    );
    const res = await fetch(`${this.base}/sendAudio`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`telegram sendAudio ${res.status}`);
  }

  async getUpdates(offset: number, timeoutSec: number): Promise<TelegramUpdate[]> {
    const raw = await this.post('getUpdates', {
      offset,
      timeout: timeoutSec,
      allowed_updates: ['message'],
    });
    return toUpdates(raw);
  }

  private async post(method: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`telegram ${method} ${res.status}`);
    return res.json();
  }
}
