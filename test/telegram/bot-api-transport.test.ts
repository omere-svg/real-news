import { describe, expect, it } from 'vitest';
import { toUpdates, splitForTelegram } from '../../src/telegram/bot-api-transport.js';

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

  it('tolerates a missing or empty result', () => {
    expect(toUpdates({})).toEqual([]);
    expect(toUpdates({ result: [] })).toEqual([]);
  });
});
