import { describe, expect, it, vi } from 'vitest';
import {
  BotApiTransport,
  toInlineKeyboard,
  toUpdates,
  maxUpdateId,
  splitForTelegram,
} from '../../src/telegram/bot-api-transport.js';

/** A fake fetch returning a canned JSON payload, capturing every request. */
function fakeFetch(payload: unknown = { ok: true, result: [] }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('splitForTelegram', () => {
  it('keeps a short message as a single chunk', () => {
    expect(splitForTelegram('hello', 10)).toEqual(['hello']);
  });

  it('splits on line boundaries, each chunk within the limit', () => {
    const chunks = splitForTelegram('aaaa\nbbbb\ncccc', 10);
    expect(chunks).toEqual(['aaaa\nbbbb', 'cccc']);
    expect(chunks.every((c) => c.length <= 10)).toBe(true);
  });

  it('hard-splits a single line longer than the limit', () => {
    expect(splitForTelegram('xxxxxxxxxxxxx', 5)).toEqual(['xxxxx', 'xxxxx', 'xxx']);
  });

  it('preserves all non-boundary content across chunks', () => {
    const text = Array.from({ length: 50 }, (_, i) => `• story line number ${i}`).join('\n');
    const chunks = splitForTelegram(text, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join('\n')).toContain('story line number 49');
  });
});

describe('toInlineKeyboard', () => {
  it('keeps a short row on one line', () => {
    expect(toInlineKeyboard([{ text: 'A', data: 'a' }])).toEqual([
      [{ text: 'A', callback_data: 'a' }],
    ]);
  });

  it('wraps a long list into rows so a menu stays readable (ADR-0030)', () => {
    const buttons = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((d) => ({ text: d, data: d }));
    const rows = toInlineKeyboard(buttons, 3);
    expect(rows.map((r) => r.length)).toEqual([3, 3, 1]); // 7 across rows of 3
    expect(rows[0]?.[0]).toEqual({ text: 'a', callback_data: 'a' });
  });
});

describe('toUpdates', () => {
  it('maps text messages to domain updates', () => {
    const raw = {
      ok: true,
      result: [
        { update_id: 10, message: { chat: { id: 5 }, text: '/brief' } },
        { update_id: 11, message: { chat: { id: 7 }, text: '/podcast 20' } },
      ],
    };
    expect(toUpdates(raw)).toEqual([
      { updateId: 10, chatId: 5, text: '/brief' },
      { updateId: 11, chatId: 7, text: '/podcast 20' },
    ]);
  });

  it('skips non-text updates (edits, joins, media without text)', () => {
    const raw = {
      result: [
        { update_id: 1, message: { chat: { id: 5 } } }, // no text
        { update_id: 2, edited_message: { chat: { id: 5 }, text: 'x' } }, // not a fresh message
        { update_id: 3, message: { chat: { id: 9 }, text: 'hi' } },
      ],
    };
    expect(toUpdates(raw)).toEqual([{ updateId: 3, chatId: 9, text: 'hi' }]);
  });

  it('maps an inline button tap (callback query) to an update (ADR-0028)', () => {
    const raw = {
      result: [
        {
          update_id: 20,
          callback_query: { id: 'cq1', data: 'fb', message: { chat: { id: 5 } } },
        },
      ],
    };
    expect(toUpdates(raw)).toEqual([
      { updateId: 20, chatId: 5, text: '', callbackData: 'fb', callbackQueryId: 'cq1' },
    ]);
  });

  it('tolerates a missing or empty result', () => {
    expect(toUpdates({})).toEqual([]);
    expect(toUpdates({ result: [] })).toEqual([]);
  });
});

describe('maxUpdateId (ADR-0051)', () => {
  it('returns the highest raw update_id incl. updates that map to nothing', () => {
    // update 6 is a sticker (no text) — dropped by toUpdates but must still count.
    const raw = { result: [
      { update_id: 5, message: { chat: { id: 1 }, text: 'hi' } },
      { update_id: 6, message: { chat: { id: 1 }, sticker: {} } },
    ] };
    expect(toUpdates(raw)).toHaveLength(1); // only the text one maps
    expect(maxUpdateId(raw)).toBe(6);       // but the offset must advance past 6
  });

  it('is null on an empty or malformed batch', () => {
    expect(maxUpdateId({ result: [] })).toBeNull();
    expect(maxUpdateId({})).toBeNull();
  });
});

describe('BotApiTransport (fetch contract)', () => {
  it('getUpdates long-polls with the offset, timeout, and an abort signal outlasting the server wait', async () => {
    const { impl, calls } = fakeFetch({
      ok: true,
      result: [{ update_id: 41, message: { chat: { id: 5 }, text: 'hi' } }],
    });
    const t = new BotApiTransport({ token: 'TOK', fetchImpl: impl });

    const batch = await t.getUpdates(42, 30);

    expect(calls[0]?.url).toBe('https://api.telegram.org/botTOK/getUpdates');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      offset: 42,
      timeout: 30,
      allowed_updates: ['message', 'callback_query'],
    });
    // The client abort must outlast the 30s server-side hold, or every quiet
    // long-poll would abort early.
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.init.signal?.aborted).toBe(false);
    expect(batch).toEqual({
      updates: [{ updateId: 41, chatId: 5, text: 'hi' }],
      ackOffset: 42,
    });
  });

  it('sendMessage posts the chat id and text as JSON, attaching buttons as an inline keyboard', async () => {
    const { impl, calls } = fakeFetch();
    const t = new BotApiTransport({ token: 'TOK', fetchImpl: impl });

    await t.sendMessage(7, 'hello', { buttons: [{ text: 'A', data: 'a' }] });

    expect(calls[0]?.url).toBe('https://api.telegram.org/botTOK/sendMessage');
    expect(calls[0]?.init.method).toBe('POST');
    expect(new Headers(calls[0]?.init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      chat_id: 7,
      text: 'hello',
      reply_markup: { inline_keyboard: [[{ text: 'A', callback_data: 'a' }]] },
    });
  });

  it('throws on a non-OK response, naming the failing method and status', async () => {
    const impl = (async () => new Response('nope', { status: 403 })) as unknown as typeof fetch;
    const t = new BotApiTransport({ token: 'TOK', fetchImpl: impl });
    await expect(t.sendMessage(7, 'hello')).rejects.toThrow('telegram sendMessage 403');
  });
});
