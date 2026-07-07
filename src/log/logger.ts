/**
 * The structured-logging seam. Call sites emit an `event` name (stable,
 * machine-greppable, e.g. `tick.failed`) plus optional structured fields;
 * the sink decides the format. Injected via the composition root so tested
 * modules (the tick loop, the bot) never touch `console` directly.
 */
export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

/** Render one single-line entry: `[level] event {"k":"v"}`. */
function line(level: string, event: string, fields?: Record<string, unknown>): string {
  const suffix = fields && Object.keys(fields).length ? ` ${safeJson(fields)}` : '';
  return `[${level}] ${event}${suffix}`;
}

/** Fields may carry Errors or cycles — never let logging itself throw. */
function safeJson(fields: Record<string, unknown>): string {
  try {
    return JSON.stringify(fields, (_k, v: unknown) =>
      v instanceof Error ? `${v.name}: ${v.message}` : v,
    );
  } catch {
    return '{"log_error":"unserializable fields"}';
  }
}

/** The production sink: single-line structured entries on the console. */
export class ConsoleLogger implements Logger {
  info(event: string, fields?: Record<string, unknown>): void {
    console.log(line('info', event, fields));
  }
  warn(event: string, fields?: Record<string, unknown>): void {
    console.warn(line('warn', event, fields));
  }
  error(event: string, fields?: Record<string, unknown>): void {
    console.error(line('error', event, fields));
  }
}

/** A no-op sink for tests that don't assert on logging. */
export const nullLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
