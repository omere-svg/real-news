import { describe, expect, it } from 'vitest';
import { ChatGrounding } from '../../src/telegram/chat-grounding.js';
import type { StoryReader } from '../../src/telegram/horizon-bot.js';
import type { Story } from '../../src/domain/types.js';
import type { SemanticQuery } from '../../src/db/story-repo.js';
import { FakeEmbedder } from '../helpers/fake-embedder.js';

function story(id: string, over: Partial<Story> = {}): Story {
  return {
    id, title: id, url: null, topic: 'AI', significance: 5,
    summary: null, whyItMatters: null, displayTitle: null, scoreBreakdown: null, memberRefs: [],
    firstSeenAt: 0, updatedAt: 0, ...over,
  };
}

describe('ChatGrounding (ADR-0052)', () => {
  it('uses semantic search when an embedder + reader are wired', async () => {
    let semanticCalled = false;
    const reader: StoryReader = {
      topStories: async () => [story('top')],
      semanticSearch: async (_q: SemanticQuery) => { semanticCalled = true; return [story('relevant')]; },
    };
    const g = new ChatGrounding(reader, new FakeEmbedder({ 'what happened?': [1, 0, 0] }), undefined);
    const out = await g.stories(null, 'what happened?');
    expect(semanticCalled).toBe(true);
    expect(out.map((s) => s.title)).toEqual(['relevant']);
  });

  it('falls back to top-by-significance when nothing clears the similarity floor', async () => {
    const reader: StoryReader = {
      topStories: async () => [story('top')],
      semanticSearch: async () => [], // nothing relevant enough
    };
    const g = new ChatGrounding(reader, new FakeEmbedder({ q: [1, 0, 0] }), undefined);
    expect((await g.stories(null, 'q')).map((s) => s.title)).toEqual(['top']);
  });

  it('grounds on top stories when no embedder is wired', async () => {
    const reader: StoryReader = { topStories: async () => [story('top')] };
    const g = new ChatGrounding(reader, undefined, undefined);
    expect((await g.stories(null, 'anything')).map((s) => s.title)).toEqual(['top']);
  });
});
