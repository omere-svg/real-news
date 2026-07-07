import OpenAI from 'openai';
import type { Synthesizer } from './synthesizer.js';

/** One synthesize call's billed size, reported for accounting (TokenLedger, Task 15).
 * TTS bills per character, not per token — the ledger stores it in the same
 * per-tier counter shape, using this count as its "token" unit. */
export interface TtsUsageReport {
  readonly characters: number;
}

export interface OpenAITTSDeps {
  /** TTS model (ADR-0020). */
  readonly model: string;
  /** Voice id, e.g. `alloy`. */
  readonly voice: string;
  /** Injectable for testing; defaults to a real client reading OPENAI_API_KEY. */
  readonly client?: OpenAI;
  /**
   * Fires once per call with the billed (post-clamp) character count, so the
   * composition root can account spend without this synthesizer knowing about
   * ledgers. Must not throw; omitted ⇒ no accounting.
   */
  readonly onUsage?: (usage: TtsUsageReport) => void;
}

/**
 * The OpenAI speech API rejects an `input` longer than 4096 characters. A
 * podcast script at maxPodcastMinutes (20) × 150 wpm is ~17k chars, so without
 * a clamp the call 400s and the resilient wrapper degrades to text — after the
 * scarce podcast quota was already spent (ADR-0049). Truncate at a sentence
 * boundary just under the limit so long podcasts still deliver audio.
 */
const TTS_MAX_CHARS = 4000;

export function clampForTts(text: string, max = TTS_MAX_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const lastStop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  return lastStop > max * 0.5 ? head.slice(0, lastStop + 1) : head;
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
    const input = clampForTts(text);
    const res = await this.client.audio.speech.create({
      model: this.deps.model,
      voice: this.deps.voice,
      input,
      response_format: 'mp3',
    });
    this.deps.onUsage?.({ characters: input.length });
    return Buffer.from(await res.arrayBuffer());
  }
}
