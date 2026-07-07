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
import { DrizzleTickReportRepo, lockSkipRecord } from './db/tick-report-repo.js';
import type { TickRecord } from './db/tick-report-repo.js';
import { DrizzleSignalObservationRepo } from './db/signal-observation-repo.js';
import { DrizzleTickReflectionRepo } from './db/tick-reflection-repo.js';
import { DrizzleTickLock } from './db/tick-lock-repo.js';
import type { TickDigest } from './llm/llm-client.js';
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
import { GdacsSource } from './sources/gdacs.js';
import { WikipediaPageviewsSource } from './sources/wikipedia-pageviews.js';
import { WorldBankSource } from './sources/worldbank.js';
import { CoinGeckoSource } from './sources/coingecko.js';
import { FrankfurterSource } from './sources/frankfurter.js';
import { OpenAlexSource } from './sources/openalex.js';
import { GdeltSignalSource } from './sources/gdelt-signal.js';
import { makeFetchJson, rateLimitByHost } from './sources/http.js';
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
import type { ChatPreferencesRepo } from './db/chat-preferences-repo.js';
import { DrizzleUsageRepo, type UsageRepo } from './db/usage-repo.js';
import { DrizzleWebAuthRepo } from './db/web-auth-repo.js';
import type { WebAuthRepo } from './db/web-auth-repo.js';
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
      return new SecEdgarSource({ ...base, clock: systemClock });
    case 'wikipedia':
      return new WikipediaSource({ ...base, clock: systemClock });
    // Phase 4 — media + thematic anchors (ADR-0021).
    case 'guardian':
      // The Guardian "world" feed spans many Topics (disasters, health, politics),
      // so we DON'T hard-code a Topic — let the classifier decide per item, which
      // also lets same-event articles converge on one Topic for dedup (ADR-0038).
      return new RssSource({ ...base, id: 'guardian', feedUrl: 'https://www.theguardian.com/world/rss' });
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
      return new GdacsSource(base);
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
    // ADR-0041 — GDELT aggregate tone ⇒ Geopolitics intensity signal.
    case 'gdelt-signal':
      return new GdeltSignalSource(base);
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
  // Fail fast on a common misconfig: a remote libsql:// URL with no auth token
  // silently 401s deep in the driver. Refuse to connect unauthenticated instead.
  const dbAuthToken = process.env.DB_AUTH_TOKEN;
  if (DB_URL.startsWith('libsql://') && !dbAuthToken) {
    throw new Error(
      'DB_URL is a remote libsql:// URL but DB_AUTH_TOKEN is not set — refusing to ' +
        'connect unauthenticated. Set DB_AUTH_TOKEN (see .env.example / render.yaml).',
    );
  }
  const db = openDb(DB_URL, dbAuthToken);
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
  const tickReportRepo = new DrizzleTickReportRepo(db);
  const signalObservationRepo = new DrizzleSignalObservationRepo(db);
  const tickReflectionRepo = new DrizzleTickReflectionRepo(db);
  // Shared across the web viewer and the Telegram bot so a linked user sees the
  // same preferences on both surfaces (ADR-0040).
  const chatPrefs = new DrizzleChatPreferencesRepo(db);
  const webAuth = new DrizzleWebAuthRepo(db);

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

  // Serialize + space requests to self-rate-limited hosts (GDELT) so the story
  // feed and the tone signal can't collide and trip its ~1-req/5s limit (ADR-0047).
  const fetchJson = rateLimitByHost(
    makeFetchJson(fetch, {
      timeoutMs: config.http.fetchTimeoutMs,
      maxBytes: config.http.maxResponseBytes,
    }),
  );
  // One embedder, shared by the tick pipeline (dedup) and — when semantic chat is
  // on — the bot's chat grounding (ADR-0045). Stateless, so sharing is safe.
  const embedder = buildEmbedder(config);
  const runner = new TickRunner({
    sources: buildSources(config, fetchJson),
    signalSources: buildSignalSources(config, fetchJson),
    rawItemRepo,
    storyRepo,
    signalObservationRepo,
    llm,
    embedder,
    clock: systemClock,
    config: toTickConfig(config),
  });

  // Best-effort persist of a tick outcome (ADR-0033); a failed write never breaks the loop.
  const recordTick = (rec: Parameters<typeof tickReportRepo.record>[0]): void => {
    void tickReportRepo.record(rec).catch((err) => console.error('[tick] record failed:', err));
  };

  const retention = config.retention;
  if (retention.signalHistoryDays === 0) {
    console.warn(
      '[retention] signalHistoryDays=0 keeps every Signal observation forever — ' +
        'signal_observations will grow unbounded. Set a positive window to prune (ADR-0047).',
    );
  }

  // History retention + the LLM reflection advisory (ADR-0042). Best-effort:
  // an advisory/prune failure must never break the loop.
  let tickCount = 0;
  const maintain = async (): Promise<void> => {
    tickCount += 1;
    if (retention.tickReports > 0) await tickReportRepo.pruneToRecent(retention.tickReports);
    if (retention.pruneExpiredAuth) await webAuth.pruneExpired(systemClock.now());
    // Drop raw provenance no Story kept, so raw_items can't grow without bound (ADR-0047).
    if (retention.pruneUnreferencedRawItems) await rawItemRepo.pruneUnreferenced();

    if (retention.reflectEveryTicks > 0 && tickCount % retention.reflectEveryTicks === 0) {
      // Reason over the trailing window of ticks as a group and persist the note.
      const recent = await tickReportRepo.recent(retention.reflectWindow);
      const text = (await llm.reflect({ ticks: recent.map(toTickDigest) })).trim();
      if (text) {
        await tickReflectionRepo.record({
          createdAt: systemClock.now(),
          ticksCovered: recent.length,
          text,
        });
        if (retention.reflections > 0) {
          await tickReflectionRepo.pruneToRecent(retention.reflections);
        }
        console.log(`[reflect] advisory written over ${recent.length} ticks.`);
      }
    }
  };

  // Optional cross-process advisory lock (ADR-0047): when two processes point at
  // one DB, only the lock holder ticks — the other skips instead of double-writing.
  const tickLock = new DrizzleTickLock(db);
  const lockEnabled = config.lock.enabled;
  const lockTtlMs = config.lock.ttlMinutes * 60_000;

  // Release the advisory lock on shutdown (ADR-0048). systemd restarts (every
  // deploy) land mid-tick about half the time; without this the dying process
  // leaves a stale lease that stalls ticking for up to lock.ttlMinutes.
  const shutdown = (signal: string): void => {
    console.log(`[main] ${signal} — releasing tick lock and exiting`);
    void (async () => {
      if (lockEnabled) await tickLock.release().catch(() => undefined);
      process.exit(0);
    })();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  // Serialize the pipeline: the boot backfill and every tick share one queue, so
  // they never overlap and contend for the model / race the store (ADR-0047).
  let pipelineChain: Promise<unknown> = Promise.resolve();
  const runExclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = pipelineChain.then(fn, fn);
    pipelineChain = result.catch(() => undefined);
    return result;
  };

  const tickBody = async (): Promise<void> => {
    if (lockEnabled && !(await tickLock.acquire(systemClock.now(), lockTtlMs))) {
      console.warn('[tick] another process holds the tick lock — skipping this interval');
      // Make the skip visible in tick_reports (ADR-0048): a remote observer must
      // be able to tell "skipped by lock" from "process dead".
      recordTick(lockSkipRecord(systemClock.now()));
      return;
    }
    const ranAt = systemClock.now();
    try {
      const report = await runner.run();
      recordTick({ ...report, ranAt, durationMs: systemClock.now() - ranAt, ok: true, error: null });
      console.log(
        `[tick] extracted=${report.extracted} stories=${report.storiesUpserted} ` +
          `signals=${report.signalsObserved} ` +
          `skipped=[${report.skipped}] failed=[${report.failed.map((f) => f.source)}]`,
      );
      // Steady-state healing (ADR-0038): deep-analyze a few cached Stories still
      // missing a summary / whyItMatters, so the whole cache converges over time.
      if (config.reasoner.backfillPerTick > 0) {
        await backfillSummaries(
          { storyRepo, rawItemRepo, llm },
          {
            max: config.reasoner.backfillPerTick,
            concurrency: config.dedup.confirmConcurrency,
          },
        ).catch((err) => console.error('[backfill] per-tick failed:', err));
      }
    } catch (err) {
      // Record the failed tick too (ADR-0033), then keep the loop alive.
      recordTick({
        ranAt,
        durationMs: systemClock.now() - ranAt,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        extracted: 0,
        storiesUpserted: 0,
        signalsObserved: 0,
        skipped: [],
        failed: [],
        signalsSkipped: [],
        signalsFailed: [],
      });
      console.error('[tick] failed:', err); // never let a bad tick kill the loop
    } finally {
      // Retention + reflection run whether or not the tick itself succeeded, so a
      // failing tick is still counted, pruned, and reflected on (ADR-0042).
      await maintain().catch((err) => console.error('[maintain] failed:', err));
      if (lockEnabled) await tickLock.release().catch((err) => console.error('[tick] lock release failed:', err));
    }
  };

  // A tick can take longer than the interval; without this guard setInterval
  // would start a second tick over the first and race the same DB (ADR-0038).
  let ticking = false;
  const runTick = async (): Promise<void> => {
    if (ticking) {
      console.warn('[tick] previous tick still running — skipping this interval');
      return;
    }
    ticking = true;
    try {
      await runExclusive(tickBody);
    } finally {
      ticking = false;
    }
  };

  // First tick on boot, then every X minutes (ADR-0001).
  void runTick();
  setInterval(() => void runTick(), config.tickIntervalMinutes * 60_000);

  // Self-heal cached Stories that lack a factual summary (e.g. created before the
  // field existed, or never top-N) — in the background, most-significant first, so
  // the brief fixes itself after a restart without a manual backfill (ADR-0006).
  // Serialized with ticks (runExclusive) so the two never contend (ADR-0047).
  if (config.reasoner.backfillOnBoot) {
    void runExclusive(() =>
      backfillSummaries(
        { storyRepo, rawItemRepo, llm },
        {
          max: config.reasoner.backfillMaxOnBoot,
          concurrency: config.dedup.confirmConcurrency,
          onProgress: (done, total) => {
            if (done === 1) console.log(`[backfill] healing ${total} stories missing a summary…`);
            if (done === total) console.log(`[backfill] done: ${total} stories updated.`);
          },
        },
      ),
    ).catch((err) => console.error('[backfill] failed:', err));
  }

  const defaults = toPresentationDefaults(config);
  // Bot username (no `@`) powers the one-tap `t.me/<bot>?start=…` deep link on
  // the web login. Optional: without it the web shows the pairing code to type.
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  // One usage store shared by the web podcast cap and the bot's quotas, so both
  // surfaces draw down the SAME daily podcast budget (ADR-0052).
  const usage = new DrizzleUsageRepo(db);
  const app = createApp(
    storyRepo,
    queryEngine,
    defaults,
    {
      maxMinutes: config.presentation.maxMinutes,
      maxPodcastMinutes: config.presentation.maxPodcastMinutes,
      podcastEnabled: config.presentation.webPodcastEnabled,
      usage,
      globalPodcastPerDay: config.telegram.limits.globalPodcastPerDay,
    },
    tickReportRepo,
    {
      webAuth,
      prefs: chatPrefs,
      // Env override (WEB_SECURE_COOKIE=true) flips this on for HTTPS deploys
      // without editing the committed config (docs/DEPLOY-HTTPS.md).
      secureCookie: process.env.WEB_SECURE_COOKIE === 'true' || config.web.secureCookie,
      ...(botUsername ? { botUsername } : {}),
    },
    tickReflectionRepo,
  );
  serve({ fetch: app.fetch, port: PORT, hostname: HOST });
  console.log(`[horizon] viewer on http://${HOST}:${PORT} (tick every ${config.tickIntervalMinutes}m)`);

  if (config.telegram.enabled) {
    startTelegramBot(config, db, queryEngine, defaults, llm, storyRepo, chatPrefs, webAuth, embedder, usage);
  }
}

