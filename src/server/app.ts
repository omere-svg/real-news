import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { StoryRepo } from '../db/story-repo.js';
import type { SignalObservationRepo } from '../db/signal-observation-repo.js';
import type { ChatTraceRepo } from '../db/chat-trace-repo.js';
import type { TickReportRepo } from '../db/tick-report-repo.js';
import type { TickReflectionRepo } from '../db/tick-reflection-repo.js';
import type { ChatPreferencesRepo } from '../db/chat-preferences-repo.js';
import { utcDay, type UsageRepo } from '../db/usage-repo.js';
import type { WebAuthRepo } from '../db/web-auth-repo.js';
import { FixedWindowLimiter, type RateLimiter } from '../telegram/rate-limiter.js';
import type { Synthesizer } from '../telegram/synthesizer.js';
import { TOPICS, type Topic } from '../domain/types.js';
import type { BriefRequest, QueryEngine } from '../presentation/query-engine.js';
import { normalizeMinutes } from '../presentation/minutes.js';
import { renderUI, renderDashboard } from './ui.js';

/**
 * The read-only presentation server (ADR-0011, Principle 4). Serves the
 * pre-compiled Story cache — never makes real-time external calls. A thin HTTP
 * surface over the QueryEngine's two reader artifacts (brief / podcast,
 * ADR-0014/0060), plus the single-page viewer and the ops dashboard.
 */

/** Default attention budget + preferences applied when the request omits them. */
export interface PresentationDefaults {
  readonly minutes: number;
  readonly topics?: readonly Topic[];
}

/** Web-surface hardening knobs (ADR-0023). */
export interface WebOptions {
  /** Hard cap on requested minutes (cost-amplification guard). */
  readonly maxMinutes: number;
  /** Tighter cap for the podcast (TTS) path. */
  readonly maxPodcastMinutes: number;
  /** Expose the LLM-backed /api/podcast endpoint. Off by default. */
  readonly podcastEnabled: boolean;
  /**
   * Durable usage counters + the process-wide daily podcast ceiling, so the public
   * web podcast (an LLM cost vector) shares the SAME `global:podcast` budget as the
   * Telegram bot — no cost vector is uncapped (ADR-0052). Omit ⇒ no web cap.
   */
  readonly usage?: UsageRepo;
  readonly globalPodcastPerDay?: number;
  /** Per-IP budget for `/api/podcast` (an LLM cost vector); default 10 per minute. */
  readonly podcastIpLimit?: number;
  /** Window for `podcastIpLimit`; default 60s. */
  readonly podcastIpWindowMs?: number;
  /**
   * TTS synthesizer (ADR-0020). When present, `/api/podcast` narrates the script
   * to mp3 audio (base64) so the web plays a real episode, not just text; when
   * absent it stays script-only. Bounded by the same podcast budget + per-IP
   * limiter, so enabling web audio adds no new uncapped cost vector.
   */
  readonly synthesizer?: Synthesizer;
}

/**
 * Wiring for the web "Log in with Telegram" flow (ADR-0040). When provided, the
 * server exposes the pairing + preferences endpoints; when omitted, the viewer
 * runs in guest-only mode (browser-local preferences, no accounts).
 */
export interface WebAuthOptions {
  readonly webAuth: WebAuthRepo;
  /** The shared per-chat preferences store — the same one the Telegram bot uses. */
  readonly prefs: ChatPreferencesRepo;
  /** Bot username (no `@`) for `t.me/<bot>?start=…` deep links; omit for code-only linking. */
  readonly botUsername?: string;
  /**
   * Mark the session cookie `Secure` (ADR-0040 hardening). Off by default because
   * the current VM serves plain `http://`; set true once served over HTTPS so the
   * token is never sent over an unencrypted connection.
   */
  readonly secureCookie?: boolean;
  /** Linked-session lifetime; default 30 days. */
  readonly sessionTtlMs?: number;
  /** Pairing-code lifetime; default 10 minutes. */
  readonly codeTtlMs?: number;
  /** Injectable time source (tests); defaults to `Date.now`. */
  readonly now?: () => number;
  /** Per-IP budget for `/api/auth/start` (mints DB rows); default 5 per minute. */
  readonly authStartLimit?: number;
  /** Window for `authStartLimit`; default 60s. */
  readonly authStartWindowMs?: number;
}

/** ~One tick — the "developed across ticks" threshold `/api/stats` counts against. */
const CROSS_TICK_MS = 25 * 60_000;

const SESSION_COOKIE = 'horizon_session';
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 3600_000;
const DEFAULT_CODE_TTL_MS = 10 * 60_000;
const DEFAULT_AUTH_START_LIMIT = 5;
const DEFAULT_AUTH_START_WINDOW_MS = 60_000;
const DEFAULT_PODCAST_IP_LIMIT = 10;
const DEFAULT_PODCAST_IP_WINDOW_MS = 60_000;

