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
import { DrizzleSignalObservationRepo, type SignalObservationRepo } from './db/signal-observation-repo.js';
import { DrizzleTickReflectionRepo } from './db/tick-reflection-repo.js';
import { DrizzleAgentPolicyRepo } from './db/agent-policy-repo.js';
import { DrizzleChatTraceRepo, type ChatTraceRepo } from './db/chat-trace-repo.js';
import { DrizzleChatSessionRepo, type ChatSessionRepo } from './db/chat-session-repo.js';
import { DrizzleTickLock } from './db/tick-lock-repo.js';
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
import { TokenLedger, tokenUsageKey } from './llm/token-ledger.js';
import type { ToolCapableTransport } from './llm/chat-transport.js';
import { ResilientLLMClient } from './llm/resilient-llm-client.js';
import { SpendGuard, type SpendBudget } from './llm/spend-guard.js';
import type { LLMClient } from './llm/llm-client.js';
import { HashingEmbedder } from './embedding/hashing-embedder.js';
import { OpenAIEmbedder } from './embedding/openai-embedder.js';
import type { EmbeddingUsageReport } from './embedding/openai-embedder.js';
import { ResilientEmbedder } from './embedding/resilient-embedder.js';
import type { Embedder } from './embedding/embedder.js';
import { systemClock } from './scheduler/clock.js';
import { TickLoop } from './scheduler/tick-loop.js';
import { ConsoleLogger, type Logger } from './log/logger.js';
import { TickRunner } from './pipeline/tick-runner.js';
import { AdaptiveBackoff } from './pipeline/adaptive-backoff.js';
import { screenReflectionActions } from './pipeline/reflection-policy.js';
import { maybeReflect, maybeRevertPolicy, runMaintenanceSteps } from './pipeline/maintenance.js';
import { withTimeout } from './scheduler/timeout.js';
import { backfillSummaries } from './pipeline/backfill-summaries.js';
import { createApp } from './server/app.js';
import { HorizonQuery } from './presentation/horizon-query.js';
import { DrizzleChatPreferencesRepo } from './db/chat-preferences-repo.js';
import type { ChatPreferencesRepo } from './db/chat-preferences-repo.js';
import { DrizzleUsageRepo, utcDay, type UsageRepo } from './db/usage-repo.js';
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
    // ADR-0059 — mainstream corroboration + coverage gaps.
    case 'bbc-world':
      // Like Guardian, BBC World spans many Topics — no hard-coded Topic, so the
      // classifier decides per item and same-event articles converge (ADR-0038).
      return new RssSource({ ...base, id: 'bbc-world', feedUrl: 'https://feeds.bbci.co.uk/news/world/rss.xml' });
    case 'bbc-business':
      return new RssSource({ ...base, id: 'bbc-business', feedUrl: 'https://feeds.bbci.co.uk/news/business/rss.xml', topic: 'Business' });
    case 'bbc-sport':
      return new RssSource({ ...base, id: 'bbc-sport', feedUrl: 'https://feeds.bbci.co.uk/sport/rss.xml', topic: 'Sports' });
    case 'ynetnews':
      return new RssSource({ ...base, id: 'ynetnews', feedUrl: 'https://www.ynetnews.com/Integration/StoryRss3082.xml', topic: 'Israel' });
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
function buildEmbedder(
  config: Config,
  /** Reports embeddings-call token usage to the ledger (Task 15); omitted ⇒ no accounting. */
  onUsage?: (usage: EmbeddingUsageReport) => void,
  /** Daily spend backstop; once exhausted the embedder skips the paid API (ADR-0062). */
  budget?: SpendBudget,
): Embedder {
  const { provider, model, dimensions } = config.embedder;
  const hashing = new HashingEmbedder(dimensions);
  if (provider === 'hashing') return hashing;
  return new ResilientEmbedder(
    new OpenAIEmbedder({ model, dimensions, ...(onUsage ? { onUsage } : {}) }),
    hashing,
    (op, err) => log.warn('embedder.degraded', { op, err }),
    budget,
  );
}

/**
 * Build the daily spend backstop (ADR-0062), seeding today's already-spent
 * baseline from the durable per-tier token counters so the ceiling is
 * restart-safe. A read failure degrades to a zero baseline (the guard still
 * bounds the rest of the day from this session's live usage) — accounting must
 * never block boot.
 */
