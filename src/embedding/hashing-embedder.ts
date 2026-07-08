import type { Embedder } from './embedder.js';

/**
 * A lightweight, dependency-free Embedder (the Embedder seam, ADR-0007). Hashes
 * character trigrams into a fixed-width, L2-normalized vector. No model
 * download, no native build — runs anywhere and on any Node. Quality is lower
 * than a neural model; it's the offline/zero-cost fallback behind the wired
 * neural `OpenAIEmbedder` (ADR-0018/0035), and the seam lets any other neural
 * adapter replace it with zero pipeline changes.
 */
export class HashingEmbedder implements Embedder {
  readonly dimensions: number;

  constructor(dimensions = 256) {
    this.dimensions = dimensions;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    return texts.map((t) => this.vectorize(t));
  }

  private vectorize(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    const normalized = ` ${text.toLowerCase().replace(/\s+/g, ' ').trim()} `;

    for (let i = 0; i + 3 <= normalized.length; i += 1) {
      const trigram = normalized.slice(i, i + 3);
      const bucket = hash(trigram) % this.dimensions;
      vec[bucket] = (vec[bucket] ?? 0) + 1;
    }

    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    return norm === 0 ? vec : vec.map((x) => x / norm);
  }
}

/** FNV-1a — a fast, stable, non-cryptographic string hash. */
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
