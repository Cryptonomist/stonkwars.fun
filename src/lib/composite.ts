/* Composite-v1: one price for a US stock while its exchange is shut, from the
 * one-minute closes of the markets that trade it around the clock.
 *
 * The rule is docs/247-pricing.md, section 3, and this file is that rule and
 * nothing else: no network, no clock of its own, no roster. It takes what the
 * pinned venues answered for one minute (src/lib/venues247.ts fetches it) and
 * returns a price with the proof of how it was reached, or says why it waits.
 *
 *   minute     m = floor(b / 60) * 60; the price is stamped m + 60, exactly as
 *              a perp's bar close is, so the program and the price clock see
 *              the same times they always have
 *   per venue  the close of the latest candle at or before m, and whether any
 *              candle from m - 14 minutes to m traded
 *   quorum     at least 3 fresh venues, at least 2 of them anchors
 *   guard      drop any close more than 50 bps from the median of the fresh
 *              ones, and ask for the quorum again
 *   price      the median of what is left, in integer 1e-4 ticks
 *   breaker    more than 15% from the exchange's last close is a failed quorum
 *   fallbacks  exactly 2 fresh anchors within 25 bps: their mean; otherwise the
 *              exchange's first bar after b, which cannot exist before it opens
 *
 * WHY IT IS PURE. The quote route is public and a quote names no duel, so the
 * price for (stock, boundary) has to be one answer whoever asks and whenever.
 * Everything here is a function of the rows passed in, and the rows are
 * history. A venue that could not be read is a wait, never a venue left out:
 * leaving it out would make the price depend on the moment somebody asked.
 *
 * WHY INTEGERS. A median of floats is the same number on every machine, but
 * the guard and the breaker compare ratios, and a ratio in floating point can
 * land either side of 50 bps depending on how it was written. Closes become
 * integer ticks first (1e-4, the quote's own exponent, rounded half away from
 * zero from the decimal text the venue sent), and every comparison after that
 * is exact.
 *
 * Free of Node and of the network, so the pages can import it. */

export const COMPOSITE_RULE = "composite-v1";

/* WHERE THE COMPOSITE TAKES OVER.
 *
 * A boundary at or after this moment, while the exchange is shut, is priced by
 * the composite for a stock listed in src/data/venues247.json. Every boundary
 * before it keeps the perp and pool rules it was priced by, so a fight already
 * running when this ships ends the way it started. Unix seconds. 1,789,600,000
 * is Wednesday 16 Sep 2026, 7:06:40 PM New York: a placeholder in the future.
 * The release sets the real value at deploy (docs/247-pricing.md, step 7). */
export const COMPOSITE_FROM = 1_789_600_000;

/** A candle traded this recently (m - 840 to m) makes its venue fresh. */
export const FRESH_SECS = 840;
/** Every window reaches this far back from m. */
export const WINDOW_SECS = 3_600;
export const QUORUM = 3;
export const QUORUM_ANCHORS = 2;
export const GUARD_BPS = 50n;
export const TWO_ANCHOR_BPS = 25n;
export const BREAKER_BPS = 1_500n;
/** Ticks per dollar: prices are integers of 1e-4, as QUOTE_EXPO says. */
export const TICKS = 10_000n;

const DAY = 86_400;

export type VenueId = "hyperliquid" | "okx" | "bitget" | "binance" | "lighter" | "backpack" | "gate" | "mexc" | "bingx";

/* THE NINE VENUES, IN THE ORDER A PROOF LISTS THEM.
 *
 *   anchor       real volume, measured: it can make up the two a quorum needs.
 *                Gate, MEXC and BingX print a trade nearly every minute on
 *                very little volume, even on BRK.B on a Saturday, so they count
 *                towards three but can never be the two.
 *   forwardFill  the venue omits a minute nobody traded and repeats the last
 *                close when it does print one (Hyperliquid: 0 of 10,754 quiet
 *                minutes changed close; Backpack only drops quiet minutes at the
 *                start of a window). A missing minute m there is simply quiet.
 *                Every other venue prints every minute, so a missing minute m
 *                there means its candle is not out yet.
 *   retention    how long its one-minute history is served (the plan's table,
 *                measured 14 Sep 2026). A proof older than the shortest one in
 *                a stock's set cannot be recomputed, so nothing that old is
 *                signed. */
