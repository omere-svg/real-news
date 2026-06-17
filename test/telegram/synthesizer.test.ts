import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { OpenAITTS } from '../../src/telegram/openai-tts.js';
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
