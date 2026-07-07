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
import { DrizzleTickReportRepo } from './db/tick-report-repo.js';
import type { TickRecord } from './db/tick-report-repo.js';
import { DrizzleSignalObservationRepo, type SignalObservationRepo } from './db/signal-observation-repo.js';
import { DrizzleTickReflectionRepo } from './db/tick-reflection-repo.js';
import { DrizzleAgentPolicyRepo } from './db/agent-policy-repo.js';
import { DrizzleChatTraceRepo, type ChatTraceRepo } from './db/chat-trace-repo.js';
import { DrizzleChatSessionRepo, type ChatSessionRepo } from './db/chat-session-repo.js';
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
import { TokenLedger } from './llm/token-ledger.js';
import type { ToolCapableTransport } from './llm/chat-transport.js';
import { ResilientLLMClient } from './llm/resilient-llm-client.js';
import type { LLMClient } from './llm/llm-client.js';
import { HashingEmbedder } from './embedding/hashing-embedder.js';
import { OpenAIEmbedder } from './embedding/openai-embedder.js';
import { ResilientEmbedder } from './embedding/resilient-embedder.js';
import type { Embedder } from './embedding/embedder.js';
import { systemClock } from './scheduler/clock.js';
import { TickLoop } from './scheduler/tick-loop.js';
import { ConsoleLogger, type Logger } from './log/logger.js';
import { TickRunner } from './pipeline/tick-runner.js';
import { AdaptiveBackoff } from './pipeline/adaptive-backoff.js';
import { screenReflectionActions } from './pipeline/reflection-policy.js';
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
import type { SignalSourceId, SourceId, StorySourceId } from './domain/types.js';
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

/**
 * Build the concrete SourceAdapter for one enabled source config. The `id` is a
 * `StorySourceId` (the caller filters out Signal sources), so the switch is
 * exhaustive — a new Story source without a builder is a compile error.
 */
