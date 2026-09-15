/* The quote routes' manners: who may ask, how often, and how many prices one
 * instance works out at once.
 *
 * Lives apart from the routes for the reason nudgeGate.server.ts does: a Next
 * route file may export only its handlers and config, and this is the part
 * worth testing. Pure apart from its clock, which is injectable.
 *
 * WHAT THIS PROTECTS. /api/quote and /api/quote/proof are public and take no
 * key. Neither can be made to fetch anything but the pinned venues' fixed
 * requests for a roster stock (venues247.ts builds every URL from the pins),
 * but each composite asks nine venues and the exchange, so a stranger asking
 * for a thousand boundaries would make this server ask those venues ten
 * thousand times, and get it rate limited everywhere. These limits keep that
 * small:
 *
 *   per IP              a token bucket, 30 a minute with a burst of 10
 *   per (feed, boundary) one computation at a time, joined by everyone asking;
 *                       a final answer kept for six hours, a fallback to the
 *                       exchange until the exchange can price it, a wait for
 *                       three seconds
 *   per instance        at most 2 prices worked out at once, 8 more queued,
 *                       and anything past that told to come back
 *
 * Per warm instance, like the nudge's limits; the venues' own rate limits are
 * the last line, and a 429 from one is a wait, never a different price. */

import { boundaryOf } from "./crankTx";
import { SOURCE_SIGNED, type DuelView } from "./duel";
import { NudgeGate, type Admission } from "./nudgeGate.server";

export const QUOTE_PER_IP_PER_MINUTE = 30;
export const QUOTE_BURST = 10;

/* THE PROOF ROUTE'S OWN, SMALLER BUDGET.
 *
 * A proof for a new minute makes this server ask up to nine venues and the
 * exchange, and Hyperliquid allows 1,200 weight a minute per IP, about 54 of
 * these requests. At the quote route's 30 a minute, two strangers walking
 * boundaries could spend that on their own, and every real fight waiting on
 * Hyperliquid would then wait on them. So the proof route asks for a real
 * fight's own boundary (proofTarget) and allows 12 a minute per IP with a
 * burst of 4, which is one fight page opening all four of its proofs. */
export const PROOF_PER_IP_PER_MINUTE = 12;
export const PROOF_BURST = 4;

/* WHICH PROOF A FIGHT CAN ASK FOR.
 *
 * A side of this fight that the oracle signs (its feed, recorded as signed),
 * at this fight's start or settle boundary: the proof route recomputes nothing
 * else, so a caller cannot choose the minutes this server fetches. The words
 * are the route's 4xx answer. */
export function proofTarget(
  d: Pick<DuelView, "acceptedTs" | "endTs" | "creatorFeed" | "opponentFeed" | "creatorSource" | "opponentSource">,
  which: "start" | "settle",
  feed: string,
): { boundary: number } | { refused: string } {
  const f = feed.replace(/^0x/, "").toLowerCase();
  const side = f === d.creatorFeed ? d.creatorSource : f === d.opponentFeed ? d.opponentSource : null;
  if (side === null) return { refused: "That feed is not a side of this fight." };
  if (side !== SOURCE_SIGNED) return { refused: "That side of this fight is priced by Pyth, not the oracle." };
  if (which === "start" ? d.acceptedTs === 0 : d.endTs === 0) return { refused: `This fight has no ${which} boundary yet.` };
  return { boundary: boundaryOf(d, which) };
}
export const MAX_COMPUTING = 2;
export const MAX_QUEUED = 8;
/** A final answer is history, so it is kept as long as memory allows. */
export const FINAL_REUSE_MS = 6 * 3_600_000;
/** A wait changes as soon as a candle lands; a page asks again in seconds. */
export const WAIT_REUSE_MS = 3_000;
export const MAX_ANSWERS = 5_000;

/* HOW LONG AN ORACLE ANSWER STAYS TRUE.
 *
 * A quote is history: kept FINAL_REUSE_MS. A composite side that fell back to
 * the exchange will not change until the exchange's bar can be final, so it is
 * kept until then (never less than a wait, never more than a final answer),
 * and asked again after, when it becomes a quote. Any other wait changes the
 * moment a candle lands. `nowMs` is Date.now() time. */
export function answerReuseMs(a: { quote: unknown; parkedUntil: number | null }, nowMs: number): number {
  if (a.quote) return FINAL_REUSE_MS;
  if (a.parkedUntil !== null) return Math.max(WAIT_REUSE_MS, Math.min(FINAL_REUSE_MS, a.parkedUntil * 1_000 - nowMs));
  return WAIT_REUSE_MS;
}

/** The instance is working out as many prices as it will; try again shortly. */
export class Busy extends Error {
  constructor(readonly retryAfterSecs = 5) {
    super("This server is working out other prices; try again in a few seconds.");
    this.name = "Busy";
  }
}

type Clock = () => number;

export class QuoteGate<T> {
  private readonly now: Clock;
  private readonly bucket: NudgeGate;
  private readonly reuseMs: (value: T) => number;
  private readonly maxComputing: number;
  private readonly maxQueued: number;
  private readonly maxKeys: number;

  private readonly answers = new Map<string, { value: T; until: number }>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(opts: {
    reuseMs: (value: T) => number;
    now?: Clock;
    perMinute?: number;
    burst?: number;
    maxComputing?: number;
    maxQueued?: number;
    maxKeys?: number;
  }) {
    this.now = opts.now ?? Date.now;
    this.reuseMs = opts.reuseMs;
    this.bucket = new NudgeGate({ now: this.now, perMinute: opts.perMinute ?? QUOTE_PER_IP_PER_MINUTE, burst: opts.burst ?? QUOTE_BURST });
    this.maxComputing = opts.maxComputing ?? MAX_COMPUTING;
    this.maxQueued = opts.maxQueued ?? MAX_QUEUED;
    this.maxKeys = opts.maxKeys ?? MAX_ANSWERS;
  }

  /** The per-IP bucket, the same one the nudge uses. */
  admit(ip: string): Admission {
    return this.bucket.admit(ip);
  }

  /* ONE COMPUTATION PER KEY, AND ONLY A FEW AT ONCE.
   *
   * A kept answer is handed back as it is, and a computation already running
   * for the key is joined. Otherwise `work` waits for one of maxComputing
   * slots; with maxQueued already waiting it is refused with Busy instead,
   * before anything is fetched. A computation that throws is not kept. */
  run(key: string, work: () => Promise<T>): Promise<T> {
    const kept = this.answers.get(key);
    if (kept && kept.until > this.now()) return Promise.resolve(kept.value);
    const flying = this.inFlight.get(key);
    if (flying) return flying;
    if (this.active >= this.maxComputing && this.queue.length >= this.maxQueued) return Promise.reject(new Busy());

    const run = (async () => {
      if (this.active < this.maxComputing) this.active++;
      else await new Promise<void>((resolve) => this.queue.push(resolve));
      try {
        const value = await work();
        const ms = this.reuseMs(value);
        this.answers.delete(key);
        if (ms > 0) {
          this.answers.set(key, { value, until: this.now() + ms });
          this.sweep();
        }
        return value;
      } finally {
        this.inFlight.delete(key);
        const next = this.queue.shift();
        if (next) next();
        else this.active--;
      }
    })();
    this.inFlight.set(key, run);
    return run;
  }

  private sweep(): void {
    if (this.answers.size <= this.maxKeys) return;
    const t = this.now();
    for (const [k, v] of this.answers) if (v.until <= t) this.answers.delete(k);
    for (const k of this.answers.keys()) {
      if (this.answers.size <= this.maxKeys) break;
      this.answers.delete(k);
    }
  }
}
