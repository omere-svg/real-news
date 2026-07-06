import type {
  SendAudioOptions,
  SendMessageOptions,
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

/** Telegram's hard cap on a single text message. */
export const TELEGRAM_TEXT_LIMIT = 4096;

/** Inline buttons per row — keeps menus readable on a phone (ADR-0030). */
export const BUTTONS_PER_ROW = 3;

/** Split into a hard-cap-sized pieces. */
function chunkString(s: string, limit: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += limit) out.push(s.slice(i, i + limit));
  return out;
}

/**
 * Lay a flat list of buttons out as an inline keyboard, wrapping into rows so a
 * menu stays readable (ADR-0030). The bot passes a single flat row; the wrapping
 * is a presentation detail of this transport.
 */
export function toInlineKeyboard(
  buttons: readonly { text: string; data: string }[],
  perRow = BUTTONS_PER_ROW,
): { text: string; callback_data: string }[][] {
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < buttons.length; i += perRow) {
    rows.push(buttons.slice(i, i + perRow).map((b) => ({ text: b.text, callback_data: b.data })));
  }
  return rows;
}

/**
 * Split text into Telegram-sized chunks (ADR-0024 follow-up), preferring line
 * boundaries so a brief's bullets stay intact; a single over-long line is
 * hard-split. A short message returns a single chunk.
 */
export function splitForTelegram(text: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let buf = '';
  for (const line of text.split('\n')) {
    const parts = line.length > limit ? chunkString(line, limit) : [line];
    for (const part of parts) {
      const candidate = buf ? `${buf}\n${part}` : part;
      if (candidate.length > limit) {
        if (buf) chunks.push(buf);
        buf = part;
      } else {
        buf = candidate;
      }
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/**
 * Map a raw getUpdates payload to domain updates: text messages, and inline
 * button taps (callback queries, ADR-0028) carried as updates with empty text
 * plus `callbackData`/`callbackQueryId`.
 */
export function toUpdates(raw: unknown): TelegramUpdate[] {
  const result = (raw as { result?: unknown[] } | null)?.result;
  if (!Array.isArray(result)) return [];

  const updates: TelegramUpdate[] = [];
  for (const entry of result) {
    const e = entry as {
      update_id?: number;
      message?: { chat?: { id?: number }; text?: string; from?: { first_name?: string } };
      callback_query?: { id?: string; data?: string; message?: { chat?: { id?: number } } };
    };
    if (typeof e.update_id !== 'number') continue;

    const cb = e.callback_query;
    const cbChatId = cb?.message?.chat?.id;
    if (cb && typeof cb.id === 'string' && typeof cb.data === 'string' && typeof cbChatId === 'number') {
      updates.push({
        updateId: e.update_id,
        chatId: cbChatId,
        text: '',
        callbackData: cb.data,
        callbackQueryId: cb.id,
      });
      continue;
    }

    const chatId = e.message?.chat?.id;
    const text = e.message?.text;
    if (typeof chatId === 'number' && typeof text === 'string') {
      const senderName = e.message?.from?.first_name;
      updates.push({
        updateId: e.update_id,
        chatId,
        text,
        ...(senderName ? { senderName } : {}),
      });
    }
  }
  return updates;
}

export class BotApiTransport implements TelegramTransport {
  private readonly base: string;

  constructor(deps: BotApiTransportDeps) {
    this.base = `https://api.telegram.org/bot${deps.token}`;
  }

  async sendMessage(chatId: number, text: string, opts: SendMessageOptions = {}): Promise<void> {
    // Telegram rejects messages over 4096 chars; send long briefs as ordered
    // chunks. Buttons attach to the LAST chunk so they sit under the reply.
    const chunks = splitForTelegram(text);
    for (let i = 0; i < chunks.length; i += 1) {
      const isLast = i === chunks.length - 1;
      const markup =
        isLast && opts.buttons?.length
          ? { reply_markup: { inline_keyboard: toInlineKeyboard(opts.buttons) } }
          : {};
      await this.post('sendMessage', { chat_id: chatId, text: chunks[i], ...markup });
    }
  }

  async answerCallback(callbackQueryId: string): Promise<void> {
    await this.post('answerCallbackQuery', { callback_query_id: callbackQueryId });
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
      allowed_updates: ['message', 'callback_query'],
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
