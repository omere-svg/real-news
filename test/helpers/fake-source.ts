import type { SourceAdapter } from '../../src/sources/source-adapter.js';
import type { RawItem, SourceId } from '../../src/domain/types.js';

export interface FakeSourceOptions {
  readonly healthy?: boolean;
  readonly items?: RawItem[];
  /** When set, extract() throws this message (to test failure isolation). */
  readonly extractError?: string;
}

/** A configurable SourceAdapter for testing the extract stage / worker. */
export class FakeSource implements SourceAdapter {
  extractCalls = 0;

  constructor(
    readonly id: SourceId,
    private readonly options: FakeSourceOptions = {},
  ) {}

  async healthCheck(): Promise<boolean> {
    return this.options.healthy ?? true;
  }

  async extract(): Promise<RawItem[]> {
    this.extractCalls += 1;
    if (this.options.extractError) throw new Error(this.options.extractError);
    return this.options.items ?? [];
  }
}

export function rawItem(source: SourceId, externalId: string): RawItem {
  return {
    source,
    externalId,
    title: `${source} ${externalId}`,
    url: null,
    text: null,
    publishedAt: null,
    metadata: {},
  };
}
