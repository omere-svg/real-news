/**
 * End-to-end verification of the Telegram bot (ADR-0019/0020) WITHOUT a live
 * Telegram token: it drives the real `HorizonBot` through a capturing transport
 * that stands in for Telegram, against the real `QueryEngine` (real OpenAI
 * reasoner) and real `OpenAITTS`. Seeds a small Story cache, runs each command,
 * prints the replies, and writes the podcast audio to disk for inspection.
 *
 * Run:  node --env-file=.env --import tsx scripts/verify-bot.ts
 * Needs OPENAI_API_KEY. Makes real (small) OpenAI calls; not part of `npm test`.
 */
import { writeFileSync } from 'node:fs';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { openDb } from '../src/db/client.js';
import { DrizzleStoryRepo } from '../src/db/story-repo.js';
import { DrizzleChatPreferencesRepo } from '../src/db/chat-preferences-repo.js';
import { DrizzleUsageRepo } from '../src/db/usage-repo.js';
import { FixedWindowLimiter } from '../src/telegram/rate-limiter.js';
import { systemClock } from '../src/scheduler/clock.js';
import { HorizonQuery } from '../src/presentation/horizon-query.js';
import { Reasoner } from '../src/llm/reasoner.js';
import { OpenAITransport } from '../src/llm/openai-transport.js';
import { ResilientLLMClient } from '../src/llm/resilient-llm-client.js';
import { OpenAITTS } from '../src/telegram/openai-tts.js';
import { ResilientSynthesizer } from '../src/telegram/resilient-synthesizer.js';
import { HorizonBot } from '../src/telegram/horizon-bot.js';
import type {
  SendAudioOptions,
  TelegramTransport,
  TelegramUpdate,
} from '../src/telegram/telegram-transport.js';
import type { StoryUpsert } from '../src/db/story-repo.js';

const AUDIO_OUT = '/tmp/horizon-podcast.mp3';
const CHAT = 1;

/** Records what the bot would send to Telegram; writes audio to disk. */
class CapturingTransport implements TelegramTransport {
  lastText = '';
  lastAudioBytes = 0;
  async sendMessage(_chatId: number, text: string): Promise<void> {
    this.lastText = text;
    console.log('\n  ↳ MESSAGE:\n' + text.split('\n').map((l) => '     ' + l).join('\n'));
  }
  async sendAudio(_chatId: number, audio: Buffer, opts?: SendAudioOptions): Promise<void> {
    this.lastAudioBytes = audio.length;
    writeFileSync(AUDIO_OUT, audio);
    console.log(`\n  ↳ AUDIO: ${audio.length} bytes → ${AUDIO_OUT} (caption: ${opts?.caption ?? '—'})`);
  }
  async getUpdates(): Promise<TelegramUpdate[]> {
    return [];
  }
}

