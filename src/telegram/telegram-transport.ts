/**
 * The Telegram transport seam (ADR-0019) — the thin provider half of the bot.
 * Sends chat messages/audio and long-polls for updates. The bot logic
 * (`HorizonBot`) sits above this and is tested against a fake; the Bot API
 * adapter is the only part that touches the network.
 */
export interface TelegramUpdate {
  /** Monotonic update id; the next poll offsets past the highest seen. */
  readonly updateId: number;
  readonly chatId: number;
  readonly text: string;
}

export interface SendAudioOptions {
  readonly filename?: string;
  readonly title?: string;
  readonly caption?: string;
}

export interface TelegramTransport {
  sendMessage(chatId: number, text: string): Promise<void>;
  sendAudio(chatId: number, audio: Buffer, opts?: SendAudioOptions): Promise<void>;
  /** Long-poll updates after `offset`, waiting up to `timeoutSec` server-side. */
  getUpdates(offset: number, timeoutSec: number): Promise<TelegramUpdate[]>;
}
