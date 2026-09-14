/* The page nudge's manners: who may ask, how often, and how a crowd of pages
 * watching one fight becomes one crank.
 *
 * Lives apart from the route for the reason crankAuth.server.ts does: a Next
 * route file may export only its handlers and config, and this is the part
 * worth testing. Pure: it holds maps and a clock, and the clock is injectable,
 * so every limit here is tested without waiting for it.
 *
 * WHAT THIS PROTECTS. The nudge takes nothing but a duel address and spends the
 * nudge key's SOL only on a crank the chain would accept from anyone, so the
 * worst a stranger can do with it is make this server work. These limits keep
 * that work small:
 *
 *   per IP        a token bucket, 20 a minute with a burst of 10
 *   per duel      one run at a time; an answer is reused for a few seconds
 *                 (a minute for "not a fight"), and for 20 seconds after a send
 *   per instance  at most 30 crank attempts a minute
 *
 * All of it is per warm instance, which is what serverless gives: two
 * instances each keep their own. That is why none of it is the last line.
 * The program refuses a second start or settle, preflight catches that before
 * any fee, and the nudge key's own balance is a hard ceiling on spend. */

import type { NudgeState } from "./nudgeSchedule";

type Clock = () => number;

const EPSILON = 1e-9;

/* Each answer is reused for as long as it stays true enough. "Not yet" and
 * "nothing due" change at most once a price or a status does, and a page asks
 * again in seconds anyway. A failure is kept for as long as it tells the page
 * to wait (retryAt = now + 10), so a crowd cannot turn one broken fight into a
 * crank attempt per visitor. A send is kept for 20 seconds: no new attempt
 * while the first confirms. An address that is not a fight stays not a fight. */
export const REUSE_MS: Record<NudgeState, number> = {
  "nothing-due": 3_000,
  "waiting-for-market": 3_000,
  "not-yet": 3_000,
  done: 3_000,
  failed: 10_000,
  sent: 20_000,
  "not-found": 60_000,
  disabled: 0,
  refused: 0,
};

export const PER_IP_PER_MINUTE = 20;
export const PER_IP_BURST = 10;
export const SENDS_PER_MINUTE = 30;
/** Beyond this many remembered keys a map is swept, then trimmed oldest first. */
export const MAX_KEYS = 10_000;

export type Admission = { ok: true } | { ok: false; retryAfterSecs: number };

export type GateOptions = {
  now?: Clock;
  perMinute?: number;
  burst?: number;
  sendsPerMinute?: number;
  maxKeys?: number;
  reuseMs?: Partial<Record<NudgeState, number>>;
};

/** Drop a map's oldest entries (Maps iterate in insertion order) down to `max`. */
function trim<K, V>(map: Map<K, V>, max: number): void {
  for (const k of map.keys()) {
    if (map.size <= max) return;
    map.delete(k);
  }
}

export class NudgeGate<A extends { state: NudgeState } = { state: NudgeState }> {
  private readonly now: Clock;
  private readonly perMinute: number;
  private readonly burst: number;
  private readonly sendsPerMinute: number;
  private readonly maxKeys: number;
  private readonly reuseMs: Record<NudgeState, number>;

  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly answers = new Map<string, { answer: A; until: number }>();
  private readonly inFlight = new Map<string, Promise<A>>();
  private sends: { token: number; at: number }[] = [];
  private sendSeq = 0;

  constructor(opts: GateOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.perMinute = opts.perMinute ?? PER_IP_PER_MINUTE;
    this.burst = opts.burst ?? PER_IP_BURST;
    this.sendsPerMinute = opts.sendsPerMinute ?? SENDS_PER_MINUTE;
    this.maxKeys = opts.maxKeys ?? MAX_KEYS;
    this.reuseMs = { ...REUSE_MS, ...opts.reuseMs };
  }

  /* THE PER-IP BUCKET. It holds up to `burst` tokens and refills at
   * `perMinute` a minute; each request takes one. A page following the
   * schedule asks a handful of times a fight, so only something hammering
   * ever finds it empty. */
  admit(ip: string): Admission {
    const t = this.now();
    const perMs = this.perMinute / 60_000;
    const kept = this.buckets.get(ip);
    const tokens = kept ? Math.min(this.burst, kept.tokens + (t - kept.at) * perMs) : this.burst;
    // Re-inserted, so the map's order stays oldest-touched first for trimming.
    this.buckets.delete(ip);
    // A hair of slack, so thirds of a token that add up to one count as one.
    if (tokens < 1 - EPSILON) {
      this.buckets.set(ip, { tokens, at: t });
      return { ok: false, retryAfterSecs: Math.max(1, Math.ceil((1 - tokens) / perMs / 1_000 - EPSILON)) };
    }
    this.buckets.set(ip, { tokens: tokens - 1, at: t });
    if (this.buckets.size > this.maxKeys) {
      // A full bucket is the same as no bucket, so those go first.
      for (const [k, b] of this.buckets) {
        if (b.tokens + (t - b.at) * perMs >= this.burst) this.buckets.delete(k);
      }
      trim(this.buckets, this.maxKeys);
    }
    return { ok: true };
  }