export const VENUES: Record<VenueId, { name: string; anchor: boolean; forwardFill: boolean; retentionSecs: number }> = {
  hyperliquid: { name: "Hyperliquid", anchor: true, forwardFill: true, retentionSecs: 3 * DAY },
  okx: { name: "OKX", anchor: true, forwardFill: false, retentionSecs: 29 * DAY },
  bitget: { name: "Bitget", anchor: true, forwardFill: false, retentionSecs: 29 * DAY },
  binance: { name: "Binance", anchor: true, forwardFill: false, retentionSecs: 29 * DAY },
  lighter: { name: "Lighter", anchor: true, forwardFill: false, retentionSecs: 29 * DAY },
  backpack: { name: "Backpack", anchor: true, forwardFill: true, retentionSecs: 29 * DAY },
  gate: { name: "Gate", anchor: false, forwardFill: false, retentionSecs: 6 * DAY },
  mexc: { name: "MEXC", anchor: false, forwardFill: false, retentionSecs: 25 * DAY },
  bingx: { name: "BingX", anchor: false, forwardFill: false, retentionSecs: 29 * DAY },
};
export const VENUE_ORDER = Object.keys(VENUES) as VenueId[];

/** One minute as a venue reported it: its start (unix seconds), its close as
 *  the decimal text the venue sent, and whether anything traded in it. */
export type Candle = { t: number; close: string; traded: boolean };

/** The exact request a window came from, so anyone can make it again. */
export type VenueRequest = { method: "GET"; url: string } | { method: "POST"; url: string; body: string };

/** What one pinned venue answered for a minute: its rows, or why it could not
 *  be read. */
export type VenueWindow = { venue: VenueId; instrument: string; request: VenueRequest } & (
  | { rows: Candle[] }
  | { error: string }
);

/** The exchange's last one-minute close before the boundary, for the breaker:
 *  found, not there, or not readable just now. */
export type Reference = { t: number; close: string } | null | { error: string };

export type Tier = null | "two-anchor" | "exchange";

export type ProofRow = {
  venue: VenueId;
  name: string;
  instrument: string;
  anchor: boolean;
  request: VenueRequest;
  /** Start of the latest candle at or before m, or null. */
  candle: number | null;
  close: string | null;
  /** The close in integer ticks, as decimal text (JSON has no bigint). */
  ticks: string | null;
  /** Start of the latest traded candle at or before m in the window. */
  lastTraded: number | null;
  fresh: boolean;
  kept: boolean;
  /** kept; stale (nothing traded in 15 minutes); no-candle; bad-close;
   *  diverged (more than 50 bps from the median of the fresh closes); or
   *  no-quorum (fresh and inside the guard, but the rule priced nothing from
   *  it). */
  why: "kept" | "stale" | "no-candle" | "bad-close" | "diverged" | "no-quorum";
};

export type CompositeProof = {
  rule: typeof COMPOSITE_RULE;
  boundary: number;
  minute: number;
  publishTime: number;
  venues: ProofRow[];
  fresh: number;
  freshAnchors: number;
  /** Median of the fresh closes, the guard's centre, in ticks. */
  m0: string | null;
  kept: number;
  keptAnchors: number;
  /** Median of the kept closes, in ticks. */
  median: string | null;
  reference: { t: number; close: string; ticks: string } | null;
  tier: Tier;
  /** Why a fallback was taken; null when the median priced it. */
  reason: string | null;
  /** The signed price in ticks; null when the exchange prices it. */
  price: string | null;
};

export type CompositePriced = { price: bigint; publishTime: number; tier: "two-anchor" | null; proof: CompositeProof; sha256: string };
/** Ask again: `retryAt` when the rule knows the earliest worth asking. */
export type CompositeWait = { wait: string; retryAt: number | null };
/** The exchange prices this side, and its bar cannot be final before `waitUntil`. */
export type CompositeWaitUntil = { waitUntil: number; reason: string; proof: CompositeProof; sha256: string };
export type CompositeRefused = { refused: string };
export type CompositeResult = CompositePriced | CompositeWait | CompositeWaitUntil | CompositeRefused;

export const minuteOf = (boundary: number) => Math.floor(boundary / 60) * 60;

/* A CLOSE AS AN INTEGER NUMBER OF TICKS.
 *
 * From the decimal text, not a float: "359.88" is 3,598,800 ticks exactly, and
 * "366.16505" rounds half away from zero to 3,661,651. A number a venue sent as
 * JSON is turned back into its shortest decimal text first (closeText), which
 * is the text the venue wrote. Null for anything that is not a positive price. */
