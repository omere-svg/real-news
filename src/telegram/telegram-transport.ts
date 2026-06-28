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
  /** Message text; "" for a button tap (carries `callbackData` instead). */
  readonly text: string;
  /** Set when the update is an inline-button tap (ADR-0028): the button's data. */
  readonly callbackData?: string;
  /** The callback query id to acknowledge, paired with `callbackData`. */
  readonly callbackQueryId?: string;
}

export interface SendAudioOptions {
  readonly filename?: string;
  readonly title?: string;
  readonly caption?: string;
}

/** An inline keyboard button: a label and the opaque data echoed back on tap. */
export interface InlineButton {
  readonly text: string;
  readonly data: string;
}

export interface SendMessageOptions {
  /** A single row of inline buttons under the message (ADR-0028). */
  readonly buttons?: readonly InlineButton[];
}

export interface TelegramTransport {
  sendMessage(chatId: number, text: string, opts?: SendMessageOptions): Promise<void>;
  sendAudio(chatId: number, audio: Buffer, opts?: SendAudioOptions): Promise<void>;
  /** Long-poll updates after `offset`, waiting up to `timeoutSec` server-side. */
  getUpdates(offset: number, timeoutSec: number): Promise<TelegramUpdate[]>;
  /** Acknowledge a button tap so Telegram stops the client's loading spinner. */
  answerCallback(callbackQueryId: string): Promise<void>;
}
