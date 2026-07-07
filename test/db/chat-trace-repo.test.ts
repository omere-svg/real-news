import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { DrizzleChatTraceRepo } from '../../src/db/chat-trace-repo.js';

const step = (n: number, tool: string) => ({
  step: n,
  tool,
  args: '{"query":"x"}',
  resultPreview: 'result',
});

describe('DrizzleChatTraceRepo (ADR-0053)', () => {
  it('records and reads back a trace, newest first, question clamped', async () => {
    const repo = new DrizzleChatTraceRepo(await createTestDb());
    await repo.record({
      createdAt: 1000,
      question: 'q'.repeat(500),
      steps: [step(1, 'search_stories'), step(2, 'web_search')],
      answeredFromNews: true,
    });
    await repo.record({ createdAt: 2000, question: 'later', steps: [], answeredFromNews: false });

    const traces = await repo.recent(10);
    expect(traces).toHaveLength(2);
    expect(traces[0]?.question).toBe('later');
    expect(traces[1]?.question).toHaveLength(300); // clamped at the writer
    expect(traces[1]?.steps.map((s) => s.tool)).toEqual(['search_stories', 'web_search']);
    expect(traces[1]?.answeredFromNews).toBe(true);
  });

  it('pruneToRecent keeps only the newest traces', async () => {
    const repo = new DrizzleChatTraceRepo(await createTestDb());
    for (let i = 0; i < 5; i += 1) {
      await repo.record({ createdAt: i, question: `q${i}`, steps: [], answeredFromNews: false });
    }
    expect(await repo.pruneToRecent(2)).toBe(3);
    expect((await repo.recent(10)).map((t) => t.question)).toEqual(['q4', 'q3']);
  });
});