  /* ONE RUN PER DUEL. A recent answer is handed back as it is; a run already
   * going is joined, not repeated; otherwise `work` runs, and its answer is
   * kept for as long as REUSE_MS says. Fifty pages asking at the same second
   * get one getAccountInfo, one quote and at most one crank between them. A
   * run that throws is not remembered, and the next caller starts afresh. */
  run(duel: string, work: () => Promise<A>): Promise<A> {
    const kept = this.answers.get(duel);
    if (kept && kept.until > this.now()) return Promise.resolve(kept.answer);
    const flying = this.inFlight.get(duel);
    if (flying) return flying;

    const run = (async () => {
      try {
        const answer = await work();
        const ms = this.reuseMs[answer.state] ?? 0;
        this.answers.delete(duel);
        if (ms > 0) this.answers.set(duel, { answer, until: this.now() + ms });
        this.sweepAnswers();
        return answer;
      } finally {
        this.inFlight.delete(duel);
      }
    })();
    this.inFlight.set(duel, run);
    return run;
  }

  private sweepAnswers(): void {
    if (this.answers.size <= this.maxKeys) return;
    const t = this.now();
    for (const [k, v] of this.answers) if (v.until <= t) this.answers.delete(k);
    trim(this.answers, this.maxKeys);
  }

  /* THE INSTANCE'S SEND BUDGET. Taken just before a crank attempt, which may
   * pay a fee; given back when the attempt turned out to send nothing (the
   * fight was already done, its price was not ready, or it failed before
   * anything reached the RPC). At most `sendsPerMinute` in any sliding minute.
   *
   * takeSend hands back a token, or null when the budget is spent, and
   * returnSend takes that token. Giving back "the latest" instead, as this
   * first did, removed whichever send was taken most recently: a run that took
   * its slot at 0s and gave it back at 40s freed a slot a real send took at
   * 39s, and left its own to expire early, so a minute could hold more sends
   * than the limit. */
  takeSend(): number | null {
    const t = this.now();
    this.sends = this.sends.filter((s) => t - s.at < 60_000);
    if (this.sends.length >= this.sendsPerMinute) return null;
    const token = ++this.sendSeq;
    this.sends.push({ token, at: t });
    return token;
  }

  returnSend(token: number): void {
    const i = this.sends.findIndex((s) => s.token === token);
    if (i >= 0) this.sends.splice(i, 1);
  }
}

/* A SHORT MEMORY FOR READS. One value per key for `ttlMs`, with concurrent
 * callers sharing the read in flight. A read that fails is not remembered.
 * The nudge keeps duel accounts this way for two seconds, so a page polling
 * and a page nudging at the same moment cost the RPC one call. */
export class Recent<T> {
  private readonly entries = new Map<string, { at: number; value: Promise<T> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: Clock = Date.now,
    private readonly maxKeys = MAX_KEYS,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const t = this.now();
    const hit = this.entries.get(key);
    if (hit && t - hit.at < this.ttlMs) return hit.value;
    const entry = { at: t, value: load() };
    this.entries.delete(key);
    this.entries.set(key, entry);
    entry.value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    if (this.entries.size > this.maxKeys) {
      for (const [k, v] of this.entries) if (t - v.at >= this.ttlMs) this.entries.delete(k);
      trim(this.entries, this.maxKeys);
    }
    return entry.value;
  }
}

/** Same-site only, as /api/rpc: a page of ours, or a same-origin request that
 *  sends no Origin at all. An Origin header is whatever the caller says, so
 *  this keeps other sites' pages off the endpoint and stops nobody else. */
export function sameSite(origin: string | null, host: string | null): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/* Who is asking, for the bucket. On Vercel both headers are set by the
 * platform, which overwrites whatever the client sent; anywhere else they can
 * be forged, and the bucket is then a courtesy. Everyone with neither shares
 * one bucket, which errs towards refusing. */
export function clientIp(headers: { get(name: string): string | null }): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

/* NOTHING SECRET IN AN ANSWER. A failed crank's detail is an error message,
 * and an error from a fetch or an RPC client can quote the URL it was calling,
 * which for a paid RPC or Hermes carries the key. The detail goes to any
 * visitor, so every configured secret is cut out of it, along with anything
 * shaped like a key in a query string, and it is kept short. */
export function redact(text: string, secrets: (string | undefined)[], max = 300): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join("[redacted]");
  }
  out = out.replace(/([?&](?:api[-_]?key|access[-_]?token|token|key)=)[^&\s"'<>]+/gi, "$1[redacted]");
  return out.length > max ? `${out.slice(0, max - 3)}...` : out;
}