/**
 * Best-effort client IP for rate limiting. The deploy sits behind Caddy
 * (docs/DEPLOY-HTTPS.md), which sets `x-forwarded-for`; Node's raw socket
 * address would just be Caddy's loopback, so the header is the only signal
 * that actually distinguishes visitors. Take the first hop (the original
 * client) and fall back to a shared bucket when the header is absent, e.g.
 * direct-to-Node access in dev/tests.
 */
function clientIp(c: Context): string {
  const fwd = c.req.header('x-forwarded-for');
  const first = fwd?.split(',')[0]?.trim();
  return first || 'unknown';
}
/** Unambiguous code alphabet (no 0/O/1/I) so a human can retype it into the bot. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

function newCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export function createApp(
  storyRepo: StoryRepo,
  queryEngine: QueryEngine,
  defaults: PresentationDefaults,
  web: WebOptions,
  /** Observability log (ADR-0033); when omitted the dashboard/feed return empty. */
  tickReports?: TickReportRepo,
  /** Web login + shared preferences (ADR-0040); when omitted the viewer is guest-only. */
  auth?: WebAuthOptions,
  /** Reflection advisories (ADR-0042); when omitted the dashboard shows none. */
  tickReflections?: TickReflectionRepo,
  /** Signal history (ADR-0044); when omitted `/api/stats` reports zero observations. */
  signalObservations?: SignalObservationRepo,
  /** Chat-agent trajectories (ADR-0053); when omitted `/api/chat-traces` is empty. */
  chatTraces?: ChatTraceRepo,
): Hono {
  const app = new Hono();

  // /api/podcast is an LLM-backed cost vector reachable without auth — cap it per
  // IP so a script can't grief the shared global budget with rapid-fire requests
  // (mirrors the /api/auth/start per-IP limiter below, ADR-0052).
  const podcastIpLimiter: RateLimiter = new FixedWindowLimiter(
    web.podcastIpLimit ?? DEFAULT_PODCAST_IP_LIMIT,
    web.podcastIpWindowMs ?? DEFAULT_PODCAST_IP_WINDOW_MS,
  );

  app.get('/health', (c) => c.json({ ok: true }));

  if (auth) wireAuth(app, auth, defaults, web);

  // Observability (ADR-0033): recent tick outcomes as JSON + an HTML dashboard.
  app.get('/api/ticks', async (c) => {
    const limit = normalizeLimit(c.req.query('limit'), 50);
    return c.json({ ticks: tickReports ? await tickReports.recent(limit) : [] });
  });

  // The LLM reflection advisories drawn from recent ticks (ADR-0042).
  app.get('/api/reflection', async (c) => {
    const limit = normalizeLimit(c.req.query('limit'), 10);
    return c.json({ reflections: tickReflections ? await tickReflections.recent(limit) : [] });
  });

  // The chat agent's tool-loop trajectories (ADR-0053): which tools the model
  // chose, in what order, and whether the answer was grounded — the public,
  // inspectable "how I answered" evidence. No chat identity is stored, and the
  // reader's question is redacted to an 80-char preview at the writer (repo).
  app.get('/api/chat-traces', async (c) => {
    const limit = normalizeLimit(c.req.query('limit'), 20);
    return c.json({ traces: chatTraces ? await chatTraces.recent(limit) : [] });
  });

  // Accumulation evidence: cheap COUNT-only queries proving the Story cache
  // grows and develops across ticks (stories merge, gain sources, get re-scored)
  // and that Signal history keeps building — nothing is rebuilt from scratch.
  app.get('/api/stats', async (c) => {
    // Today's durable LLM token counters (TokenLedger writes them via the usage
    // repo) — read from the same store so a restart doesn't zero the surface.
    const day = utcDay(Date.now());
    const [
      storyStats,
      signalStats,
      ticks,
      cheapTokens,
      deepTokens,
      embedTokens,
      ttsTokens,
      subscribers,
      questionsAnswered,
    ] = await Promise.all([
      storyRepo.stats(CROSS_TICK_MS),
      signalObservations?.stats() ?? { observations: 0, oldestObservedAt: null },
      tickReports?.recent(200) ?? [],
      web.usage?.peek('global:tokens:cheap', day) ?? 0,
      web.usage?.peek('global:tokens:deep', day) ?? 0,
      web.usage?.peek('global:tokens:embed', day) ?? 0,
      web.usage?.peek('global:tokens:tts', day) ?? 0,
      auth?.prefs.countSubscribed() ?? 0,
      chatTraces?.count() ?? 0,
    ]);
    return c.json({
      tokens: {
        day,
        cheap: cheapTokens,
        deep: deepTokens,
        embed: embedTokens,
        tts: ttsTokens,
        // Token-denominated tiers only — tts bills in characters, not
        // tokens, so it is excluded and reported separately below.
        total: cheapTokens + deepTokens + embedTokens,
        ttsCharacters: ttsTokens,
      },
      stories: storyStats.stories,
      multiSourceStories: storyStats.multiSourceStories,
      storiesUpdatedAcrossTicks: storyStats.storiesUpdatedAcrossTicks,
      signalObservations: signalStats.observations,
      oldestSignalAt: signalStats.oldestObservedAt,
      ticksRecorded: ticks.length,
      subscribers,
      questionsAnswered,
      generatedAt: Date.now(),
    });
  });

  app.get('/dashboard', async (c) =>
    c.html(
      renderDashboard(
        tickReports ? await tickReports.recent(50) : [],
        tickReflections ? await tickReflections.recent(5) : [],
      ),
    ),
  );

  app.get('/api/brief', async (c) => {
    // One selection, two reads: the deterministic `brief` text (shared with the
    // bot, and the web's fallback) plus the structured `stories` the web renders
    // as cards with an inspectable "Why this score?" breakdown (ADR-0064).
    const request = briefRequestOf(c, defaults, web);
    const [brief, stories] = await Promise.all([
      queryEngine.textBrief(request),
      queryEngine.briefStories(request),
    ]);
    return c.json({ brief, stories });
  });

  app.get('/api/podcast', async (c) => {
    // LLM-backed cost vector (ADR-0023). When enabled on the web it shares the bot's
    // process-wide daily podcast budget so open web access can't run up OpenAI spend
    // (ADR-0052) — the last uncapped cost vector, now closed.
    if (!web.podcastEnabled) return c.json({ error: 'not found' }, 404);
    if (!podcastIpLimiter.allow(clientIp(c), Date.now())) {
      return c.json({ error: 'too many requests; try again later' }, 429);
    }
    // Peek (no charge) the global ceiling: a refused request must not itself burn
    // budget, else a flood of already-over-cap requests keeps draining a counter
    // that's already exhausted for no reason (mirrors quota-guard's peek-then-charge
    // shape, ADR-0051/ADR-0052 hardening). Only a successful script generation
    // charges the counter, below.
    if (web.usage && web.globalPodcastPerDay !== undefined) {
      const day = utcDay(Date.now());
      const current = await web.usage.peek('global:podcast', day);
      if (current >= web.globalPodcastPerDay) {
        return c.json({ error: 'daily podcast limit reached; try again tomorrow (UTC)' }, 429);
      }
    }
    // Podcasts get the tighter audio cap, not the general maxMinutes.
    const podcastWeb = { ...web, maxMinutes: Math.min(web.maxMinutes, web.maxPodcastMinutes) };
    const script = await queryEngine.podcastScript(briefRequestOf(c, defaults, podcastWeb));
    if (web.usage && web.globalPodcastPerDay !== undefined) {
      await web.usage.incrementAndGet('global:podcast', utcDay(Date.now()));
    }
    // Narrate to audio when a synthesizer is wired (ADR-0020) — the web now plays a
    // real episode, not just the script. TTS failure degrades to script-only
    // (ResilientSynthesizer returns null), never a failed response. The script is
    // always returned too, so the viewer can show it as a transcript.
    let audio: string | null = null;
    if (web.synthesizer) {
      const buf = await web.synthesizer.synthesize(script);
      if (buf) audio = buf.toString('base64');
    }
    return c.json({ script, audio });
  });

  app.get('/', (c) =>
    c.html(
      renderUI({
        minutes: defaults.minutes,
        ...(defaults.topics?.length ? { topics: defaults.topics } : {}),
        podcastEnabled: web.podcastEnabled,
        authEnabled: auth !== undefined,
        ...(auth?.botUsername ? { botUsername: auth.botUsername } : {}),
      }),
    ),
  );

  return app;
}