/** Flatten a persisted tick record into the reflection prompt's digest (ADR-0042). */
function toTickDigest(r: TickRecord): TickDigest {
  return {
    ranAt: r.ranAt,
    ok: r.ok,
    durationMs: r.durationMs,
    extracted: r.extracted,
    storiesUpserted: r.storiesUpserted,
    signalsObserved: r.signalsObserved,
    skipped: [...r.skipped, ...r.signalsSkipped],
    failed: [...r.failed, ...r.signalsFailed],
    error: r.error,
  };
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
  prefs: ChatPreferencesRepo,
  webAuth: WebAuthRepo,
  embedder: Embedder,
  usage: UsageRepo,
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
    // Semantic chat grounding over story_vectors (ADR-0045); off ⇒ top-by-significance.
    ...(chat && tg.chat.semanticRetrieval ? { embedder } : {}),
    ...(webSearch ? { webSearch } : {}),
    prefs,
    // Lets a `t.me/<bot>?start=link_<code>` deep link connect the web app (ADR-0040).
    webLink: webAuth,
    usage,
    clock: systemClock,
    limiter: new FixedWindowLimiter(tg.limits.perMinute, 60_000),
    limits: tg.limits,
    maxMinutes: config.presentation.maxMinutes,
    maxPodcastMinutes: config.presentation.maxPodcastMinutes,
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