export function toTicks(close: string): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(close.trim());
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(5, "0");
  let ticks = BigInt(m[1]) * TICKS + BigInt(frac.slice(0, 4));
  if (frac.charCodeAt(4) >= 53) ticks += 1n; // the fifth decimal is 5 or more
  return ticks > 0n ? ticks : null;
}

/** A venue's close, number or text, as decimal text; null if it is neither. */
export function closeText(close: unknown): string | null {
  if (typeof close === "string") return close.trim();
  if (typeof close !== "number" || !Number.isFinite(close)) return null;
  const s = String(close);
  return /e/i.test(s) ? close.toFixed(12).replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** The median of integer ticks; with an even count, floor((a + b + 1) / 2) of
 *  the middle two. */
export function medianTicks(values: bigint[]): bigint {
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = s.length;
  if (n === 0) throw new Error("median of nothing");
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2] + 1n) / 2n;
}

const abs = (x: bigint) => (x < 0n ? -x : x);
/** Whether `x` is within `bps` of `centre`: |x - centre| * 10,000 <= bps * centre. */
const within = (x: bigint, centre: bigint, bps: bigint) => abs(x - centre) * 10_000n <= bps * centre;

/* WHAT ONE VENUE SAYS ABOUT MINUTE m.
 *
 * Only rows inside the window count (m - 3600 to m), however many the venue
 * returned: Lighter hands back count_back rows whatever the start, and a
 * forward-filling venue may by now have printed quiet minutes after m. Rows
 * are put in time order first, because OKX and BingX send the newest first. */
function readVenue(w: VenueWindow & { rows: Candle[] }, m: number): Omit<ProofRow, "kept" | "why"> & { pending: boolean; value: bigint | null } {
  const spec = VENUES[w.venue];
  const rows = w.rows.filter((r) => Number.isInteger(r.t) && r.t % 60 === 0).sort((a, b) => a.t - b.t);
  let latest: Candle | null = null;
  let lastTraded: number | null = null;
  let hasM = false;
  let later = false;
  for (const r of rows) {
    if (r.t > m) {
      later = true;
      continue;
    }
    if (r.t < m - WINDOW_SECS) continue;
    latest = r; // sorted, so the last one kept is the latest; a repeated minute keeps its last row
    if (r.t === m) hasM = true;
    if (r.traded) lastTraded = r.t;
  }
  /* A venue that prints every minute and has not printed m yet is not quiet,
   * it is late. With a later minute already out, m was skipped and counts as
   * no trade; with none, the answer is not in yet. */
  const pending = !spec.forwardFill && !hasM && !later;
  const value = latest ? toTicks(latest.close) : null;
  return {
    venue: w.venue,
    name: spec.name,
    instrument: w.instrument,
    anchor: spec.anchor,
    request: w.request,
    candle: latest?.t ?? null,
    close: latest?.close ?? null,
    ticks: value === null ? null : value.toString(),
    lastTraded,
    fresh: value !== null && lastTraded !== null && lastTraded >= m - FRESH_SECS,
    pending,
    value,
  };
}

/** The earliest moment a composite for `boundary` can be asked, and whether
 *  it is too late to sign one for a set with these venues. Pure gate, no rows. */
export function compositeGate(opts: {
  boundary: number;
  now: number;
  settleSecs: number;
  venues: VenueId[];
}): CompositeWait | CompositeRefused | null {
  const m = minuteOf(opts.boundary);
  const finalAt = m + 60 + opts.settleSecs;
  if (opts.now < finalAt) return { wait: `the minute is not final until ${finalAt}`, retryAt: finalAt };
  /* TOO LATE TO SIGN. A proof has to be recomputable from the venues' own
   * history, and the shortest history in the set sets how long that is: three
   * days whenever Hyperliquid is pinned. */
  const retention = Math.min(...opts.venues.map((v) => VENUES[v].retentionSecs));
  if (opts.venues.length && opts.now - opts.boundary > retention) {
    return { refused: `the boundary is older than the ${Math.round(retention / DAY)} days its venues keep minutes for` };
  }
  return null;
}

/* THE RULE, STEPS 1 TO 8.
 *
 * `windows` holds one entry per venue pinned for the stock at the boundary, in
 * any order. `reference` is the exchange's last close before the boundary.
 * `exchangeFinal` is when the exchange's first bar after the boundary can be
 * final (oracle.ts, exchangeBarFinal), the time a fallback to it waits for;
 * null if no session opens within ten days. */
