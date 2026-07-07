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
  /** Sender's Telegram first name, when present — used only for a friendly greeting (ADR-0040). */
  readonly senderName?: string;
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

/** A batch of long-polled updates plus how far to advance the poll offset. */
export interface UpdateBatch {
  /** The domain updates we handle (text messages + button taps). */
  readonly updates: TelegramUpdate[];
  /**
   * One past the highest RAW `update_id` in the batch — including updates we drop
   * (photos, stickers, voice, service messages). The offset must advance past these
   * too, or Telegram re-delivers a dropped update forever and the loop busy-hammers
   * the API into a 429/ban (ADR-0051). Undefined when the batch was empty.
   */
  readonly ackOffset?: number;
}

export interface TelegramTransport {
  sendMessage(chatId: number, text: string, opts?: SendMessageOptions): Promise<void>;
  sendAudio(chatId: number, audio: Buffer, opts?: SendAudioOptions): Promise<void>;
  /** Long-poll updates after `offset`, waiting up to `timeoutSec` server-side. */
  getUpdates(offset: number, timeoutSec: number): Promise<UpdateBatch>;
  /** Acknowledge a button tap so Telegram stops the client's loading spinner. */
  answerCallback(callbackQueryId: string): Promise<void>;
}
