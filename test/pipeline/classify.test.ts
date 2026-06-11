import { describe, expect, it } from 'vitest';
import { classify } from '../../src/pipeline/classify.js';
import { FakeLLM } from '../helpers/fake-llm.js';
import type { RawItem, SourceMetadata } from '../../src/domain/types.js';

function item(metadata: SourceMetadata): RawItem {
  return {
    source: 'hackernews',
    externalId: '1',
    title: 'Something happened',
    url: null,
    text: null,
    publishedAt: null,
    metadata,
  };
}

describe('classify stage', () => {
  it('uses source metadata when present, without calling the LLM', async () => {
    const llm = new FakeLLM();
    const [classified] = await classify(
      [item({ region: 'Israel', topic: 'Politics' })],
      llm,
    );

    expect(classified?.region).toBe('Israel');
    expect(classified?.topic).toBe('Politics');
    expect(llm.classifyCalls).toBe(0);
  });

  it('falls back to the LLM when metadata is missing', async () => {
    const llm = new FakeLLM({ classify: { region: 'World', topic: 'AI' } });
    const [classified] = await classify([item({})], llm);

    expect(classified?.region).toBe('World');
    expect(classified?.topic).toBe('AI');
    expect(llm.classifyCalls).toBe(1);
  });
});
