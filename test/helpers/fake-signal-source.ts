import type { SignalSource } from '../../src/sources/signal-source.js';
import type { SignalObservation, SourceId } from '../../src/domain/types.js';

export interface FakeSignalSourceOptions {
  readonly healthy?: boolean;
  readonly observations?: SignalObservation[];
  /** When set, observe() throws this message (to test failure isolation). */
  readonly observeError?: string;
}

/** A configurable SignalSource for testing the signal-collection path. */
export class FakeSignalSource implements SignalSource {
  observeCalls = 0;

  constructor(
    readonly id: SourceId,
    private readonly options: FakeSignalSourceOptions = {},
  ) {}

  async healthCheck(): Promise<boolean> {
    return this.options.healthy ?? true;
  }

  async observe(): Promise<SignalObservation[]> {
    this.observeCalls += 1;
    if (this.options.observeError) throw new Error(this.options.observeError);
    return this.options.observations ?? [];
  }
}
