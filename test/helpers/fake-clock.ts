import type { Clock } from '../../src/scheduler/clock.js';

/** A Clock with a settable, manually-advanced time for deterministic tests. */
export class FakeClock implements Clock {
  constructor(private current: number) {}

  now(): number {
    return this.current;
  }

  set(time: number): void {
    this.current = time;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}