function buildSource(id: StorySourceId, s: SourceConfig, fetchJson: JsonFetcher): SourceAdapter {
  const base = { fetchJson, maxItems: s.maxItems };
  switch (id) {
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
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
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
    .map((s) => buildSource(s.id as StorySourceId, s, fetchJson));
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

/** The structured log sink (src/log/logger.ts). Orchestration logs flow through
 * it; a few leaf resilient-wrappers still default to console.warn on degrade. */
const log: Logger = new ConsoleLogger();

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
      log.warn('main.db_chmod_failed', { err });
    }
  }

  const rawItemRepo = new DrizzleRawItemRepo(db);
  const storyRepo = new DrizzleStoryRepo(db, systemClock);
  const tickReportRepo = new DrizzleTickReportRepo(db);
  const signalObservationRepo = new DrizzleSignalObservationRepo(db);
  const tickReflectionRepo = new DrizzleTickReflectionRepo(db);
  const agentPolicyRepo = new DrizzleAgentPolicyRepo(db);
  const chatTraceRepo = new DrizzleChatTraceRepo(db);
  const chatSessionRepo = new DrizzleChatSessionRepo(db);
  // Shared across the web viewer and the Telegram bot so a linked user sees the
  // same preferences on both surfaces (ADR-0040).
  const chatPrefs = new DrizzleChatPreferencesRepo(db);
  const webAuth = new DrizzleWebAuthRepo(db);

  // One usage store shared by the web podcast cap, the bot's quotas, and the
  // token ledger, so every durable daily counter lives in one table (ADR-0052).
  const usage = new DrizzleUsageRepo(db);
  // Token accounting: every completion reports its usage; the ledger keeps
  // in-memory daily totals and persists durable per-tier counters via `usage`.
  const tokenLedger = new TokenLedger({
    now: () => systemClock.now(),
    store: usage,
    onError: (err) => log.error('tokens.persist_failed', { err }),
  });

  // One provider transport, shared by the slot-filling Reasoner and the chat
  // agent's tool loop (ADR-0053) — same models, same retry discipline.
  const openaiTransport = new OpenAITransport({
    cheapModel: config.reasoner.cheapModel,
    deepModel: config.reasoner.deepModel,
    onUsage: (u) => tokenLedger.record(u),
  });
  const llm = new ResilientLLMClient(new Reasoner(openaiTransport), (op, err) =>
    log.warn('reasoner.degraded', { op, err }),
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
  const storySources = buildSources(config, fetchJson);
  const signalSources = buildSignalSources(config, fetchJson);
  const storySourceIds = storySources.map((s) => s.id);
  // Story AND Signal ids (ADR-0054): the backoff/reflection loops govern both.
  const allSourceIds: SourceId[] = [...storySourceIds, ...signalSources.map((s) => s.id)];
  const runner = new TickRunner({
    sources: storySources,
    signalSources,
    rawItemRepo,
    storyRepo,
    signalObservationRepo,
    llm,
    embedder,
    clock: systemClock,
    config: toTickConfig(config),
  });

  const retention = config.retention;
  if (retention.signalHistoryDays === 0) {
    log.warn('retention.signal_history_unbounded', {
      hint: 'signalHistoryDays=0 keeps every Signal observation forever; set a positive window to prune (ADR-0047)',
    });
  }

  // History retention + the LLM reflection advisory (ADR-0042). Best-effort:
  // an advisory/prune failure must never break the loop. `tickLoop` is assigned
  // below, before the first tick can ever invoke `maintain`.
  // eslint-disable-next-line prefer-const -- assigned exactly once below; declared early so `maintain` can close over it
  let tickLoop: TickLoop;
  let tickCount = 0;
  const maintain = async (): Promise<void> => {
    tickCount += 1;
    if (retention.tickReports > 0) await tickReportRepo.pruneToRecent(retention.tickReports);
    if (retention.pruneExpiredAuth) await webAuth.pruneExpired(systemClock.now());
    // Drop raw provenance no Story kept, so raw_items can't grow without bound (ADR-0047).
    if (retention.pruneUnreferencedRawItems) await rawItemRepo.pruneUnreferenced();
    // Chat-agent trajectories and idle durable sessions are bounded too (ADR-0053).
    await chatTraceRepo.pruneToRecent(200);
    await chatSessionRepo.pruneIdleSince(systemClock.now() - 7 * 24 * 3600_000);

    if (retention.reflectEveryTicks > 0 && tickCount % retention.reflectEveryTicks === 0) {
      // Reason over the trailing window of ticks as a group; persist the note
      // AND act on it (ADR-0053): the model proposes bounded corrections, the
      // deterministic policy guard screens them, the loop applies what survives.
      const recent = await tickReportRepo.recent(retention.reflectWindow);
      const reflection = await llm.reflect({ ticks: recent.map(toTickDigest) });
      const accepted = screenReflectionActions(reflection.actions, {
        validSources: allSourceIds,
        topN: { min: 3, max: 15 },
        maxBackoffTicks: 10,
      });
      for (const b of accepted.backoffs) {
        backoff.force(b.source, tickLoop.tickIndex() + 1, b.ticks);
        log.info('reflect.backoff_forced', { source: b.source, ticks: b.ticks, reason: b.reason });
      }
      if (accepted.deepAnalysisTopN) {
        await agentPolicyRepo.set(
          { deepAnalysisTopN: accepted.deepAnalysisTopN.value, reason: accepted.deepAnalysisTopN.reason },
          systemClock.now(),
        );
        log.info('reflect.deep_analysis_top_n', {
          value: accepted.deepAnalysisTopN.value,
          reason: accepted.deepAnalysisTopN.reason,
        });
      }
      for (const r of accepted.rejected) {
        log.warn('reflect.action_rejected', { why: r.why, action: r.action });
      }
      const text = reflection.advisory.trim();
      if (text) {
        await tickReflectionRepo.record({
          createdAt: systemClock.now(),
          ticksCovered: recent.length,
          text,
          actions: [
            ...accepted.backoffs.map((b) => ({
              type: 'backoff_source', reason: b.reason, source: b.source, ticks: b.ticks,
            })),
            ...(accepted.deepAnalysisTopN
              ? [{
                  type:
                    accepted.deepAnalysisTopN.value === null
                      ? 'clear_deep_analysis_top_n'
                      : 'set_deep_analysis_top_n',
                  reason: accepted.deepAnalysisTopN.reason,
                  ...(accepted.deepAnalysisTopN.value !== null
                    ? { value: accepted.deepAnalysisTopN.value }
                    : {}),
                }]
              : []),
          ],
        });
        if (retention.reflections > 0) {
          await tickReflectionRepo.pruneToRecent(retention.reflections);
        }
        log.info('reflect.advisory_written', { ticksCovered: recent.length });
      }
    }
  };

  // Optional cross-process advisory lock (ADR-0047): when two processes point at
  // one DB, only the lock holder ticks — the other skips instead of double-writing.
  const tickLock = new DrizzleTickLock(db);
  const lockEnabled = config.lock.enabled;
  const lockTtlMs = config.lock.ttlMinutes * 60_000;

  // Adaptive per-source backoff (ADR-0052): after 3 consecutive failing ticks a
  // Source cools down for 3 ticks, then auto-retries. Closes the observe→adapt loop.
  // Seeded from the persisted tick history (ADR-0053) so a deploy — the loop's most
  // frequent restart — doesn't amnesia the streaks it just learned.
  const backoff = new AdaptiveBackoff({ threshold: 3, cooldownTicks: 3 });
  let tickIndex = 0;
  try {
    const history = (await tickReportRepo.recent(6)).reverse(); // oldest first
    tickIndex = backoff.seed(
      history.map((t) => ({
        skipped: [...t.skipped, ...t.signalsSkipped],
        failed: [...t.failed, ...t.signalsFailed],
      })),
      allSourceIds,
    );
    const active = backoff.activeBackoffs(tickIndex);
    if (active.size) log.info('backoff.rehydrated', { coolingDown: [...active] });
  } catch (err) {
    log.error('backoff.seed_failed', { err, note: 'starting fresh' });
  }

  // Release the advisory lock on shutdown (ADR-0048). systemd restarts (every
  // deploy) land mid-tick about half the time; without this the dying process
  // leaves a stale lease that stalls ticking for up to lock.ttlMinutes.
  const shutdown = (signal: string): void => {
    log.info('main.shutdown', { signal, action: 'releasing tick lock and exiting' });
    void (async () => {
      if (lockEnabled) await tickLock.release().catch(() => undefined);
      process.exit(0);
    })();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  // The scheduler around TickRunner (extracted + tested, src/scheduler/tick-loop.ts):
  // lock/skip-record semantics, re-entrancy guard, the exclusive pipeline queue,
  // the backoff feed, the per-tick policy read, and maintain-always-runs.
  tickLoop = new TickLoop({
    runner,
    lock: tickLock,
    lockEnabled,
    lockTtlMs,
    clock: systemClock,
    reports: tickReportRepo,
    backoff,
    sourceIds: allSourceIds,
    policy: agentPolicyRepo,
    maintain,
    // Steady-state healing (ADR-0038): deep-analyze a few cached Stories still
    // missing a summary / whyItMatters, so the whole cache converges over time.
    ...(config.reasoner.backfillPerTick > 0
      ? {
          afterTick: async (): Promise<void> => {
            await backfillSummaries(
              { storyRepo, rawItemRepo, llm },
              {
                max: config.reasoner.backfillPerTick,
                concurrency: config.dedup.confirmConcurrency,
              },
            ).catch((err) => log.error('backfill.per_tick_failed', { err }));
          },
        }
      : {}),
    log,
    initialTickIndex: tickIndex,
  });

  // First tick on boot, then every X minutes (ADR-0001).
  tickLoop.start(config.tickIntervalMinutes * 60_000);

  // Self-heal cached Stories that lack a factual summary (e.g. created before the
  // field existed, or never top-N) — in the background, most-significant first, so
  // the brief fixes itself after a restart without a manual backfill (ADR-0006).
  // Serialized with ticks (runExclusive) so the two never contend (ADR-0047).
  if (config.reasoner.backfillOnBoot) {
    void tickLoop
      .runExclusive(() =>
        backfillSummaries(
          { storyRepo, rawItemRepo, llm },
          {
            max: config.reasoner.backfillMaxOnBoot,
            concurrency: config.dedup.confirmConcurrency,
            onProgress: (done, total) => {
              if (done === 1) log.info('backfill.start', { total });
              if (done === total) log.info('backfill.done', { total });
            },
          },
        ),
      )
      .catch((err) => log.error('backfill.failed', { err }));
  }

  const defaults = toPresentationDefaults(config);
  // Bot username (no `@`) powers the one-tap `t.me/<bot>?start=…` deep link on
  // the web login. Optional: without it the web shows the pairing code to type.
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
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
      // Env override in either direction (docs/DEPLOY-HTTPS.md): the committed
      // config ships secure (HTTPS prod); WEB_SECURE_COOKIE=false relaxes it
      // for plain-http local development without editing the config.
      secureCookie: process.env.WEB_SECURE_COOKIE
        ? process.env.WEB_SECURE_COOKIE === 'true'
        : config.web.secureCookie,
      ...(botUsername ? { botUsername } : {}),
    },
    tickReflectionRepo,
    signalObservationRepo,
    chatTraceRepo,
  );
  serve({ fetch: app.fetch, port: PORT, hostname: HOST });
  log.info('main.viewer_up', { url: `http://${HOST}:${PORT}`, tickEveryMinutes: config.tickIntervalMinutes });

  if (config.telegram.enabled) {
    startTelegramBot(
      config, db, queryEngine, defaults, llm, storyRepo, chatPrefs, webAuth, embedder, usage,
      openaiTransport, signalObservationRepo, chatTraceRepo, chatSessionRepo,
    );
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
    log.warn('telegram.web_search_unkeyed', {
      hint: 'chat.webSearch=tavily but TAVILY_API_KEY is missing — staying cache-only',
    });
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
  /** Tool-capable transport for the chat agent loop (ADR-0053). */
  agentTransport?: ToolCapableTransport,
  /** Signal history behind the agent's trends tool (ADR-0053). */
  signals?: SignalObservationRepo,
  /** Persisted chat-agent trajectories (ADR-0053). */
  traces?: ChatTraceRepo,
  /** Durable chat sessions — conversations survive deploys (ADR-0053). */
  sessionRepo?: ChatSessionRepo,
): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log.warn('telegram.token_missing', { hint: 'telegram.enabled but TELEGRAM_BOT_TOKEN is missing — skipping' });
    return;
  }

  const tg = config.telegram;
  if (tg.allowedChatIds.length === 0 && !tg.openAccess) {
    log.warn('telegram.no_allowed_chats', {
      hint: 'no allowedChatIds and openAccess=false — the bot will ignore ALL chats; add your chat id to telegram.allowedChatIds (ADR-0022)',
    });
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
    // The chat agent loop (ADR-0053): model-driven tool selection over the
    // cache/signals/web, with persisted trajectories; degrades to discuss.
    ...(chat && agentTransport ? { agentTransport } : {}),
    ...(chat && signals ? { signals } : {}),
    ...(chat && traces ? { traces } : {}),
    ...(sessionRepo ? { sessionRepo } : {}),
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
    log,
  });

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const loop = async (): Promise<void> => {
    let offset = 0;
    for (;;) {
      try {
        offset = await pollOnce(transport, bot, offset, config.telegram.pollTimeoutSeconds, (err) =>
          log.error('telegram.handler_failed', { err }),
        );
      } catch (err) {
        log.error('telegram.poll_failed', { err, action: 'retrying' }); // never kill the loop
        await sleep(2000);
      }
    }
  };
  void loop();
  log.info('telegram.polling');

  // Scheduled personalized briefs (ADR-0053): a minute-cadence check delivers
  // each subscribed chat its brief at its chosen UTC time — deterministic cache
  // reads, zero model spend, idempotent per day.
  setInterval(() => {
    void bot
      .deliverScheduledBriefs()
      .then((sent) => {
        if (sent > 0) log.info('telegram.scheduled_briefs_sent', { sent });
      })
      .catch((err) => log.error('telegram.scheduled_briefs_failed', { err }));
  }, 60_000);
}

main().catch((err) => {
  log.error('main.fatal', { err });
  process.exit(1);
});
