/**
 * The Telegram command kernel (ADR-0019). A pure parser: chat text → a typed
 * Command the dispatcher acts on. No I/O, exhaustively unit-testable. Argument
 * validation (valid topics) happens later, where the vocabulary lives.
 */
export type PrefsField = 'topics' | 'minutes';

export type Command =
  /** `/start`, optionally with a deep-link payload (e.g. `link_<code>`, ADR-0040). */
  | { kind: 'start'; payload?: string }
  /** Web pairing: `/link <code>` links this chat to a web session (ADR-0040). */
  | { kind: 'link'; code: string }
  | { kind: 'help' }
  | { kind: 'brief'; minutes?: number }
  | { kind: 'podcast'; minutes?: number }
  | { kind: 'prefsShow' }
  | { kind: 'prefsSet'; field: PrefsField; value: string }
  /** A plain-language preference edit, interpreted by the bot (ADR-0030). */
  | { kind: 'prefsNL'; text: string }
  | { kind: 'prefsClear' }
  | { kind: 'feedback'; text: string }
  | { kind: 'feedbackUndo' }
  | { kind: 'remember'; text: string }
  | { kind: 'chat'; text: string }
  /** Scheduled daily brief (ADR-0053): `/subscribe 08:00`, `/subscribe off`, bare shows status. */
  | { kind: 'subscribe'; time?: string; off?: boolean }
  | { kind: 'unknown'; text: string };

const PREFS_FIELDS: readonly PrefsField[] = ['topics', 'minutes'];

/** A positive number, or undefined if the token isn't one. */
function positiveNumber(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  const n = Number(token);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseCommand(text: string): Command {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const head = tokens[0];
  if (!head || !head.startsWith('/')) return { kind: 'unknown', text };

  // "/brief@BotName" → "brief"
  const name = head.slice(1).split('@')[0]?.toLowerCase() ?? '';
  const args = tokens.slice(1);

  switch (name) {
    case 'start':
      // Telegram deep links arrive as `/start <payload>` (e.g. from a
      // `t.me/<bot>?start=link_<code>` link); a bare /start has no payload.
      return args[0] ? { kind: 'start', payload: args[0] } : { kind: 'start' };
    case 'link':
      return { kind: 'link', code: args[0] ?? '' };
    case 'help':
      return { kind: 'help' };
    case 'brief': {
      const minutes = positiveNumber(args[0]);
      return minutes === undefined ? { kind: 'brief' } : { kind: 'brief', minutes };
    }
    case 'podcast': {
      const minutes = positiveNumber(args[0]);
      return minutes === undefined ? { kind: 'podcast' } : { kind: 'podcast', minutes };
    }
    case 'prefs': {
      const sub = args[0]?.toLowerCase();
      if (sub === undefined) return { kind: 'prefsShow' };
      if (sub === 'clear') return { kind: 'prefsClear' };
      if (PREFS_FIELDS.includes(sub as PrefsField) && args.length > 1) {
        return { kind: 'prefsSet', field: sub as PrefsField, value: args.slice(1).join(' ') };
      }
      // Anything else after /prefs (e.g. "/prefs ai", "/prefs more ai less sports")
      // is a plain-language edit — hand it to the interpreter instead of silently
      // showing status, which read as "nothing happened" (ADR-0030).
      return { kind: 'prefsNL', text: args.join(' ') };
    }
    case 'feedback': {
      // "/feedback undo" reverts the last change; otherwise the rest is free text.
      if (args.length === 1 && args[0]?.toLowerCase() === 'undo') {
        return { kind: 'feedbackUndo' };
      }
      return { kind: 'feedback', text: args.join(' ') };
    }
    case 'remember':
      return { kind: 'remember', text: args.join(' ') };
    case 'chat':
    case 'ask':
      return { kind: 'chat', text: args.join(' ') };
    case 'subscribe': {
      const arg = args[0]?.toLowerCase();
      if (arg === undefined) return { kind: 'subscribe' };
      if (arg === 'off' || arg === 'stop') return { kind: 'subscribe', off: true };
      return { kind: 'subscribe', time: arg };
    }
    case 'unsubscribe':
      return { kind: 'subscribe', off: true };
    default:
      return { kind: 'unknown', text };
  }
}
