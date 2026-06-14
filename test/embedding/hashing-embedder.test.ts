import { describe, expect, it } from 'vitest';
import { HashingEmbedder } from '../../src/embedding/hashing-embedder.js';

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe('HashingEmbedder', () => {
  it('produces vectors of the configured dimensionality', async () => {
    const embedder = new HashingEmbedder(64);
    const [v] = await embedder.embed(['hello world']);
    expect(v).toHaveLength(64);
    expect(embedder.dimensions).toBe(64);
  });

  it('is deterministic — same text yields the same vector', async () => {
    const embedder = new HashingEmbedder();
    const [a] = await embedder.embed(['breaking news today']);
    const [b] = await embedder.embed(['breaking news today']);
    expect(a).toEqual(b);
  });

  it('scores similar texts more alike than dissimilar ones', async () => {
    const embedder = new HashingEmbedder();
    const [quake1, quake2, market] = await embedder.embed([
      'earthquake strikes northern region',
      'earthquake hits northern region',
      'stock market rallies on tech earnings',
    ]);

    expect(cosine(quake1!, quake2!)).toBeGreaterThan(cosine(quake1!, market!));
  });
});
