/**
 * Race `promise` against a `ms`-wide cap so a caller can bound how long it
 * waits on work it does not control (ADR-0054 audit fix: graceful shutdown).
 *
 * `main.ts`'s SIGTERM/SIGINT handler used to `await tickLock.release()` inside
 * a fire-and-forget closure before `process.exit(0)` — a hung release (e.g. a
 * wedged DB connection) meant the process never exited on its own and relied
 * on the orchestrator's SIGKILL. Wrapping the shutdown work in `withTimeout`
 * guarantees the handler proceeds to `exit` within `ms`, whether or not the
 * work finished. If `promise` rejects before the cap, that rejection still
 * propagates — only a *hang* is bounded, not a genuine failure.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
