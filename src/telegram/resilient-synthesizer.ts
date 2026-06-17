import type { Synthesizer } from './synthesizer.js';

/**
 * Wraps a Synthesizer so a TTS failure degrades to null (ADR-0020) — the bot
 * then sends the podcast as text. Same "degrade, don't crash" hygiene as
 * ResilientLLMClient / ResilientEmbedder (ADR-0001).
 */
export class ResilientSynthesizer implements Synthesizer {
  constructor(
    private readonly delegate: Synthesizer,
    private readonly onError: (op: string, err: unknown) => void = (op, err) =>
      console.warn(`[tts] ${op} failed, sending text:`, err),
  ) {}

  async synthesize(text: string): Promise<Buffer | null> {
    try {
      return await this.delegate.synthesize(text);
    } catch (err) {
      this.onError('synthesize', err);
      return null;
    }
  }
}