export function compositeAt(opts: {
  boundary: number;
  now: number;
  settleSecs: number;
  windows: VenueWindow[];
  reference: Reference;
  exchangeFinal: number | null;
}): CompositeResult {
  const { boundary } = opts;
  const m = minuteOf(boundary);
  const gate = compositeGate({ ...opts, venues: opts.windows.map((w) => w.venue) });
  if (gate) return gate;

  // Step 2, and no guesses: a venue that did not answer is a wait.
  const failed = opts.windows.flatMap((w) => ("error" in w ? [`${VENUES[w.venue].name} ${w.instrument}: ${w.error}`] : []));
  if (failed.length) return { wait: `waiting on ${failed.join("; ")}`, retryAt: null };

  const read = opts.windows
    .map((w) => readVenue(w as VenueWindow & { rows: Candle[] }, m))
    .sort((a, b) => VENUE_ORDER.indexOf(a.venue) - VENUE_ORDER.indexOf(b.venue) || (a.instrument < b.instrument ? -1 : a.instrument > b.instrument ? 1 : 0));
  const pending = read.filter((r) => r.pending);
  if (pending.length) {
    return { wait: `no candle for ${m} yet at ${pending.map((r) => `${r.name} ${r.instrument}`).join(", ")}`, retryAt: null };
  }

  // Step 3: quorum on the fresh venues.
  type Read = (typeof read)[number];
  const fresh = read.filter((r) => r.fresh);
  const anchorsOf = (rows: Read[]) => rows.filter((r) => r.anchor).length;
  let m0: bigint | null = null;
  let survivors: Read[] = [];
  let median: bigint | null = null;
  let reason: string | null = null;

  if (fresh.length >= QUORUM && anchorsOf(fresh) >= QUORUM_ANCHORS) {
    // Step 4: the divergence guard, then the quorum again on what survives.
    m0 = medianTicks(fresh.map((r) => r.value!));
    survivors = fresh.filter((r) => within(r.value!, m0!, GUARD_BPS));
    if (survivors.length >= QUORUM && anchorsOf(survivors) >= QUORUM_ANCHORS) {
      // Step 5.
      median = medianTicks(survivors.map((r) => r.value!));
    } else {
      reason = `${survivors.length} of ${fresh.length} fresh markets (${anchorsOf(survivors)} anchors) within 50 bps of their median; the rule needs 3 with 2 anchors`;
    }
  } else {
    reason = `${fresh.length} markets (${anchorsOf(fresh)} anchors) traded in the 15 minutes before ${m + 60}; the rule needs 3 with 2 anchors`;
  }

  /* Each venue's row says what the rule did with it: kept (priced from it),
   * or why not. "no-quorum" is a fresh close inside the guard that priced
   * nothing, because too few others joined it or the breaker tripped. */
  const rowsFor = (used: Read[]): ProofRow[] =>
    read.map((r) => {
      const kept = used.includes(r);
      const why: ProofRow["why"] = kept
        ? "kept"
        : r.candle === null
          ? "no-candle"
          : r.value === null
            ? "bad-close"
            : !r.fresh
              ? "stale"
              : m0 !== null && !within(r.value, m0, GUARD_BPS)
                ? "diverged"
                : "no-quorum";
      return {
        venue: r.venue,
        name: r.name,
        instrument: r.instrument,
        anchor: r.anchor,
        request: r.request,
        candle: r.candle,
        close: r.close,
        ticks: r.ticks,
        lastTraded: r.lastTraded,
        fresh: r.fresh,
        kept,
        why,
      };
    });

  // Step 6 needs the exchange's last close; not being able to read it is a wait.
  const ref = opts.reference;
  const refTicks = ref && !("error" in ref) ? toTicks(ref.close) : null;
  const breaker = (price: bigint): string | null => {
    if (refTicks === null) return null;
    if (within(price, refTicks, BREAKER_BPS)) return null;
    const bps = (abs(price - refTicks) * 10_000n) / refTicks;
    return `${bps} bps from the exchange's last close, beyond the 1,500 bps breaker`;
  };
  const needReference = (): CompositeWait | null =>
    ref === null
      ? { wait: "no exchange close before the boundary to check the price against", retryAt: null }
      : "error" in ref
        ? { wait: `the exchange's last close could not be read: ${ref.error}`, retryAt: null }
        : refTicks === null
          ? { wait: `the exchange's last close ${ref.close} is not a price`, retryAt: null }
          : null;

  /* THE REFERENCE IS IN A PROOF ONLY WHEN A PRICE WAS CHECKED AGAINST IT.
   * A side that fell back for want of a quorum never needed the exchange's
   * close, and whether that close could be read at the time is not history:
   * carrying it would give the same minute two hashes on two instances. */
  let checked = false;
  const proofOf = (tier: Tier, used: Read[], price: bigint | null, why: string | null): CompositeProof => ({
    rule: COMPOSITE_RULE,
    boundary,
    minute: m,
    publishTime: m + 60,
    venues: rowsFor(used),
    fresh: fresh.length,
    freshAnchors: anchorsOf(fresh),
    m0: m0 === null ? null : m0.toString(),
    kept: used.length,
    keptAnchors: anchorsOf(used),
    median: median === null ? null : median.toString(),
    reference: checked && ref && !("error" in ref) && refTicks !== null ? { t: ref.t, close: ref.close, ticks: refTicks.toString() } : null,
    tier,
    reason: why,
    price: price === null ? null : price.toString(),
  });
  const priced = (price: bigint, tier: "two-anchor" | null, used: Read[], why: string | null): CompositePriced => {
    const proof = proofOf(tier, used, price, why);
    return { price, publishTime: m + 60, tier, proof, sha256: proofHash(proof) };
  };

  if (median !== null) {
    const missing = needReference();
    if (missing) return missing;
    checked = true;
    const tripped = breaker(median);
    if (!tripped) return priced(median, null, survivors, null);
    reason = tripped;
  }

  // Step 8(a): exactly two fresh anchors, close together.
  const anchors = fresh.filter((r) => r.anchor);
  if (anchors.length === 2) {
    const [a, b] = [anchors[0].value!, anchors[1].value!];
    if (abs(a - b) * 20_000n <= TWO_ANCHOR_BPS * (a + b)) {
      const missing = needReference();
      if (missing) return missing;
      checked = true;
      const mean = (a + b + 1n) / 2n;
      if (!breaker(mean)) return priced(mean, "two-anchor", anchors, reason);
    }
  }

  // Step 8(b): the exchange's first bar after the boundary.
  if (opts.exchangeFinal === null) return { refused: `${reason}; and no exchange session opens within ten days` };
  const proof = proofOf("exchange", [], null, reason);
  return { waitUntil: opts.exchangeFinal, reason: reason ?? "", proof, sha256: proofHash(proof) };
}

