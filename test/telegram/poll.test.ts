import { describe, expect, it } from 'vitest';
import { pollOnce } from '../../src/telegram/poll.js';
import type { TelegramTransport, TelegramUpdate } from '../../src/telegram/telegram-transport.js';

function transportReturning(updates: TelegramUpdate[]): TelegramTransport {
  return {
    sendMessage: async () => {},
    sendAudio: async () => {},
    getUpdates: async () => updates,
  };
}

describe('pollOnce', () => {
  it('handles each update and advances the offset past the highest update id', async () => {
    const handled: number[] = [];
    const bot = { handle: async (u: TelegramUpdate) => void handled.push(u.updateId) };
    const transport = transportReturning([
      { updateId: 10, chatId: 1, text: 'a' },
      { updateId: 11, chatId: 1, text: 'b' },
    ]);

    const next = await pollOnce(transport, bot, 0, 30);

    expect(handled).toEqual([10, 11]);
    expect(next).toBe(12);
  });

  it('keeps the same offset when there are no updates', async () => {
    const bot = { handle: async () => {} };
    const next = await pollOnce(transportReturning([]), bot, 7, 30);
    expect(next).toBe(7);
  });

  it('does not let one failing handler stop the batch', async () => {
    const handled: number[] = [];
    const bot = {
      handle: async (u: TelegramUpdate) => {
        if (u.updateId === 10) throw new Error('boom');
        handled.push(u.updateId);
      },
    };
    const transport = transportReturning([
      { updateId: 10, chatId: 1, text: 'a' },
      { updateId: 11, chatId: 1, text: 'b' },
    ]);

    const next = await pollOnce(transport, bot, 0, 30);

    expect(handled).toEqual([11]); // 11 still processed despite 10 throwing
    expect(next).toBe(12); // offset still advances past both
  });
});