async function buildSpendGuard(
  usage: DrizzleUsageRepo,
  tokenLedger: TokenLedger,
  pricing: { cheap: number; deep: number; embed: number },
  dailyUsdCap: number,
): Promise<SpendGuard> {
  const day = utcDay(systemClock.now());
  let baselineUsd = 0;
  try {
    const [cheap, deep, embed] = await Promise.all([
      usage.peek(tokenUsageKey('cheap'), day),
      usage.peek(tokenUsageKey('deep'), day),
      usage.peek(tokenUsageKey('embed'), day),
    ]);
    baselineUsd =
      (cheap / 1_000_000) * pricing.cheap +
      (deep / 1_000_000) * pricing.deep +
      (embed / 1_000_000) * pricing.embed;
    if (baselineUsd > 0) log.info('spend.baseline', { day, baselineUsd: Math.round(baselineUsd * 100) / 100 });
  } catch (err) {
    log.warn('spend.baseline_read_failed', { err, note: 'starting from 0 today' });
  }
  return new SpendGuard(tokenLedger, pricing, dailyUsdCap, baselineUsd, day);
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

/** The structured log sink (src/log/logger.ts). Every orchestration log — including
 * the leaf resilient-wrappers' degrade paths — flows through it; a raw `console.*`
 * call anywhere else in src/ (outside this file and src/server/ui.ts's client
 * script) is a bug (Task 18). */
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

  // Daily model-spend backstop (ADR-0062). Seed today's already-spent baseline
  // from the durable per-tier token counters so the ceiling survives restarts
  // and deploys (a runaway can't reset its bill by crashing the process). The
  // ledger tracks THIS session live; baseline + session = the calendar day's
  // spend, counted once.
  const spend = config.spend;
  const pricing = {
    cheap: spend.pricePerMillionTokens.cheap,
    deep: spend.pricePerMillionTokens.deep,
    embed: spend.pricePerMillionTokens.embed,
  };
  const spendGuard = await buildSpendGuard(usage, tokenLedger, pricing, spend.dailyUsdCap);

  // One provider transport, shared by the slot-filling Reasoner and the chat
  // agent's tool loop (ADR-0053) — same models, same retry discipline.
  const openaiTransport = new OpenAITransport({
    cheapModel: config.reasoner.cheapModel,
    deepModel: config.reasoner.deepModel,
    onUsage: (u) => tokenLedger.record(u),
  });
  const llm = new ResilientLLMClient(
    new Reasoner(openaiTransport),
    (op, err) => log.warn('reasoner.degraded', { op, err }),
    spendGuard,
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
  const embedder = buildEmbedder(
    config,
    (u) => tokenLedger.record({ tier: 'embed', promptTokens: u.totalTokens, completionTokens: 0 }),
    spendGuard,
  );
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
    log,
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
  // Each step runs in isolation (ADR-0054 audit fix): a failing prune must
  // not starve the prunes after it or reflection for the cycle — see
  // `runMaintenanceSteps` in pipeline/maintenance.ts for the isolation itself.
  const maintain = async (): Promise<void> => {
    // Coordinate reflect → revert within one cycle: if reflection just imposed a
    // fresh override, the deterministic revert must stand down this pass, or a
    // healthy-looking window would clear the override before the next tick ever
    // reads it — defeating the adaptation (Bugbot finding, ADR-0061).
    let appliedPolicyOverrideThisCycle = false;
    await runMaintenanceSteps(
      [
        {
          name: 'tickReports',
          run: async () => {
            if (retention.tickReports > 0) await tickReportRepo.pruneToRecent(retention.tickReports);
          },
        },
        {
          name: 'webAuth',
          run: async () => {
            if (retention.pruneExpiredAuth) await webAuth.pruneExpired(systemClock.now());
          },
        },
        {
          // Drop raw provenance no Story kept, so raw_items can't grow without bound (ADR-0047).
          name: 'rawItems',
          run: async () => {
            if (retention.pruneUnreferencedRawItems) await rawItemRepo.pruneUnreferenced();
          },
        },
        {
          // Chat-agent trajectories are bounded too (ADR-0053).
          name: 'chatTrace',
          run: async () => {
            await chatTraceRepo.pruneToRecent(200);
          },
        },
        {
          name: 'chatSession',
          run: async () => {
            await chatSessionRepo.pruneIdleSince(systemClock.now() - 7 * 24 * 3600_000);
          },
        },
        {
          // Reason over the trailing window of ticks as a group; persist the note
          // AND act on it (ADR-0053): the model proposes bounded corrections, the
          // deterministic policy guard screens them, the loop applies what survives.
          // Cadence is derived from tick_reports' durable max id (survives
          // both restarts/deploys AND this same cycle's prune step above —
          // see maybeReflect's docstring in pipeline/maintenance.ts), not an
          // in-memory counter and not a row count (ADR-0042).
          name: 'reflect',
          run: async () => {
            const outcome = await maybeReflect({
              reflect: (input) => llm.reflect(input),
              screen: screenReflectionActions,
              backoff,
              agentPolicyRepo,
              tickReflectionRepo,
              tickReportRepo,
              log,
              now: () => systemClock.now(),
              nextTickIndex: () => tickLoop.tickIndex() + 1,
              validSources: allSourceIds,
              reflectEveryTicks: retention.reflectEveryTicks,
              reflectWindow: retention.reflectWindow,
              reflectionsRetention: retention.reflections,
            });
            appliedPolicyOverrideThisCycle = outcome.appliedPolicyOverride;
          },
        },
        {
          // Close the adaptation loop (ADR-0061): once ticks recover, relax any
          // override a prior reflection imposed instead of letting a one-off
          // stress response persist forever. Deterministic, every tick.
          name: 'revertPolicy',
          run: async () => {
            if (appliedPolicyOverrideThisCycle) return; // let this cycle's fresh override stand
            await maybeRevertPolicy({
              agentPolicyRepo,
              tickReportRepo,
              now: () => systemClock.now(),
              healthyWindow: retention.reflectWindow,
              log,
            });
          },
        },
      ],
      log,
    );
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
  // Bounded by withTimeout (ADR-0054 audit fix): a hung `lock.release()` (e.g.
  // a wedged DB connection) used to hang this fire-and-forget closure forever,
  // leaving `process.exit(0)` never called and the orchestrator to SIGKILL
  // after its own grace period. Capping the release at 5s guarantees we still
  // exit promptly even when the release itself never settles.
  const shutdown = (signal: string): void => {
    log.info('main.shutdown', { signal, action: 'releasing tick lock and exiting' });
    void (async () => {
      if (lockEnabled) {
        await withTimeout(tickLock.release(), 5000).catch(() => undefined);
      }
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
  // One synthesizer, shared by the web podcast and the Telegram bot (ADR-0020) —
  // both narrate audio; both bill into the same token ledger + podcast budget.
  const synthesizer = buildSynthesizer(config, tokenLedger);
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
      ...(synthesizer ? { synthesizer } : {}),
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
      synthesizer,
    );
  }
}

/**
 * Build the TTS synthesizer (ADR-0020), or null when disabled. Shared by the
 * Telegram bot AND the web podcast so both narrate with the same model/voice and
 * bill into the same token ledger — the web podcast is no longer script-only.
 */
function buildSynthesizer(config: Config, tokenLedger?: TokenLedger): Synthesizer | null {
  const tts = config.telegram.tts;
  if (!tts.enabled) return null;
  return new ResilientSynthesizer(
    new OpenAITTS({
      model: tts.model,
      voice: tts.voice,
      onUsage: (u) =>
        tokenLedger?.record({ tier: 'tts', promptTokens: u.characters, completionTokens: 0 }),
    }),
    (op, err) => log.warn('tts.degraded', { op, err }),
  );
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
    (err) => log.warn('web_search.degraded', { err }),
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
  /** Shared TTS synthesizer (ADR-0020); null ⇒ podcast is sent as text. */
  synthesizer: Synthesizer | null = null,
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

// Last-resort backstop: any promise rejection that somehow escapes every awaited
// try/catch (a bug, not the expected path) must never silently kill the daemon —
// that would contradict the "degrades instead of crashing" guarantee. Logging and
// continuing is the final safety net, not a substitute for handling errors locally.
process.on('unhandledRejection', (reason) => {
  log.error('process.unhandled_rejection', { err: reason });
});

main().catch((err) => {
  log.error('main.fatal', { err });
  process.exit(1);
});
