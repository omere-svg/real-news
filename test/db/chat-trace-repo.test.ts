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
  it('records and reads back a trace, newest first, question redacted to a preview', async () => {
    const repo = new DrizzleChatTraceRepo(await createTestDb());
    await repo.record({
      createdAt: 1000,
      question: 'q'.repeat(500),
      steps: [step(1, 'search_stories'), step(2, 'web_search')],
      answeredFromNews: true,
      plan: 'search then answer',
      path: 'agent',
    });
    await repo.record({
      createdAt: 2000, question: 'later', steps: [], answeredFromNews: false, plan: '', path: 'fallback',
    });

    const traces = await repo.recent(10);
    expect(traces).toHaveLength(2);
    expect(traces[0]?.question).toBe('later');
    // Never the verbatim question — only an 80-char preview (ADR-0053 privacy).
    expect(traces[1]?.question).toHaveLength(80);
    expect(traces[1]?.question.endsWith('…')).toBe(true);
    expect(traces[1]?.steps.map((s) => s.tool)).toEqual(['search_stories', 'web_search']);
    expect(traces[1]?.answeredFromNews).toBe(true);
  });

  it('never stores the full question when it exceeds the preview length', async () => {
    const repo = new DrizzleChatTraceRepo(await createTestDb());
    const question = 'q'.repeat(300);
    await repo.record({ createdAt: 1000, question, steps: [], answeredFromNews: false, plan: '', path: 'agent' });

    const [trace] = await repo.recent(10);
    expect(trace?.question).not.toBe(question);
    expect(trace?.question.length).toBeLessThanOrEqual(80);
  });

  it('pruneToRecent keeps only the newest traces', async () => {
    const repo = new DrizzleChatTraceRepo(await createTestDb());
    for (let i = 0; i < 5; i += 1) {
      await repo.record({
        createdAt: i, question: `q${i}`, steps: [], answeredFromNews: false, plan: '', path: 'agent',
      });
    }
    expect(await repo.pruneToRecent(2)).toBe(3);
    expect((await repo.recent(10)).map((t) => t.question)).toEqual(['q4', 'q3']);
  });

  it('persists the plan and path fields (rubric plan→act→observe, ADR-0053)', async () => {
    const repo = new DrizzleChatTraceRepo(await createTestDb());
    await repo.record({
      createdAt: 1000,
      question: 'q',
      steps: [{ step: 0, tool: 'plan', args: '', resultPreview: 'search then answer' }],
      answeredFromNews: true,
      plan: 'search then answer',
      path: 'agent',
    });
    await repo.record({
      createdAt: 2000, question: 'q2', steps: [], answeredFromNews: false, plan: '', path: 'fallback',
    });

    const [fallback, agent] = await repo.recent(10);
    expect(fallback?.path).toBe('fallback');
    expect(fallback?.plan).toBe('');
    expect(agent?.path).toBe('agent');
    expect(agent?.plan).toBe('search then answer');
    expect(agent?.steps[0]).toEqual({ step: 0, tool: 'plan', args: '', resultPreview: 'search then answer' });
  });
});
