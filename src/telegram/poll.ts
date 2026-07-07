import type { TelegramTransport, TelegramUpdate } from './telegram-transport.js';

/** The bit of the bot the poll loop needs — satisfied by HorizonBot. */
export interface UpdateHandler {
  handle(update: TelegramUpdate): Promise<void>;
}

/**
 * One long-poll cycle (ADR-0019): fetch updates after `offset`, handle each, and
 * return the next offset (past the highest update id seen). A failing handler is
 * logged and skipped so it neither stops the batch nor re-delivers forever — the
 * offset still advances. Extracted from the loop because the offset arithmetic is
 * the bug-prone part.
 */
export async function pollOnce(
  transport: TelegramTransport,
  bot: UpdateHandler,
  offset: number,
  timeoutSec: number,
  onError: (err: unknown) => void = (err) =>
    console.error('[telegram] handler failed:', err),
): Promise<number> {
  const { updates, ackOffset } = await transport.getUpdates(offset, timeoutSec);
  // Advance past every RAW update in the batch (ackOffset), not just the ones we
  // mapped — a dropped sticker/photo would otherwise re-deliver forever (ADR-0051).
  let next = ackOffset ?? offset;
  for (const update of updates) {
    next = Math.max(next, update.updateId + 1);
    try {
      await bot.handle(update);
    } catch (err) {
      onError(err);
    }
  }
  return next;
}
