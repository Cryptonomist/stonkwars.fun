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
 * before it keeps the perp and pool rules it was priced by. The rule goes by
 * boundary, not by fight (a quote names no duel), so a fight taken before the
 * cutover whose end falls after it ends on the new rule: the release picks a
 * moment no open fight crosses, and scripts/cutover-check.ts lists any that
 * would. Unix seconds. 1,789,600,000 is Wednesday 16 Sep 2026, 7:06:40 PM New
 * York: a placeholder in the future. The release sets the real value at deploy
 * (docs/247-pricing.md, step 7). */
export const COMPOSITE_FROM = 1_789_452_900;

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

export type CompositePriced<P = CompositeProof> = { price: bigint; publishTime: number; tier: "two-anchor" | null; proof: P; sha256: string };
/** Ask again: `retryAt` when the rule knows the earliest worth asking. */
export type CompositeWait = { wait: string; retryAt: number | null };
/** The exchange prices this side, and its bar cannot be final before `waitUntil`. */
export type CompositeWaitUntil<P = CompositeProof> = { waitUntil: number; reason: string; proof: P; sha256: string };
export type CompositeRefused = { refused: string };
export type CompositeResult<P = CompositeProof> = CompositePriced<P> | CompositeWait | CompositeWaitUntil<P> | CompositeRefused;

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
 *  it is too late to sign one for a set with these venues. Pure gate, no rows.
 *  `windowSecs` is how long after m the rule's last minute closes: one minute
 *  for v1, the window for v2. */