/* CANONICAL JSON.
 *
 * Object keys sorted at every level, no whitespace, arrays in their own order
 * (the proof puts its venues in VENUE_ORDER). Two proofs with the same content
 * are the same bytes, so they have the same hash, whatever order anything was
 * built in. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("canonical JSON has no non-finite numbers");
    if (typeof value === "bigint") throw new Error("canonical JSON carries bigints as strings");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export const proofHash = (proof: CompositeProof) => sha256Hex(canonicalJson(proof));

/* SHA-256, IN PLAIN TYPESCRIPT.
 *
 * The fight page imports this file through the price clock, so it cannot lean
 * on node:crypto, and Web Crypto's digest is asynchronous where the rule is
 * not. The constants are derived the way the standard defines them (the
 * fractional parts of square and cube roots of the first primes) rather than
 * typed out, and tests-web/composite.test.ts holds the output to node:crypto. */
const PRIMES: number[] = [];
for (let n = 2; PRIMES.length < 64; n++) if (PRIMES.every((p) => n % p !== 0)) PRIMES.push(n);
const frac32 = (x: number) => ((x - Math.floor(x)) * 2 ** 32) >>> 0;
const K = Uint32Array.from(PRIMES, (p) => frac32(Math.cbrt(p)));
const H0 = Uint32Array.from(PRIMES.slice(0, 8), (p) => frac32(Math.sqrt(p)));
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  const blocks = Math.ceil((data.length + 9) / 64);
  const buf = new Uint8Array(blocks * 64);
  buf.set(data);
  buf[data.length] = 0x80;
  const view = new DataView(buf.buffer);
  const bits = data.length * 8;
  view.setUint32(buf.length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(buf.length - 4, bits >>> 0);
  const h = Uint32Array.from(H0);
  const w = new Uint32Array(64);
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      w[i] = w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}
