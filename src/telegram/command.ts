/**
 * The Telegram command kernel (ADR-0019). A pure parser: chat text → a typed
 * Command the dispatcher acts on. No I/O, exhaustively unit-testable. Argument
 * validation (valid topics/regions) happens later, where the vocabulary lives.
 */
export type PrefsField = 'topics' | 'regions' | 'minutes';

export type Command =
  | { kind: 'start' }
  | { kind: 'help' }
  | { kind: 'brief'; minutes?: number }
  | { kind: 'outline'; topic?: string; minutes?: number }
  | { kind: 'podcast'; minutes?: number }
  | { kind: 'prefsShow' }
  | { kind: 'prefsSet'; field: PrefsField; value: string }
  | { kind: 'prefsClear' }
  | { kind: 'feedback'; text: string }
  | { kind: 'feedbackUndo' }
  | { kind: 'unknown'; text: string };

const PREFS_FIELDS: readonly PrefsField[] = ['topics', 'regions', 'minutes'];

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
      return { kind: 'start' };
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
    case 'outline': {
      const topic = args[0];
      const minutes = positiveNumber(args[1]);
      if (topic === undefined) return { kind: 'outline' };
      return minutes === undefined
        ? { kind: 'outline', topic }
        : { kind: 'outline', topic, minutes };
    }
    case 'prefs': {
      const sub = args[0]?.toLowerCase();
      if (sub === undefined) return { kind: 'prefsShow' };
      if (sub === 'clear') return { kind: 'prefsClear' };
      if (PREFS_FIELDS.includes(sub as PrefsField) && args.length > 1) {
        return { kind: 'prefsSet', field: sub as PrefsField, value: args.slice(1).join(' ') };
      }
      return { kind: 'prefsShow' };
    }
    case 'feedback': {
      // "/feedback undo" reverts the last change; otherwise the rest is free text.
      if (args.length === 1 && args[0]?.toLowerCase() === 'undo') {
        return { kind: 'feedbackUndo' };
      }
      return { kind: 'feedback', text: args.join(' ') };
    }
    default:
      return { kind: 'unknown', text };
  }
}
