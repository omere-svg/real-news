/**
 * The text-to-speech seam (ADR-0020). Renders a podcast script to audio bytes.
 * Returns null when synthesis is unavailable or fails, so the caller can fall
 * back to sending the script as text.
 */
export interface Synthesizer {
  /** Render text to audio (mp3) bytes, or null on failure/unavailability. */
  synthesize(text: string): Promise<Buffer | null>;
}
