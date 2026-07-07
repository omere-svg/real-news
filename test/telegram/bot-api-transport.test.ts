import { describe, expect, it } from 'vitest';
import {
  toInlineKeyboard,
  toUpdates,
  maxUpdateId,
  splitForTelegram,
} from '../../src/telegram/bot-api-transport.js';

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
