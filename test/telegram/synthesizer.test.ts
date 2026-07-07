import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { OpenAITTS, clampForTts } from '../../src/telegram/openai-tts.js';
import { ResilientSynthesizer } from '../../src/telegram/resilient-synthesizer.js';
import type { Synthesizer } from '../../src/telegram/synthesizer.js';

describe('OpenAITTS', () => {
  it('returns the synthesized audio bytes and passes model/voice/input', async () => {
    const create = vi.fn().mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    const client = { audio: { speech: { create } } } as unknown as OpenAI;
    const tts = new OpenAITTS({ model: 'gpt-4o-mini-tts', voice: 'alloy', client });

    const audio = await tts.synthesize('hello world');

    expect(audio).toEqual(Buffer.from([1, 2, 3]));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'hello world' }),
    );
  });

  it('clamps an over-long script to the TTS char limit before the API call (ADR-0049)', async () => {
    const create = vi.fn().mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1]).buffer });
    const client = { audio: { speech: { create } } } as unknown as OpenAI;
    const long = ('This is a sentence. '.repeat(400)); // ~8000 chars
    await new OpenAITTS({ model: 'm', voice: 'v', client }).synthesize(long);
    const sent = (create.mock.calls[0]?.[0] as { input: string }).input;
    expect(sent.length).toBeLessThanOrEqual(4000);
    expect(sent.endsWith('.')).toBe(true); // cut at a sentence boundary
  });

  it('reports the billed character count to onUsage', async () => {
    const create = vi.fn().mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1]).buffer });
    const client = { audio: { speech: { create } } } as unknown as OpenAI;
    const onUsage = vi.fn();
    const tts = new OpenAITTS({ model: 'm', voice: 'v', client, onUsage });

    await tts.synthesize('hello world');

    expect(onUsage).toHaveBeenCalledWith({ characters: 'hello world'.length });
  });

  it('reports the clamped (billed), not the original, character count', async () => {
    const create = vi.fn().mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1]).buffer });
    const client = { audio: { speech: { create } } } as unknown as OpenAI;
    const onUsage = vi.fn();
    const long = 'This is a sentence. '.repeat(400);
    const tts = new OpenAITTS({ model: 'm', voice: 'v', client, onUsage });

    await tts.synthesize(long);

    const sent = (create.mock.calls[0]?.[0] as { input: string }).input;
    expect(onUsage).toHaveBeenCalledWith({ characters: sent.length });
  });
});

describe('clampForTts', () => {
  it('leaves a short script untouched', () => {
    expect(clampForTts('short')).toBe('short');
  });
  it('truncates a long script at a sentence boundary under the cap', () => {
    const out = clampForTts('A. '.repeat(3000), 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith('.')).toBe(true);
  });
});

describe('ResilientSynthesizer', () => {
  it('passes audio through when the delegate succeeds', async () => {
    const delegate: Synthesizer = { synthesize: async () => Buffer.from([9]) };
    expect(await new ResilientSynthesizer(delegate).synthesize('x')).toEqual(Buffer.from([9]));
  });

  it('returns null when the delegate throws (caller falls back to text)', async () => {
    const onError = vi.fn();
    const delegate: Synthesizer = {
      synthesize: async () => {
        throw new Error('tts down');
      },
    };
    expect(await new ResilientSynthesizer(delegate, onError).synthesize('x')).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });
});
