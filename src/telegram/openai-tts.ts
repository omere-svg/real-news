import OpenAI from 'openai';
import type { Synthesizer } from './synthesizer.js';

export interface OpenAITTSDeps {
  /** TTS model, e.g. `gpt-4o-mini-tts` (ADR-0020). */
  readonly model: string;
  /** Voice id, e.g. `alloy`. */
  readonly voice: string;
  /** Injectable for testing; defaults to a real client reading OPENAI_API_KEY. */
  readonly client?: OpenAI;
}

/**
 * Text-to-speech backed by the OpenAI speech API (ADR-0020). Renders a narrated
 * podcast script to mp3 bytes. Wrap in `ResilientSynthesizer` so a TTS failure
 * degrades to a text podcast instead of a failed reply.
 */
export class OpenAITTS implements Synthesizer {
  private readonly client: OpenAI;

  constructor(private readonly deps: OpenAITTSDeps) {
    this.client =
      deps.client ??
      new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? 'missing' });
  }

  async synthesize(text: string): Promise<Buffer> {
    const res = await this.client.audio.speech.create({
      model: this.deps.model,
      voice: this.deps.voice,
      input: text,
      response_format: 'mp3',
    });
    return Buffer.from(await res.arrayBuffer());
  }
}