function story(over: Partial<StoryUpsert>): StoryUpsert {
  return {
    id: 'x',
    title: 'A story',
    url: null,
    topic: 'AI',
    significance: 5,
    whyItMatters: null,
    memberRefs: [],
    ...over,
  };
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  const db = openDb(':memory:');
  await migrate(db, { migrationsFolder: './drizzle' });
  const storyRepo = new DrizzleStoryRepo(db, systemClock);
  const prefs = new DrizzleChatPreferencesRepo(db);

  // Seed a realistic Story cache (the bot reads this; no live tick needed).
  const seed: StoryUpsert[] = [
    story({ id: 's1', title: 'Frontier lab ships a new reasoning model', topic: 'AI', significance: 9.1, whyItMatters: 'It resets the cost/quality frontier for agentic apps. Competitors must respond within weeks.', memberRefs: [{ source: 'hackernews', externalId: '1' }] }),
    story({ id: 's2', title: 'Knesset passes contested budget amendment', topic: 'Israel', significance: 7.4, whyItMatters: 'It shifts coalition leverage ahead of the next session.', memberRefs: [{ source: 'knesset', externalId: '2' }] }),
    story({ id: 's3', title: 'Ceasefire talks resume in the region', topic: 'Geopolitics', significance: 8.2, whyItMatters: 'A durable pause would reroute energy and shipping risk premia.', memberRefs: [{ source: 'gdelt', externalId: '3' }] }),
    story({ id: 's4', title: 'Major chipmaker guides revenue sharply higher', topic: 'Business', significance: 6.8, whyItMatters: 'Signals sustained AI capex; ripples through suppliers.', memberRefs: [{ source: 'secedgar', externalId: '4' }] }),
  ];
  for (const s of seed) await storyRepo.upsert(s);

  const llm = new ResilientLLMClient(
    new Reasoner(new OpenAITransport({ cheapModel: 'gpt-4o-mini', deepModel: 'gpt-4o' })),
  );
  const query = new HorizonQuery({
    storyRepo,
    llm,
    params: {
      textWordsPerMinute: 220,
      audioWordsPerMinute: 150,
      wordCost: { headline: 18, brief: 45, full: 95 },
      minDepth: 'full',
      minStories: 3,
      maxStories: 12,
      candidatePool: 200,
    },
  });
  const synthesizer = new ResilientSynthesizer(
    new OpenAITTS({ model: 'gpt-4o-mini-tts', voice: 'alloy' }),
  );
  const transport = new CapturingTransport();
  const bot = new HorizonBot({
    transport,
    query,
    feedback: llm, // /feedback uses the real Reasoner (ADR-0026)
    prefs,
    usage: new DrizzleUsageRepo(db),
    clock: systemClock,
    limiter: new FixedWindowLimiter(1000, 60_000),
    limits: {
      perMinute: 1000,
      podcastPerDay: 1000,
      commandsPerDay: 1000,
      globalPodcastPerDay: 1000,
      globalCommandsPerDay: 10_000,
    },
    maxMinutes: 60,
    synthesizer,
    defaults: { minutes: 3 },
    openAccess: true,
  });

  const checks: { name: string; ok: boolean; note: string }[] = [];
  const run = async (text: string, label: string) => {
    console.log(`\n━━ ${label}: "${text}" ━━`);
    await bot.handle({ updateId: 1, chatId: CHAT, text });
  };

  await run('/start', 'help');
  // /start shows the tap-to-run menu (ADR-0030): assert the Brief affordance, not a slash command.
  checks.push({ name: 'help shows the menu', ok: /Brief/.test(transport.lastText), note: '' });

  await run('/prefs topics AI,Geopolitics', 'set topics');
  const saved = await prefs.get(CHAT);
  checks.push({ name: 'topics persisted', ok: JSON.stringify(saved?.topics) === JSON.stringify(['AI', 'Geopolitics']), note: JSON.stringify(saved?.topics) });

  await run('/brief 3', 'brief (budgeted, prefs-filtered)');
  const briefOk = transport.lastText.includes('Frontier lab') && !transport.lastText.includes('Knesset'); // Politics filtered out
  checks.push({ name: 'brief respects topic prefs + budget', ok: briefOk, note: '' });

  await run('/outline AI', 'outline');
  checks.push({ name: 'outline returns AI section', ok: transport.lastText.includes('AI outline'), note: '' });

  await run('/outline Weather', 'invalid topic');
  checks.push({ name: 'invalid topic rejected', ok: /topic/i.test(transport.lastText), note: '' });

  await run('/podcast 1', 'podcast → real TTS audio');
  const audioOk = transport.lastAudioBytes > 1000;
  checks.push({ name: 'podcast delivered audio (mp3)', ok: audioOk, note: `${transport.lastAudioBytes} bytes` });

  // Free-text feedback → real Reasoner intent → persisted preference weights (ADR-0026).
  await run('/feedback love the AI coverage, hide sports entirely', 'feedback → weights');
  const afterFb = await prefs.get(CHAT);
  const fbOk = (afterFb?.topicWeights?.AI ?? 0) > 1 && afterFb?.topicWeights?.Sports === 0;
  checks.push({ name: 'feedback set AI↑ and muted Sports', ok: fbOk, note: JSON.stringify(afterFb?.topicWeights) });

  await run('/feedback undo', 'feedback undo');
  const afterUndo = await prefs.get(CHAT);
  checks.push({ name: 'undo reverted the weights', ok: afterUndo?.topicWeights?.AI === undefined, note: JSON.stringify(afterUndo?.topicWeights) });

  console.log('\n\n════════ RESULT ════════');
  let allOk = true;
  for (const c of checks) {
    allOk = allOk && c.ok;
    console.log(`${c.ok ? '✅' : '❌'} ${c.name}${c.note ? ` (${c.note})` : ''}`);
  }
  console.log(allOk ? '\n🎉 ALL E2E CHECKS PASSED' : '\n⚠️  SOME CHECKS FAILED');
  if (!allOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error('verify-bot failed:', err);
  process.exit(1);
});