/**
 * Mount the "Log in with Telegram" pairing + shared-preferences endpoints
 * (ADR-0040). A visitor gets an opaque session token in an httpOnly cookie;
 * once the paired Telegram chat claims the code, the session carries that
 * `chatId` and reads/writes the same `chat_preferences` the bot uses.
 */
function wireAuth(
  app: Hono,
  auth: WebAuthOptions,
  defaults: PresentationDefaults,
  web: WebOptions,
): void {
  const now = auth.now ?? Date.now;
  const sessionTtlMs = auth.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const codeTtlMs = auth.codeTtlMs ?? DEFAULT_CODE_TTL_MS;
  // /api/auth/start mints a web_sessions + link_codes row per POST, unauthenticated
  // and otherwise unlimited — cap it per IP so a script can't flood the DB.
  const authStartLimiter: RateLimiter = new FixedWindowLimiter(
    auth.authStartLimit ?? DEFAULT_AUTH_START_LIMIT,
    auth.authStartWindowMs ?? DEFAULT_AUTH_START_WINDOW_MS,
  );

  /** The linked chat for the request's session cookie, or null when unauthenticated. */
  const currentChat = async (
    c: Context,
  ): Promise<{ chatId: number; name: string | null } | null> => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return null;
    const session = await auth.webAuth.resolve(token, now(), sessionTtlMs);
    if (!session || session.chatId === null) return null;
    return { chatId: session.chatId, name: session.name };
  };

  // Begin pairing: mint a session + short-lived code, set the cookie, and return
  // the code plus a deep link the visitor opens in Telegram to confirm.
  app.post('/api/auth/start', async (c) => {
    if (!authStartLimiter.allow(clientIp(c), now())) {
      return c.json({ error: 'too many requests; try again later' }, 429);
    }
    const token = newToken();
    const code = newCode();
    // The pending session lives only as long as its code (ADR-0048); the cookie
    // may outlive it — an expired pending token simply resolves to null.
    await auth.webAuth.createPending({ token, code, now: now(), codeTtlMs });
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: auth.secureCookie ?? false,
      path: '/',
      maxAge: Math.floor(sessionTtlMs / 1000),
    });
    return c.json({
      code,
      deepLink: auth.botUsername ? `https://t.me/${auth.botUsername}?start=link_${code}` : null,
      expiresInSec: Math.floor(codeTtlMs / 1000),
    });
  });

  // Poll: has the paired chat claimed the code yet?
  app.get('/api/auth/status', async (c) => {
    const chat = await currentChat(c);
    return c.json(
      chat ? { authenticated: true, name: chat.name } : { authenticated: false },
    );
  });

  app.post('/api/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await auth.webAuth.logout(token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // The signed-in user's shared preferences (topics + default brief length).
  app.get('/api/preferences', async (c) => {
    const chat = await currentChat(c);
    if (!chat) return c.json({ error: 'not authenticated' }, 401);
    const p = await auth.prefs.get(chat.chatId);
    return c.json({
      topics: p?.topics ?? [],
      minutes: p?.defaultMinutes ?? defaults.minutes,
      name: chat.name,
    });
  });

  app.put('/api/preferences', async (c) => {
    const chat = await currentChat(c);
    if (!chat) return c.json({ error: 'not authenticated' }, 401);

    const body = (await c.req.json().catch(() => ({}))) as {
      topics?: unknown;
      minutes?: unknown;
    };
    const patch: { topics?: Topic[] | undefined; defaultMinutes?: number } = {};

    if (Array.isArray(body.topics)) {
      // A client-controlled array with no bound could carry thousands of
      // (possibly duplicated) entries; reject anything bigger than the whole
      // vocabulary outright rather than doing wasted work on it.
      if (body.topics.length > TOPICS.length) {
        return c.json(
          { error: `too many topics; at most ${TOPICS.length} distinct topics are supported` },
          400,
        );
      }
      const valid = body.topics.filter((t): t is Topic =>
        (TOPICS as readonly string[]).includes(t as string),
      );
      const deduped = [...new Set(valid)];
      // An empty/no-valid selection clears the filter back to the default ("all").
      patch.topics = deduped.length ? deduped : undefined;
    }
    if (body.minutes !== undefined && Number.isFinite(Number(body.minutes))) {
      patch.defaultMinutes = normalizeMinutes(Number(body.minutes), web.maxMinutes);
    }

    const saved = await auth.prefs.set(chat.chatId, patch);
    return c.json({
      topics: saved.topics ?? [],
      minutes: saved.defaultMinutes ?? defaults.minutes,
    });
  });
}

/** A positive limit clamped to [1, 200]; falls back to `fallback` for bad input. */
function normalizeLimit(raw: string | undefined, fallback: number): number {
  const n = raw ? Number(raw) : fallback;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  // Floor to an int but never to 0 (e.g. limit=0.5) — that would return an empty
  // page rather than a sane one (ADR-0051).
  return Math.min(200, Math.max(1, Math.floor(n)));
}

/** Build a BriefRequest from query params, falling back to defaults, clamping minutes. */
function briefRequestOf(
  c: Context,
  defaults: PresentationDefaults,
  web: WebOptions,
): BriefRequest {
  const minutesParam = c.req.query('minutes');
  const topics = c.req.queries('topic') as Topic[] | undefined;
  return {
    minutes: normalizeMinutes(
      minutesParam ? Number(minutesParam) : defaults.minutes,
      web.maxMinutes,
    ),
    ...(topics?.length
      ? { topics }
      : defaults.topics
        ? { topics: defaults.topics }
        : {}),
  };
}