export function compositeGate(opts: {
  boundary: number;
  now: number;
  settleSecs: number;
  venues: VenueId[];
  windowSecs?: number;
}): CompositeWait | CompositeRefused | null {
  const m = minuteOf(opts.boundary);
  const finalAt = m + (opts.windowSecs ?? 60) + opts.settleSecs;
  if (opts.now < finalAt) return { wait: `the minute is not final until ${finalAt}`, retryAt: finalAt };
  /* TOO LATE TO SIGN. A proof has to be recomputable from the venues' own
   * history, and the shortest history in the set sets how long that is: three
   * days whenever Hyperliquid is pinned. */
  const retention = historySecs(opts.venues);
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

/* ─── Composite-v2 ───────────────────────────────────────────────────────── */

/* COMPOSITE-V2: THE SAME MARKETS, MUCH HARDER TO PUSH.
 *
 * v1 prices one minute by the median of the venues that traded in it, and on
 * last weekend's minutes that is a price a single trade can decide. The fresh
 * venues sat a median 10 to 19 bps apart while the median 15-minute weekend
 * move was 1 to 2 bps, so one print on one venue in the end minute changed 43%
 * to 81% of 15-minute rounds, and one anchor print 60 bps off knocked a priced
 * side to Monday's bar in 5.4% of priced minutes (the adversarial study; the
 * measurements for v2 are in docs/247-hardening.md). v2 takes both levers away:
 *
 *   de-bias   every venue trades at a steady premium of its own to the rest
 *             (funding, fees, whoever makes its market), which is most of that
 *             10 to 19 bps. So each close is divided by its venue's premium:
 *             the median, over the minutes 75 to 6 before it (never reaching
 *             into the window), of the venue's close over v1's median at that
 *             minute, from at least 10 minutes the venue was fresh. Calibrated,
 *             the venues sit almost on top of each other, and one venue can
 *             only move a median as far as its nearest neighbour.
 *   who       the venues that count are settled before the window opens:
 *             fresh in the 15 minutes before it (m - 15 to m - 1) and
 *             calibrated through all of it. At least 3, 2 of them anchors, or
 *             the exchange prices the side. Nothing a venue does inside the
 *             window adds or removes one, so a print can no longer knock a
 *             side to Monday, and a venue that wakes up in the window does not
 *             join it.
 *   guard     each minute, a calibrated close more than 50 bps from the median
 *             of the counted closes is set aside; if that leaves fewer than 3
 *             (2 anchors), the median of all of them is taken, which one
 *             outlier among three or more cannot carry past the others.
 *   window    the price is the median of those per-minute medians over the W
 *             minutes that start at the boundary's own minute, stamped at the
 *             end of the last one. Every minute of it ends after the boundary,
 *             so no minute a taker could already see decides a start price,
 *             and one pushed minute is outvoted by the rest.
 *   breaker   as v1: more than 15% from the exchange's last close is a failed
 *             quorum, and the exchange prices the side.
 *
 * NO TWO-ANCHOR TIER. With two venues, either one can drag their mean by half
 * of whatever it prints, which is the lever v2 exists to remove. A side with
 * fewer than three counted venues waits for the exchange's first bar.
 *
 * W and the shortest round priced this way were measured with the attack
 * harness in scripts/attack-247.ts, on the same weekend fixtures; the program
 * only needs publishTime >= boundary, which the window's end always is. */

export const COMPOSITE_V2_RULE = "composite-v2";
/** The window: minutes from the boundary's own minute whose medians are
 *  medianed. Chosen by measurement (docs/247-hardening.md). */
export const V2_WINDOW_MINUTES = 3;
export const V2_WINDOW_SECS = V2_WINDOW_MINUTES * 60;
/** A minute k's premium is read over minutes k - 75 to k - 6, and never past
 *  the minute before the window. */
export const CALIBRATION_FROM_MINUTES = 75;
export const CALIBRATION_TO_MINUTES = 6;
export const CALIBRATION_MIN_SAMPLES = 10;
/** Premiums are integers of 1e-8: 100,000,000 is a venue trading level with
 *  the rest. */
export const PREMIUM_SCALE = 100_000_000n;
/** How far before m a v2 window's rows reach: 75 minutes of calibration and
 *  the 14 before its first sample that say whether a venue was fresh then. */
export const V2_LOOKBACK_SECS = 5_400;

/* HOW FAR PAST THE WINDOW EACH REQUEST REACHES.
 *
 * A venue that prints every minute and has no row for the window's last minute
 * is late, and the rule waits for it. That wait has to be able to end from
 * history: if the venue skipped the minute (maintenance, a halt), a later row
 * proves it, and the minute counts as no trade. A request that stopped at the
 * window's last minute could never return that later row, so a skipped minute
 * waited until the venues' history ran out. Each v2 request therefore reaches
 * V2_TAIL_MINUTES past it. The rule reads nothing from those rows but the fact
 * that one exists; OKX's 100-row cap still holds the span (90 + 3 + 5 = 98). */
export const V2_TAIL_MINUTES = 5;

/* THE SHORTEST ROUND THE COMPOSITE MAY PRICE.
 *
 * A round is only as hard to change as its move is large against what one
 * venue can do to its two prices. On last weekend's minutes, with v2, one
 * venue pushing 60 bps through a window could change the result of up to
 * 35.5% of 15-minute rounds, 16.4% of 1-hour rounds and 9.2% of 4-hour rounds
 * for some stock, and at most 2.6% of 12-hour rounds for every one of the
 * twelve (scripts/attack-247.ts; docs/247-hardening.md has the table). So a
 * fight with a boundary the composite prices must run at least 12 hours, the
 * shortest measured round at or under 5% for every stock. A bell round that
 * ends in session is exempt: its end is the exchange's, a push can only reach
 * its start, and it runs at least nine hours from any composite start. */
export const MIN_OFFHOURS_ROUND_SECS = 12 * 3_600;

/** When a v2 price for `boundary` is stamped: the end of its window. */
export const compositePublishTime = (boundary: number) => minuteOf(boundary) + V2_WINDOW_SECS;
/** The start of the last minute in the window for minute m. */
export const v2LastMinute = (m: number) => m + V2_WINDOW_SECS - 60;

/* A FALLBACK THE PROOF WOULD NOT OUTLIVE.
 *
 * A side whose markets were too thin waits for the exchange's first bar after
 * the boundary (step 8b). Nothing remembers that verdict but the instance that
 * worked it out, so when that bar is final a fresh instance has to work it out
 * again from the venues' history, and nothing is signed once the shortest
 * history in the set has run out (compositeGate). On a normal weekend the bar
 * comes 56 hours after Friday's close, inside Hyperliquid's three days. After
 * a holiday next to a weekend it can come 80 to 83 hours after the first hours
 * of the closure (Christmas, New Year, Good Friday, the Monday holidays), and
 * a fight whose side fell back there could never be priced: it would sit until
 * the stall refund. So a boundary whose fallback would land later than the
 * shortest retention, less FALLBACK_MARGIN_SECS for a crank that runs late, is
 * one the pages refuse to let a composite side start or end on
 * (stocks.ts, strandedWithin). Only a stock with Hyperliquid pinned is ever
 * affected; every other set keeps six days. */
export const FALLBACK_MARGIN_SECS = 3_600;

export function fallbackOutlivesHistory(boundary: number, exchangeFinal: number | null, venues: VenueId[]): boolean {
  if (exchangeFinal === null || !venues.length) return false;
  return exchangeFinal - boundary > historySecs(venues) - FALLBACK_MARGIN_SECS;
}

/** The shortest one-minute history among these venues, in seconds. */
export const historySecs = (venues: VenueId[]) => Math.min(...venues.map((v) => VENUES[v].retentionSecs));

/* A QUIET MINUTE AT A FORWARD-FILLING VENUE ARRIVES LATE, SO IT IS NOT READ.
 *
 * Hyperliquid prints no row for a minute nobody traded until the next trade,
 * then fills it in flat behind itself; Backpack's quiet rows repeat the close
 * the same way. So the rows after such a venue's last trade in a span are
 * there or not depending on whether anyone has traded since, which is a fact
 * about when the span was asked for, not about the span. Read as they came,
 * they changed nothing in any price but moved the proof's candle stamps, and
 * so its sha256 (1,108 of last weekend's boundaries, fetched at the moment the
 * rule asks, against the same boundaries fetched later). Cut back to the last
 * traded row, forward-filled from it, every fetch reads the same rows. A span
 * with no trade at all reads as no rows, for the same reason. */
export function settledRows(venue: VenueId, rows: Candle[], last: number): Candle[] {
  if (!VENUES[venue].forwardFill) return rows;
  let lastTrade = -Infinity;
  for (const r of rows) if (r.traded && r.t <= last && r.t > lastTrade) lastTrade = r.t;
  return rows.filter((r) => r.t <= lastTrade);
}

/** A positive ratio a / b rounded half up, in integers. */
const divRound = (a: bigint, b: bigint) => (2n * a + b) / (2n * b);

/** One venue's minutes from `from` to `last` as the rule reads them: for each
 *  minute, the latest candle at or before it and the latest traded one. */
export type VenueSeries = {
  venue: VenueId;
  anchor: boolean;
  from: number;
  candle: (number | null)[];
  close: (string | null)[];
  ticks: (bigint | null)[];
  lastTraded: (number | null)[];
};

export function venueSeries(venue: VenueId, rows: Candle[], from: number, last: number): VenueSeries {
  const n = (last - from) / 60 + 1;
  const sorted = rows.filter((r) => Number.isInteger(r.t) && r.t % 60 === 0 && r.t >= from && r.t <= last).sort((a, b) => a.t - b.t);
  const s: VenueSeries = { venue, anchor: VENUES[venue].anchor, from, candle: [], close: [], ticks: [], lastTraded: [] };
  let i = 0;
  let latest: Candle | null = null;
  let latestTicks: bigint | null = null;
  let traded: number | null = null;
  for (let k = 0; k < n; k++) {
    const t = from + k * 60;
    while (i < sorted.length && sorted[i].t <= t) {
      // In time order, so a repeated minute keeps its last row, as v1 does.
      latest = sorted[i];
      latestTicks = toTicks(latest.close);
      if (latest.traded) traded = latest.t;
      i++;
    }
    s.candle.push(latest?.t ?? null);
    s.close.push(latest?.close ?? null);
    s.ticks.push(latestTicks);
    s.lastTraded.push(traded);
  }
  return s;
}

/** Whether a venue had traded in the 15 minutes up to minute index k, with a
 *  readable close: v1's freshness. */
export const freshAt = (s: VenueSeries, k: number) => {
  const traded = s.lastTraded[k];
  return s.ticks[k] !== null && traded !== null && traded >= s.from + k * 60 - FRESH_SECS;
};

/** v1's median at minute index k over these series (steps 3 to 5, no breaker
 *  and no fallback): the reference a premium is measured against. Null when
 *  v1 has no quorum there. */
export function referenceAt(series: VenueSeries[], k: number): bigint | null {
  const fresh = series.filter((s) => freshAt(s, k));
  if (fresh.length < QUORUM || fresh.filter((s) => s.anchor).length < QUORUM_ANCHORS) return null;
  const m0 = medianTicks(fresh.map((s) => s.ticks[k]!));
  const survivors = fresh.filter((s) => within(s.ticks[k]!, m0, GUARD_BPS));
  if (survivors.length < QUORUM || survivors.filter((s) => s.anchor).length < QUORUM_ANCHORS) return null;
  return medianTicks(survivors.map((s) => s.ticks[k]!));
}

/** A venue's premium at minute index k: the median of its close over the
 *  reference, in PREMIUM_SCALE, over indices k - 75 to min(k - 6, cap) where
 *  it was fresh and the reference exists. Null under CALIBRATION_MIN_SAMPLES. */
export function premiumAt(s: VenueSeries, refs: (bigint | null)[], k: number, cap: number): { premium: bigint | null; samples: number } {
  const ratios: bigint[] = [];
  const hi = Math.min(k - CALIBRATION_TO_MINUTES, cap);
  for (let j = Math.max(0, k - CALIBRATION_FROM_MINUTES); j <= hi; j++) {
    const r = refs[j];
    if (r !== null && r !== undefined && freshAt(s, j)) ratios.push(divRound(s.ticks[j]! * PREMIUM_SCALE, r));
  }
  return { premium: ratios.length >= CALIBRATION_MIN_SAMPLES ? medianTicks(ratios) : null, samples: ratios.length };
}

/** A close divided by its venue's premium, in ticks. */
export const calibrate = (ticks: bigint, premium: bigint) => divRound(ticks * PREMIUM_SCALE, premium);

/** One minute of the window: the guard, then the median of what it kept, or
 *  of everything when it kept fewer than 3 with 2 anchors. `kept` is by
 *  position in `inputs`. */
export function minuteMedian(inputs: { anchor: boolean; value: bigint }[]): { m0: bigint; value: bigint; kept: boolean[]; guard: "held" | "all" } {
  const m0 = medianTicks(inputs.map((x) => x.value));
  const inside = inputs.map((x) => within(x.value, m0, GUARD_BPS));
  const survivors = inputs.filter((_, i) => inside[i]);
  if (survivors.length >= QUORUM && survivors.filter((x) => x.anchor).length >= QUORUM_ANCHORS) {
    return { m0, value: medianTicks(survivors.map((x) => x.value)), kept: inside, guard: "held" };
  }
  return { m0, value: medianTicks(inputs.map((x) => x.value)), kept: inputs.map(() => true), guard: "all" };
}

export type V2MinuteRow = {
  t: number;
  /** Start of the latest candle at or before t, its close and its ticks. */
  candle: number | null;
  close: string | null;
  ticks: string | null;
  /** The venue's premium at t, in 1e-8, and how many minutes it was read from. */
  premium: string | null;
  samples: number;
  /** The close divided by the premium, in ticks. */
  calibrated: string | null;
  kept: boolean;
};

export type V2ProofRow = {
  venue: VenueId;
  name: string;
  instrument: string;
  anchor: boolean;
  request: VenueRequest;
  /** The latest traded candle at or before the minute before the window. */
  lastTraded: number | null;
  /** Traded in the 15 minutes before the window. */
  fresh: boolean;
  /** Counted: fresh before the window and calibrated through all of it. */
  counted: boolean;
  why: "counted" | "no-candle" | "bad-close" | "stale" | "uncalibrated";
  minutes: V2MinuteRow[];
};

export type V2ProofMinute = {
  t: number;
  /** Median of the counted calibrated closes, the guard's centre. */
  m0: string | null;
  /** This minute's median. */
  value: string | null;
  kept: number;
  keptAnchors: number;
  /** held: the guard kept a quorum; all: it did not, so every close counted. */
  guard: "held" | "all" | null;
};

export type CompositeV2Proof = {
  rule: typeof COMPOSITE_V2_RULE;
  boundary: number;
  minute: number;
  publishTime: number;
  /** The first and last minute of the window. */
  window: { from: number; to: number; minutes: number };
  calibration: { fromMinutes: number; toMinutes: number; minSamples: number; scale: string };
  venues: V2ProofRow[];
  counted: number;
  countedAnchors: number;
  minutes: V2ProofMinute[];
  /** The median of the minutes' medians, in ticks. */
  median: string | null;
  reference: { t: number; close: string; ticks: string } | null;
  tier: null | "exchange";
  reason: string | null;
  price: string | null;
};

export type CompositeV2Result = CompositeResult<CompositeV2Proof>;

/* THE RULE, V2.
 *
 * `windows` holds one entry per pinned venue, each reaching from
 * m - V2_LOOKBACK_SECS to V2_TAIL_MINUTES past the window's last minute
 * (venues247.ts, venueRequestV2); rows after the window's last minute only
 * prove a skipped minute, and anything outside the span is ignored. A
 * forward-filling venue is read up to its last trade (settledRows). The rest
 * is as v1. */
export function compositeV2At(opts: {
  boundary: number;
  now: number;
  settleSecs: number;
  windows: VenueWindow[];
  reference: Reference;
  exchangeFinal: number | null;
}): CompositeV2Result {
  const { boundary } = opts;
  const m = minuteOf(boundary);
  const from = m - V2_LOOKBACK_SECS;
  const last = v2LastMinute(m);
  const gate = compositeGate({ ...opts, venues: opts.windows.map((w) => w.venue), windowSecs: V2_WINDOW_SECS });
  if (gate) return gate;

  const failed = opts.windows.flatMap((w) => ("error" in w ? [`${VENUES[w.venue].name} ${w.instrument}: ${w.error}`] : []));
  if (failed.length) return { wait: `waiting on ${failed.join("; ")}`, retryAt: null };

  const windows = [...(opts.windows as (VenueWindow & { rows: Candle[] })[])].sort(
    (a, b) => VENUE_ORDER.indexOf(a.venue) - VENUE_ORDER.indexOf(b.venue) || (a.instrument < b.instrument ? -1 : a.instrument > b.instrument ? 1 : 0),
  );
  /* A venue that prints every minute and has nothing at or after the window's
   * last minute is late, not quiet, exactly as v1 says of its one minute. */
  const late = windows.filter((w) => !VENUES[w.venue].forwardFill && !w.rows.some((r) => r.t >= last));
  if (late.length) {
    return { wait: `no candle for ${last} yet at ${late.map((w) => `${VENUES[w.venue].name} ${w.instrument}`).join(", ")}`, retryAt: null };
  }

  const series = windows.map((w) => venueSeries(w.venue, settledRows(w.venue, w.rows, last), from, last));
  const before = (m - 60 - from) / 60; // the minute before the window
  const first = (m - from) / 60;
  const refs: (bigint | null)[] = series[0]?.ticks.map(() => null) ?? [];
  for (let j = Math.max(0, first - CALIBRATION_FROM_MINUTES); j <= before; j++) refs[j] = referenceAt(series, j);

  const ks = Array.from({ length: V2_WINDOW_MINUTES }, (_, i) => first + i);
  const read = series.map((s, v) => {
    const cal = ks.map((k) => premiumAt(s, refs, k, before));
    const fresh = freshAt(s, before);
    const why: V2ProofRow["why"] =
      s.candle[before] === null ? "no-candle" : s.ticks[before] === null ? "bad-close" : !fresh ? "stale" : cal.some((c) => c.premium === null) ? "uncalibrated" : "counted";
    return { s, w: windows[v], cal, fresh, counted: why === "counted", why };
  });
  const counted = read.filter((r) => r.counted);
  const countedAnchors = counted.filter((r) => r.s.anchor).length;

  const keptAt: boolean[][] = read.map(() => ks.map(() => false));
  const minutes: V2ProofMinute[] = [];
  let median: bigint | null = null;
  let reason: string | null = null;

  if (counted.length >= QUORUM && countedAnchors >= QUORUM_ANCHORS) {
    const values: bigint[] = [];
    for (const [i, k] of ks.entries()) {
      const inputs = counted.flatMap((r) => {
        const ticks = r.s.ticks[k];
        return ticks === null ? [] : [{ r, anchor: r.s.anchor, value: calibrate(ticks, r.cal[i].premium!) }];
      });
      if (!inputs.length) {
        reason = `no counted market had a readable close at ${from + k * 60}`;
        break;
      }
      const step = minuteMedian(inputs);
      inputs.forEach((x, n) => (keptAt[read.indexOf(x.r)][i] = step.kept[n]));
      const kept = inputs.filter((_, n) => step.kept[n]);
      minutes.push({ t: from + k * 60, m0: step.m0.toString(), value: step.value.toString(), kept: kept.length, keptAnchors: kept.filter((x) => x.anchor).length, guard: step.guard });
      values.push(step.value);
    }
    if (reason === null) median = medianTicks(values);
  } else {
    reason = `${counted.length} markets (${countedAnchors} anchors) had traded in the 15 minutes before ${m} and were calibrated; the rule needs 3 with 2 anchors`;
  }

  const ref = opts.reference;
  const refTicks = ref && !("error" in ref) ? toTicks(ref.close) : null;
  let checked = false;
  const proofOf = (tier: null | "exchange", price: bigint | null, why: string | null): CompositeV2Proof => ({
    rule: COMPOSITE_V2_RULE,
    boundary,
    minute: m,
    publishTime: m + V2_WINDOW_SECS,
    window: { from: m, to: last, minutes: V2_WINDOW_MINUTES },
    calibration: {
      fromMinutes: CALIBRATION_FROM_MINUTES,
      toMinutes: CALIBRATION_TO_MINUTES,
      minSamples: CALIBRATION_MIN_SAMPLES,
      scale: PREMIUM_SCALE.toString(),
    },
    venues: read.map((r, v) => ({
      venue: r.s.venue,
      name: VENUES[r.s.venue].name,
      instrument: r.w.instrument,
      anchor: r.s.anchor,
      request: r.w.request,
      lastTraded: r.s.lastTraded[before] ?? null,
      fresh: r.fresh,
      counted: r.counted,
      why: r.why,
      minutes: ks.map((k, i) => {
        const ticks = r.s.ticks[k];
        const premium = r.cal[i].premium;
        return {
          t: from + k * 60,
          candle: r.s.candle[k],
          close: r.s.close[k],
          ticks: ticks === null ? null : ticks.toString(),
          premium: premium === null ? null : premium.toString(),
          samples: r.cal[i].samples,
          calibrated: ticks === null || premium === null ? null : calibrate(ticks, premium).toString(),
          kept: keptAt[v][i],
        };
      }),
    })),
    counted: counted.length,
    countedAnchors,
    minutes,
    median: median === null ? null : median.toString(),
    reference: checked && ref && !("error" in ref) && refTicks !== null ? { t: ref.t, close: ref.close, ticks: refTicks.toString() } : null,
    tier,
    reason: why,
    price: price === null ? null : price.toString(),
  });

  if (median !== null) {
    // The breaker needs the exchange's last close; not being able to read it is a wait.
    if (ref === null) return { wait: "no exchange close before the boundary to check the price against", retryAt: null };
    if ("error" in ref) return { wait: `the exchange's last close could not be read: ${ref.error}`, retryAt: null };
    if (refTicks === null) return { wait: `the exchange's last close ${ref.close} is not a price`, retryAt: null };
    checked = true;
    if (within(median, refTicks, BREAKER_BPS)) {
      const proof = proofOf(null, median, null);
      return { price: median, publishTime: m + V2_WINDOW_SECS, tier: null, proof, sha256: proofHash(proof) };
    }
    reason = `${(abs(median - refTicks) * 10_000n) / refTicks} bps from the exchange's last close, beyond the 1,500 bps breaker`;
  }

  if (opts.exchangeFinal === null) return { refused: `${reason}; and no exchange session opens within ten days` };
  const proof = proofOf("exchange", null, reason);
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

export const proofHash = (proof: CompositeProof | CompositeV2Proof) => sha256Hex(canonicalJson(proof));

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
