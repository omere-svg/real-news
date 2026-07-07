import { z } from 'zod';
import { parseDateOrNull } from './date.js';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { RawItem, SourceMetadata } from '../domain/types.js';

const BASE =
  'https://knesset.gov.il/Odata/Votes.svc/View_vote_rslts_hdr_Approved';

const voteSchema = z.object({
  vote_id: z.number(),
  sess_item_dscr: z.string().nullable().optional(),
  vote_item_dscr: z.string().nullable().optional(),
  vote_date: z.string().nullable().optional(),
  total_for: z.number().nullable().optional(),
  total_against: z.number().nullable().optional(),
  total_abstain: z.number().nullable().optional(),
});
type Vote = z.infer<typeof voteSchema>;

const responseSchema = z.object({
  value: z.array(voteSchema).optional(),
});

/** Outcome polarity in [-10, 10]: the for/against margin (ADR-0008 tone signal). */
function toneOf(forV: number, against: number): number {
  const total = forV + against;
  return total === 0 ? 0 : ((forV - against) / total) * 10;
}

export interface KnessetVotesDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
}

/**
 * Knesset recorded-votes adapter over the official Votes.svc OData feed
 * (ADR-0021). Distinct from the `knesset` bills adapter. Topic=Israel (skips
 * the classifier, ADR-0009). A BOTH source: for/against/
 * abstain tallies become points (`total_for`), mentions (participation), and a
 * tone signal (the margin). Hebrew titles; the Reasoner can translate downstream.
 */
export class KnessetVotesSource implements SourceAdapter {
  readonly id = 'knesset-votes' as const;

  constructor(private readonly deps: KnessetVotesDeps) {}

  private url(top: number): string {
    return `${BASE}?$top=${top}&$orderby=vote_date%20desc&$format=json`;
  }

  async healthCheck(): Promise<boolean> {
    try {
      return responseSchema.safeParse(await this.deps.fetchJson(this.url(1)))
        .success;
    } catch {
      return false;
    }
  }

  async extract(): Promise<RawItem[]> {
    const parsed = responseSchema.parse(
      await this.deps.fetchJson(this.url(this.deps.maxItems)),
    );
    return (parsed.value ?? [])
      .map((v) => this.toRawItem(v))
      .filter((i): i is RawItem => i !== null);
  }

  private toRawItem(v: Vote): RawItem | null {
    const billDesc = (v.sess_item_dscr ?? '').trim();
    const voteDesc = (v.vote_item_dscr ?? '').trim();
    // Require the bill / session-item description (the unique identifier). A vote
    // with only a generic action label (e.g. bare "הסתייגות") is unpresentable AND
    // dedup-merges across unrelated bills, since every reservation shares the same
    // title. Carrying the bill name in the title + text disambiguates them so
    // votes on the same bill cluster while different bills stay apart (ADR-0036).
    if (!billDesc) return null;
    const title = voteDesc ? `${billDesc} — ${voteDesc}` : billDesc;

    const forV = v.total_for ?? 0;
    const against = v.total_against ?? 0;
    const abstain = v.total_abstain ?? 0;
    // A factual recap doubles as the dedup body lead and the summary fallback.
    const text = `${title}. בעד ${forV}, נגד ${against}, נמנעו ${abstain}.`;
    const metadata: SourceMetadata = {
      topic: 'Israel',
      points: forV,
      mentions: forV + against + abstain,
      tone: toneOf(forV, against),
    };
    return {
      source: 'knesset-votes',
      externalId: String(v.vote_id),
      title,
      url: null,
      text,
      publishedAt: parseDateOrNull(v.vote_date),
      metadata,
    };
  }
}
