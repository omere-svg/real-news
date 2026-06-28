import { chmodSync, mkdirSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { migrate } from 'drizzle-orm/libsql/migrator';
import {
  loadConfig,
  toPresentationDefaults,
  toQueryParams,
  toTickConfig,
} from './config/load.js';
import { openDb } from './db/client.js';
import { DrizzleRawItemRepo } from './db/raw-item-repo.js';
import { DrizzleStoryRepo } from './db/story-repo.js';
import type { StoryRepo } from './db/story-repo.js';
import { HackerNewsSource } from './sources/hacker-news.js';
import { ArxivSource } from './sources/arxiv.js';
import { GdeltSource } from './sources/gdelt.js';
import { KnessetSource } from './sources/knesset.js';
import { SecEdgarSource } from './sources/sec-edgar.js';
import { WikipediaSource } from './sources/wikipedia.js';
import { RssSource } from './sources/rss-source.js';
import { HfPapersSource } from './sources/hf-papers.js';
import { PsyArxivSource } from './sources/psyarxiv.js';
import { KnessetVotesSource } from './sources/knesset-votes.js';
import { TheSportsDbSource } from './sources/thesportsdb.js';
import { WhoOutbreaksSource } from './sources/who-outbreaks.js';
import { NasaEonetSource } from './sources/nasa-eonet.js';
import { UsgsQuakesSource } from './sources/usgs-quakes.js';
import { WikipediaPageviewsSource } from './sources/wikipedia-pageviews.js';
import { WorldBankSource } from './sources/worldbank.js';
import { CoinGeckoSource } from './sources/coingecko.js';
import { FrankfurterSource } from './sources/frankfurter.js';
import { OpenAlexSource } from './sources/openalex.js';
import { makeFetchJson } from './sources/http.js';
import type { SourceAdapter } from './sources/source-adapter.js';
import type { SignalSource } from './sources/signal-source.js';
import type { JsonFetcher } from './sources/http.js';
import { Reasoner } from './llm/reasoner.js';
import { OpenAITransport } from './llm/openai-transport.js';
import { ResilientLLMClient } from './llm/resilient-llm-client.js';
import type { LLMClient } from './llm/llm-client.js';
import { HashingEmbedder } from './embedding/hashing-embedder.js';
import { OpenAIEmbedder } from './embedding/openai-embedder.js';
import { ResilientEmbedder } from './embedding/resilient-embedder.js';
import type { Embedder } from './embedding/embedder.js';
import { systemClock } from './scheduler/clock.js';
import { TickRunner } from './pipeline/tick-runner.js';
import { backfillSummaries } from './pipeline/backfill-summaries.js';
import { createApp } from './server/app.js';
import { HorizonQuery } from './presentation/horizon-query.js';
import { DrizzleChatPreferencesRepo } from './db/chat-preferences-repo.js';
import { DrizzleUsageRepo } from './db/usage-repo.js';
import { FixedWindowLimiter } from './telegram/rate-limiter.js';
import { BotApiTransport } from './telegram/bot-api-transport.js';
import { OpenAITTS } from './telegram/openai-tts.js';
import { ResilientSynthesizer } from './telegram/resilient-synthesizer.js';
import { HorizonBot } from './telegram/horizon-bot.js';
import { pollOnce } from './telegram/poll.js';
import { TavilyWebSearch } from './web/tavily-web-search.js';
import { ResilientWebSearch } from './web/resilient-web-search.js';
import type { WebSearch } from './web/web-search.js';
import { SIGNAL_SOURCE_IDS } from './domain/types.js';
import type { SignalSourceId, SourceId } from './domain/types.js';
import type { Synthesizer } from './telegram/synthesizer.js';
import type { QueryEngine } from './presentation/query-engine.js';
import type { Db } from './db/client.js';
import type { Config, SourceConfig } from './config/schema.js';

/**
 * Composition root (the only place adapters are wired). Loads config, opens the
 * DB, builds the real adapters behind each seam, runs the tick loop, and serves
 * the read-only viewer. Everything it assembles is unit-tested in isolation.
 */

const CONFIG_PATH = process.env.HORIZON_CONFIG ?? 'config/horizon.yaml';
const DB_URL = process.env.DB_URL ?? 'file:./data/horizon.db';
const PORT = Number(process.env.PORT ?? 3000);
// Bind to localhost by default (ADR-0023); set HOST=0.0.0.0 to expose (behind a proxy).
const HOST = process.env.HOST ?? '127.0.0.1';

/** Signal-source ids (ADR-0025) — routed to buildSignalSource, not the Story pipeline. */
const signalSourceIds = new Set<SourceId>(SIGNAL_SOURCE_IDS);

/** Build the concrete SourceAdapter for one enabled source config. */
function buildSource(s: SourceConfig, fetchJson: JsonFetcher): SourceAdapter | null {
  const base = { fetchJson, maxItems: s.maxItems };
  switch (s.id) {
    case 'hackernews':
      return new HackerNewsSource(base);
    case 'arxiv':
      return new ArxivSource(base);
    case 'gdelt':
      return new GdeltSource(base);
    case 'knesset':
      return new KnessetSource(base);
    case 'secedgar':
      return new SecEdgarSource(base);
    case 'wikipedia':
      return new WikipediaSource({ ...base, clock: systemClock });
    // Phase 4 — media + thematic anchors (ADR-0021).
    case 'guardian':
      return new RssSource({ ...base, id: 'guardian', feedUrl: 'https://www.theguardian.com/world/rss', topic: 'Geopolitics' });
    case 'timesofisrael':
      return new RssSource({ ...base, id: 'timesofisrael', feedUrl: 'https://www.timesofisrael.com/feed/', topic: 'Israel' });
    case 'nber':
      return new RssSource({ ...base, id: 'nber', feedUrl: 'https://back.nber.org/rss/new.xml', topic: 'Business' });
    case 'nature':
      return new RssSource({ ...base, id: 'nature', feedUrl: 'https://www.nature.com/nature.rss', topic: 'Science' });
    case 'hf-papers':
      return new HfPapersSource(base);
    case 'psyarxiv':
      return new PsyArxivSource(base);
    case 'knesset-votes':
      return new KnessetVotesSource(base);
    // ADR-0031 — keyless wave: Sports, Health, Climate.
    case 'thesportsdb':
      return new TheSportsDbSource({ ...base, clock: systemClock });
    case 'who-outbreaks':
      return new WhoOutbreaksSource(base);
    case 'nasa-eonet':
      return new NasaEonetSource(base);
    case 'usgs-quakes':
      return new UsgsQuakesSource(base);
    case 'gdacs':
      return new RssSource({ ...base, id: 'gdacs', feedUrl: 'https://www.gdacs.org/xml/rss.xml', topic: 'Climate' });
    default:
      console.warn(`[horizon] source "${s.id}" has no adapter yet — skipping.`);
      return null;
  }
}

/** Build the Embedder seam from config — neural with a hashing fallback (ADR-0018). */
function buildEmbedder(config: Config): Embedder {
  const { provider, model, dimensions } = config.embedder;
  const hashing = new HashingEmbedder(dimensions);
  if (provider === 'hashing') return hashing;
  return new ResilientEmbedder(
    new OpenAIEmbedder({ model, dimensions }),
    hashing,
  );
}

function buildSources(config: Config, fetchJson: JsonFetcher): SourceAdapter[] {
  return (config.sources as SourceConfig[])
    .filter((s) => s.enabled && !signalSourceIds.has(s.id))
    .map((s) => buildSource(s, fetchJson))
    .filter((a): a is SourceAdapter => a !== null);
}

/**
 * Build the concrete SignalSource for one enabled signal config (ADR-0025). The
 * `id` is a `SignalSourceId` (the caller filters on `signalSourceIds`), so the
 * switch is exhaustive — a new Signal source without a builder is a compile error.
 */
function buildSignalSource(id: SignalSourceId, s: SourceConfig, fetchJson: JsonFetcher): SignalSource {
  const base = { fetchJson, maxItems: s.maxItems, clock: systemClock };
  switch (id) {
    case 'wikipedia-pageviews':
      return new WikipediaPageviewsSource(base);
    case 'worldbank':
      return new WorldBankSource(base);
    // ADR-0031 — keyless wave: Business + Science signal depth.
    case 'coingecko':
      return new CoinGeckoSource(base);
    case 'frankfurter':
      return new FrankfurterSource(base);
    case 'openalex':
      return new OpenAlexSource(base);
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function buildSignalSources(config: Config, fetchJson: JsonFetcher): SignalSource[] {
  return (config.sources as SourceConfig[])
    .filter((s) => s.enabled && signalSourceIds.has(s.id))
    .map((s) => buildSignalSource(s.id as SignalSourceId, s, fetchJson));
}

async function main(): Promise<void> {
  const config = loadConfig(CONFIG_PATH);

  if (DB_URL.startsWith('file:')) mkdirSync('./data', { recursive: true });
  const db = openDb(DB_URL, process.env.DB_AUTH_TOKEN);
  await migrate(db, { migrationsFolder: './drizzle' });

  // Restrict the local DB (cache + chat preferences) to the owner (ADR-0023).
  if (DB_URL.startsWith('file:')) {
    try {
      chmodSync(DB_URL.slice('file:'.length), 0o600);
    } catch (err) {
      console.warn('[horizon] could not chmod the DB file:', err);
    }
  }

  const rawItemRepo = new DrizzleRawItemRepo(db);
  const storyRepo = new DrizzleStoryRepo(db, systemClock);

  const llm = new ResilientLLMClient(
    new Reasoner(
      new OpenAITransport({
        cheapModel: config.reasoner.cheapModel,
        deepModel: config.reasoner.deepModel,
      }),
    ),
  );

  const queryEngine = new HorizonQuery({
    storyRepo,
    llm,
    params: toQueryParams(config),
  });

  const fetchJson = makeFetchJson(fetch, {
    timeoutMs: config.http.fetchTimeoutMs,
    maxBytes: config.http.maxResponseBytes,
  });
  const runner = new TickRunner({
    sources: buildSources(config, fetchJson),
    signalSources: buildSignalSources(config, fetchJson),
    rawItemRepo,
    storyRepo,
    llm,
    embedder: buildEmbedder(config),
    clock: systemClock,
    config: toTickConfig(config),
  });

  const runTick = async (): Promise<void> => {
    try {
      const report = await runner.run();
      console.log(
        `[tick] extracted=${report.extracted} stories=${report.storiesUpserted} ` +
          `signals=${report.signalsObserved} ` +
          `skipped=[${report.skipped}] failed=[${report.failed.map((f) => f.source)}]`,
      );
    } catch (err) {
      console.error('[tick] failed:', err); // never let a bad tick kill the loop
    }
  };

  // First tick on boot, then every X minutes (ADR-0001).
  void runTick();
  setInterval(() => void runTick(), config.tickIntervalMinutes * 60_000);

  // Self-heal cached Stories that lack a factual summary (e.g. created before the
  // field existed, or never top-N) — in the background, most-significant first, so
  // the brief fixes itself after a restart without a manual backfill (ADR-0006).
  if (config.reasoner.backfillOnBoot) {
    void backfillSummaries(
      { storyRepo, rawItemRepo, llm },
      {
        max: config.reasoner.backfillMaxOnBoot,
        onProgress: (done, total) => {
          if (done === 1) console.log(`[backfill] healing ${total} stories missing a summary…`);
          if (done === total) console.log(`[backfill] done: ${total} stories updated.`);
        },
      },
    ).catch((err) => console.error('[backfill] failed:', err));
  }

  const defaults = toPresentationDefaults(config);
  const app = createApp(storyRepo, queryEngine, defaults, {
    maxMinutes: config.presentation.maxMinutes,
    podcastEnabled: config.presentation.webPodcastEnabled,
  });
  serve({ fetch: app.fetch, port: PORT, hostname: HOST });
  console.log(`[horizon] viewer on http://${HOST}:${PORT} (tick every ${config.tickIntervalMinutes}m)`);

  if (config.telegram.enabled) startTelegramBot(config, db, queryEngine, defaults, llm, storyRepo);
}

/** Build the web-search fallback for chat (ADR-0029), or null when off / unkeyed. */
function buildWebSearch(config: Config): WebSearch | null {
  const ws = config.telegram.chat.webSearch;
  if (ws.provider !== 'tavily') return null;
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn('[telegram] chat.webSearch=tavily but TAVILY_API_KEY is missing — staying cache-only.');
    return null;
  }
  return new ResilientWebSearch(
    new TavilyWebSearch({ apiKey, maxResults: ws.maxResults }),
  );
}

/** Start the Telegram bot long-poll loop (ADR-0019), if enabled and tokened. */
function startTelegramBot(
  config: Config,
  db: Db,
  query: QueryEngine,
  defaults: ReturnType<typeof toPresentationDefaults>,
  llm: LLMClient,
  storyRepo: StoryRepo,
): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[telegram] enabled but TELEGRAM_BOT_TOKEN is missing — skipping.');
    return;
  }

  const tg = config.telegram;
  if (tg.allowedChatIds.length === 0 && !tg.openAccess) {
    console.warn(
      '[telegram] no allowedChatIds and openAccess=false — the bot will ignore ALL chats. ' +
        'Add your chat id to telegram.allowedChatIds (ADR-0022).',
    );
  }

  const tts = tg.tts;
  const synthesizer: Synthesizer | null = tts.enabled
    ? new ResilientSynthesizer(new OpenAITTS({ model: tts.model, voice: tts.voice }))
    : null;

  // Chat about the news (ADR-0029): wired only when enabled; web search stays
  // off unless explicitly configured and keyed (Principle 4).
  const chat = tg.chat.enabled;
  const webSearch = chat ? buildWebSearch(config) : null;

  const transport = new BotApiTransport({ token });
  const bot = new HorizonBot({
    transport,
    query,
    feedback: llm, // /feedback interpretation reuses the Reasoner (ADR-0026)
    // NL routing + plain-language preference edits reuse the Reasoner (ADR-0030).
    ...(tg.naturalLanguage ? { router: llm, prefsInterpreter: llm } : {}),
    ...(chat ? { discussant: llm, storyRepo } : {}), // chat reuses the Reasoner (ADR-0029)
    ...(webSearch ? { webSearch } : {}),
    prefs: new DrizzleChatPreferencesRepo(db),
    usage: new DrizzleUsageRepo(db),
    clock: systemClock,
    limiter: new FixedWindowLimiter(tg.limits.perMinute, 60_000),
    limits: tg.limits,
    maxMinutes: config.presentation.maxMinutes,
    synthesizer,
    defaults,
    allowedChatIds: tg.allowedChatIds,
    openAccess: tg.openAccess,
  });

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const loop = async (): Promise<void> => {
    let offset = 0;
    for (;;) {
      try {
        offset = await pollOnce(transport, bot, offset, config.telegram.pollTimeoutSeconds);
      } catch (err) {
        console.error('[telegram] poll failed, retrying:', err); // never kill the loop
        await sleep(2000);
      }
    }
  };
  void loop();
  console.log('[telegram] bot polling for updates.');
}

main().catch((err) => {
  console.error('[horizon] fatal:', err);
  process.exit(1);
});
