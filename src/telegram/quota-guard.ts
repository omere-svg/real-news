import type { Command } from './command.js';
import { utcDay, type UsageRepo } from '../db/usage-repo.js';
import type { TelegramTransport } from './telegram-transport.js';

/** Rate-limit + cost-quota knobs (ADR-0022). */
export interface BotLimits {
  readonly perMinute: number;
  readonly podcastPerDay: number;
  readonly commandsPerDay: number;
  readonly globalPodcastPerDay: number;
  /** Process-wide command ceiling per UTC day — the total-cost backstop (ADR-0031). */
  readonly globalCommandsPerDay: number;
}

export const LIMIT_MSG = {
  commands:
    'You’ve hit today’s limit for briefs and questions — it resets at midnight UTC. ' +
    'Menus and preferences still work in the meantime.',
  podcast:
    'You’ve used today’s podcast allowance — it resets at midnight UTC. A text brief is ' +
    'still free anytime: /brief.',
  global:
    'The podcast service is busy right now (lots of listeners). Please try again shortly — ' +
    'a text brief works instantly: /brief.',
  globalCommands:
    'Horizon has reached its daily total across all readers — it resets at midnight UTC. ' +
    'Thanks for your patience.',
} as const;

/** Free, zero-cost navigation (menu/help, viewing/clearing prefs, memory, pairing)
 * never draws down the daily command budget — only cache reads / model calls do,
 * else a few menu taps could lock a user out of an actual brief (ADR-0047). */
const FREE_COMMANDS: ReadonlySet<Command['kind']> = new Set([
  'start',
  'link',
  'help',
  'unknown',
  'prefsShow',
  'prefsSet',
  'prefsClear',
  'feedbackUndo',
  'remember',
  'forget',
]);

export function isFreeCommand(kind: Command['kind']): boolean {
  return FREE_COMMANDS.has(kind);
}

/**
 * The bot's cost/rate policy, extracted from `HorizonBot` (ADR-0052) so quota
 * accounting is a single cohesive, independently-testable collaborator rather
 * than tangled into the dispatcher. Owns the per-chat + process-wide daily
 * counters and the "free command" exemption; sends the user-facing limit notice.
 */
export class QuotaGuard {
  constructor(
    private readonly usage: UsageRepo,
    private readonly limits: BotLimits,
    private readonly transport: TelegramTransport,
  ) {}

  isFree(kind: Command['kind']): boolean {
    return isFreeCommand(kind);
  }

  /** Charge one command against the per-chat + global daily counters (no gating) —
   * used to bill a routed message whose resolved command is otherwise free (ADR-0051). */
  async chargeCommand(chatId: number, now: number): Promise<void> {
    const day = utcDay(now);
    await this.usage.incrementAndGet(`chat:${chatId}:cmd`, day);
    await this.usage.incrementAndGet('global:cmd', day);
  }

  /** Read-only: is the chat or the process already at/over the daily command cap?
   * A pre-gate for the router LLM call; the real increment stays in withinQuota. */
  async overCommandQuota(chatId: number, now: number): Promise<boolean> {
    const day = utcDay(now);
    const mine = await this.usage.peek(`chat:${chatId}:cmd`, day);
    if (mine >= this.limits.commandsPerDay) return true;
    const total = await this.usage.peek('global:cmd', day);
    return total >= this.limits.globalCommandsPerDay;
  }

  /** Charge + gate a command against every applicable daily cap; sends the notice
   * on the boundary crossing and returns false when the command must be refused. */
  async withinQuota(chatId: number, command: Command, now: number): Promise<boolean> {
    if (isFreeCommand(command.kind)) return true;

    const day = utcDay(now);
    const { usage, transport, limits } = this;

    // Process-wide daily ceiling across all chats — the hard total-cost backstop
    // that makes openAccess safe (bounds the chat/discuss LLM spend too). ADR-0031.
    // Charged (and gated) *before* the per-chat counter so a globally-blocked
    // request doesn't burn the user's own daily allowance for nothing — the same
    // "don't charge what you're about to refuse" principle as the podcast path
    // (ADR-0051), backported here.
    const totalCmds = await usage.incrementAndGet('global:cmd', day);
    if (totalCmds > limits.globalCommandsPerDay) {
      if (totalCmds === limits.globalCommandsPerDay + 1)
        await transport.sendMessage(chatId, LIMIT_MSG.globalCommands);
      return false;
    }

    const cmds = await usage.incrementAndGet(`chat:${chatId}:cmd`, day);
    if (cmds > limits.commandsPerDay) {
      if (cmds === limits.commandsPerDay + 1) await transport.sendMessage(chatId, LIMIT_MSG.commands);
      return false;
    }

    if (command.kind === 'podcast') {
      // Check the global ceiling before charging this chat's personal podcast
      // counter, so a globally-blocked request doesn't waste the user's own daily
      // allowance (ADR-0051).
      if ((await usage.peek('global:podcast', day)) >= limits.globalPodcastPerDay) {
        await transport.sendMessage(chatId, LIMIT_MSG.global);
        return false;
      }
      const mine = await usage.incrementAndGet(`chat:${chatId}:podcast`, day);
      if (mine > limits.podcastPerDay) {
        if (mine === limits.podcastPerDay + 1) await transport.sendMessage(chatId, LIMIT_MSG.podcast);
        return false;
      }
      const global = await usage.incrementAndGet('global:podcast', day);
      if (global > limits.globalPodcastPerDay) {
        if (global === limits.globalPodcastPerDay + 1) await transport.sendMessage(chatId, LIMIT_MSG.global);
        return false;
      }
    }
    return true;
  }
}
