/* THE ATTACK HARNESS: HOW MUCH OF A ROUND ONE VENUE CAN CHANGE.
 *
 * composite-v2 (src/lib/composite.ts) chooses two numbers by measurement, and
 * this is the measurement: the length of its window, W, and the shortest round
 * a fight priced by it may run, MIN_OFFHOURS_ROUND_SECS. Both come from last
 * weekend's real minutes at nine venues for twelve stocks, the fixtures in
 * tests-web/fixtures/weekend-2026-09-12, and nothing else.
 *
 *   honest     every window start s from Sat 12 Sep 00:00 UTC on, priced by
 *              the real rule's own pieces (venueSeries, referenceAt, premiumAt,
 *              calibrate, minuteMedian), and checked against compositeV2At
 *              itself on a sample of starts
 *   the push   one venue among the counted ones prints at its own calibrated
 *              close times 1 + g, for every g from -60 to +60 bps, in every
 *              minute of a window: a sustained push, the plan's attack. The
 *              time median is monotone in each minute, so the most a push can
 *              move a window is the median of the most it can move each minute
 *              on its own, and each minute is searched over all 121 values.
 *              The push is applied to the calibrated close, which is the raw
 *              close's push to within a tick of rounding.
 *   a round    start window at s, stamped s + W; end window at s + W + D, the
 *              program's end_ts; D of 15 minutes, 1, 4, 12 and 24 hours.
 *              Counted when both windows are priced by the median.
 *   changeable the push can change the round's result for the stock against a
 *              flat opponent: an up move made flat or down, or the reverse
 *              (sign of end minus start, a tie counting as a change). "End" is
 *              a push in the end window only; "both" lets the same venue push
 *              the start window one way and the end window the other.
 *
 * WHAT IT DOES NOT MODEL. Cost: no order books, so a changeable round is an
 * opportunity, not a profit. A push long enough to move a premium (over half
 * of 70 calibration minutes). Two venues colluding. A start push feeding the
 * end window's calibration, which only matters for rounds under 81 minutes and
 * moves a premium by at most W of its 70 samples. And a real pair: the
 * opponent here is flat, so a pair that moves together is closer than this and
 * a pair that does not is further apart.
 *
 * v1 is measured the same way for comparison: one print in the end minute (or
 * the start and end minutes), marked fresh, on the raw closes, with v1's
 * quorum, guard and fallbacks, where a push that breaks the quorum counts as a
 * change (the side would be priced on Monday).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/attack-247.ts \
 *     [--w 1,3,5] [--tickers TSLA,NVDA] [--out scripts/data/attack-247.json]
 *
 * No network. Deterministic: the same fixtures give the same file. */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  calibrate,
  closeText,
  compositeV2At,
  FRESH_SECS,
  freshAt,
  GUARD_BPS,
  medianTicks,
  minuteMedian,
  premiumAt,
  QUORUM,
  QUORUM_ANCHORS,
  referenceAt,
  TWO_ANCHOR_BPS,
  V2_LOOKBACK_SECS,
  V2_WINDOW_MINUTES,
  VENUES,
  venueSeries,
  type Candle,
  type VenueId,
  type VenueSeries,
  type VenueWindow,
} from "../src/lib/composite";
import { WEEKEND_FROM, WEEKEND_MON, WEEKEND_SAT, WEEKEND_TICKERS, WEEKEND_UNTIL, WEEKEND_VENUES, weekendMinutes, type WeekendVenue } from "../tests-web/fixtures/weekend";

const VENUE_OF: Record<WeekendVenue, VenueId> = {
  xyz: "hyperliquid",
  okx_perp: "okx",
  bitget_perp: "bitget",
  binance_bstock: "binance",
  lighter_perp: "lighter",
  backpack_perp: "backpack",
  gate_perp: "gate",
  mexc_perp: "mexc",
  bingx_perp: "bingx",
};

export const ROUNDS: { label: string; minutes: number }[] = [
  { label: "15m", minutes: 15 },
  { label: "60m", minutes: 60 },
  { label: "4h", minutes: 240 },
  { label: "12h", minutes: 720 },
  { label: "24h", minutes: 1_440 },
];
const PUSH_BPS = 60;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/* ─── The per-minute rule, in integers held as numbers ─────────────────────── */

/* minuteMedian on numbers. Ticks are integers far below 2^53 / 10,000, so the
 * guard's products and the medians are exact, and on honest closes this gives
 * minuteMedian's answer to the tick (checked below for every window). */
function medianN(sorted: number[]): number {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : Math.floor((sorted[n / 2 - 1] + sorted[n / 2] + 1) / 2);
}
const byNumber = (a: number, b: number) => a - b;
const insideN = (x: number, centre: number, bps: number) => Math.abs(x - centre) * 10_000 <= bps * centre;

function minuteValueN(values: number[], anchors: boolean[]): number {
  const all = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const m0 = medianN(all.map((x) => x[0]));
  const kept = all.filter((x) => insideN(x[0], m0, Number(GUARD_BPS)));
  if (kept.length >= QUORUM && kept.filter((x) => anchors[x[1]]).length >= QUORUM_ANCHORS) return medianN(kept.map((x) => x[0]));
  return medianN(all.map((x) => x[0]));
}

/* v1's answer at one minute on numbers: the median tier's price, the
 * two-anchor mean, or null for the exchange (a Monday price). */
function v1ValueN(fresh: { value: number; anchor: boolean }[]): number | null {
  const anchorsOf = (xs: { anchor: boolean }[]) => xs.filter((x) => x.anchor).length;
  if (fresh.length >= QUORUM && anchorsOf(fresh) >= QUORUM_ANCHORS) {
    const m0 = medianN(fresh.map((x) => x.value).sort(byNumber));
    const kept = fresh.filter((x) => insideN(x.value, m0, Number(GUARD_BPS)));
    if (kept.length >= QUORUM && anchorsOf(kept) >= QUORUM_ANCHORS) return medianN(kept.map((x) => x.value).sort(byNumber));
  }
  const a = fresh.filter((x) => x.anchor);
  if (a.length === 2 && Math.abs(a[0].value - a[1].value) * 20_000 <= Number(TWO_ANCHOR_BPS) * (a[0].value + a[1].value)) {
    return Math.floor((a[0].value + a[1].value + 1) / 2);
  }
  return null;
}

/* ─── One stock ───────────────────────────────────────────────────────────── */

/* Per counted venue: the most a push in every minute moves the window up and
 * down, and the most a push in one minute of it does. */
type Window = { price: number; up: number[]; down: number[]; upOne: number[]; downOne: number[]; venues: VenueId[] } | null;
/** Rounds counted, and how many one venue could change: pushing the end
 *  window, pushing both, and pushing one minute at each end. */
type Share = { rounds: number; end: number; start: number; both: number; one: number };

export type TickerResult = {
  ticker: string;
  starts: number;
  pricedStarts: number;
  /** Median over priced windows of the largest move one venue can make, in bps of the price. */
  pushBps: { median: number; p90: number; max: number };
  v2: Record<string, Share>;
  v1: Record<string, Share>;
  v1KnockOut: { minutes: number; knocked: number };
  checked: number;
};

function seriesFor(ticker: string): { series: VenueSeries[]; rows: { venue: VenueId; rows: Candle[] }[] } {
  const rows = WEEKEND_VENUES.flatMap((v) => {
    const got = weekendMinutes(v, ticker);
    return got ? [{ venue: VENUE_OF[v], rows: got.map((r): Candle => ({ t: r.t, close: closeText(r.c)!, traded: r.traded })) }] : [];
  });
  const last = WEEKEND_UNTIL - 60;
  return { series: rows.map((r) => venueSeries(r.venue, r.rows, WEEKEND_FROM, last)), rows };
}

export function measureTicker(ticker: string, w: number): TickerResult {
  const { series, rows } = seriesFor(ticker);
  const n = series[0].ticks.length;
  const refs = Array.from({ length: n }, (_, k) => referenceAt(series, k));
  const idx = (t: number) => (t - WEEKEND_FROM) / 60;

  // Premiums and calibrated closes, per venue and minute, for the cap a window starting at s puts on minute k.
  const calib = new Map<string, number | null>();
  const calibratedAt = (v: number, k: number, s: number): number | null => {
    const cap = Math.min(k - 6, s - 1);
    const key = `${v}:${k}:${cap}`;
    if (!calib.has(key)) {
      const { premium } = premiumAt(series[v], refs, k, cap);
      const ticks = series[v].ticks[k];
      calib.set(key, premium === null || ticks === null ? null : Number(calibrate(ticks, premium)));
    }
    return calib.get(key)!;
  };

  // Each window: the honest price and, per counted venue, the most a push moves it up and down.
  const perMinute = new Map<string, { max: number; min: number }>();
  const windows: Window[] = [];
  let checked = 0;
  const pushes: number[] = [];
  for (let s = 0; s + w - 1 < n; s++) {
    const counted: number[] = [];
    if (s >= 1) {
      for (let v = 0; v < series.length; v++) {
        if (!freshAt(series[v], s - 1)) continue;
        let ok = true;
        for (let k = s; k < s + w && ok; k++) ok = calibratedAt(v, k, s) !== null;
        if (ok) counted.push(v);
      }
    }
    const anchors = counted.map((v) => series[v].anchor);
    if (counted.length < QUORUM || anchors.filter(Boolean).length < QUORUM_ANCHORS) {
      windows.push(null);
      continue;
    }
    const honest: number[] = [];
    const ups = counted.map(() => [] as number[]);
    const downs = counted.map(() => [] as number[]);
    for (let k = s; k < s + w; k++) {
      const values = counted.map((v) => calibratedAt(v, k, s)!);
      const value = minuteValueN(values, anchors);
      // The real minuteMedian, on the same integers.
      const exact = minuteMedian(values.map((x, i) => ({ anchor: anchors[i], value: BigInt(x) })));
      if (Number(exact.value) !== value) throw new Error(`${ticker} minute ${k}: harness ${value}, rule ${exact.value}`);
      honest.push(value);
      const mask = `${k}:${Math.min(k - 6, s - 1)}:${counted.join(",")}`;
      counted.forEach((v, i) => {
        const key = `${mask}:${v}`;
        let hit = perMinute.get(key);
        if (!hit) {
          hit = { max: -Infinity, min: Infinity };
          for (let g = -PUSH_BPS; g <= PUSH_BPS; g++) {
            const pushed = [...values];
            pushed[i] = Math.round((values[i] * (10_000 + g)) / 10_000);
            const got = minuteValueN(pushed, anchors);
            if (got > hit.max) hit.max = got;
            if (got < hit.min) hit.min = got;
          }
          perMinute.set(key, hit);
        }
        ups[i].push(hit.max);
        downs[i].push(hit.min);
      });
    }
    const price = medianN([...honest].sort(byNumber));
    const up = ups.map((xs) => medianN([...xs].sort(byNumber)) - price);
    const down = downs.map((xs) => medianN([...xs].sort(byNumber)) - price);
    // One minute pushed: the best minute to push, the rest honest.
    const oneMinute = (xs: number[], pick: (a: number, b: number) => number) =>
      xs.reduce((best, x, p) => pick(best, medianN(honest.map((h, q) => (q === p ? x : h)).sort(byNumber)) - price), 0);
    const upOne = ups.map((xs) => oneMinute(xs, Math.max));
    const downOne = downs.map((xs) => oneMinute(xs, Math.min));
    windows.push({ price, up, down, upOne, downOne, venues: counted.map((v) => series[v].venue) });
    pushes.push((Math.max(...up, ...down.map((d) => -d)) * 10_000) / price);

    /* Every 97th priced window, the real rule end to end: compositeV2At on the
     * rows a fetch would have returned. Only when W is the rule's own. */
    if (w === V2_WINDOW_MINUTES && s % 97 === 0) {
      const m = WEEKEND_FROM + s * 60;
      const got = compositeV2At({
        boundary: m,
        now: m + w * 60 + 20,
        settleSecs: 20,
        windows: rows.map(
          (r): VenueWindow => ({
            venue: r.venue,
            instrument: ticker,
            request: { method: "GET", url: `fixture:${r.venue}` },
            rows: r.rows.filter((x) => x.t >= m - V2_LOOKBACK_SECS && x.t <= m + (w - 1) * 60),
          }),
        ),
        reference: { t: m - 60, close: String(price / 10_000) },
        exchangeFinal: m + 86_400,
      });
      if (!("price" in got) || Number(got.price) !== price) throw new Error(`${ticker} at ${m}: harness ${price}, compositeV2At ${JSON.stringify("price" in got ? got.price.toString() : got)}`);
      checked++;
    }
  }

  const inWeekend = (s: number) => s >= idx(WEEKEND_SAT) && s < idx(WEEKEND_MON);
  const v2: Record<string, Share> = {};
  /* Whether a venue pushing the end by (endUp, endDown) and the start by
   * (startUp, startDown) can change a round's sign. */
  const changes = (a: number, b: number, startUp: number, startDown: number, endUp: number, endDown: number) => {
    const move = Math.sign(b - a);
    if (move > 0) return b + endDown <= a + startUp;
    if (move < 0) return b + endUp >= a + startDown;
    return endUp !== 0 || endDown !== 0 || startUp !== 0 || startDown !== 0;
  };
  for (const r of ROUNDS) {
    const share: Share = { rounds: 0, end: 0, start: 0, both: 0, one: 0 };
    for (let s = 0; s < windows.length; s++) {
      const e = s + w + r.minutes;
      const a = windows[s];
      const b = windows[e];
      if (!inWeekend(s) || e >= windows.length || !a || !b) continue;
      share.rounds++;
      let end = false;
      let both = false;
      let one = false;
      let start = false;
      for (let j = 0; j < a.venues.length; j++) start ||= changes(a.price, b.price, a.up[j], a.down[j], 0, 0);
      for (let i = 0; i < b.venues.length; i++) {
        const j = a.venues.indexOf(b.venues[i]);
        end ||= changes(a.price, b.price, 0, 0, b.up[i], b.down[i]);
        both ||= changes(a.price, b.price, j >= 0 ? a.up[j] : 0, j >= 0 ? a.down[j] : 0, b.up[i], b.down[i]);
        one ||= changes(a.price, b.price, j >= 0 ? a.upOne[j] : 0, j >= 0 ? a.downOne[j] : 0, b.upOne[i], b.downOne[i]);
      }
      if (end) share.end++;
      if (both || end || start) share.both++;
      if (one) share.one++;
      if (start) share.start++;
    }
    v2[r.label] = share;
  }

  /* v1: one print, raw closes, at the end minute (and the start minute). */
  const v1At = (k: number) => {
    const fresh = series.flatMap((sr, v) => (freshAt(sr, k) ? [{ v, value: Number(sr.ticks[k]!), anchor: sr.anchor }] : []));
    const honest = v1ValueN(fresh);
    if (honest === null) return null;
    let max = -Infinity;
    let min = Infinity;
    let knocked = false;
    for (let v = 0; v < series.length; v++) {
      const own = series[v].ticks[k];
      if (own === null) continue;
      const others = fresh.filter((x) => x.v !== v);
      for (let g = -PUSH_BPS; g <= PUSH_BPS; g++) {
        const got = v1ValueN([...others, { v, value: Math.round((Number(own) * (10_000 + g)) / 10_000), anchor: series[v].anchor }]);
        if (got === null) {
          knocked = true;
          continue;
        }
        if (got > max) max = got;
        if (got < min) min = got;
      }
    }
    return { price: honest, max, min, knocked };
  };
  const v1Cache = new Map<number, ReturnType<typeof v1At>>();
  const v1Of = (k: number) => {
    if (!v1Cache.has(k)) v1Cache.set(k, v1At(k));
    return v1Cache.get(k)!;
  };
  const v1: Record<string, Share> = {};
  for (const r of ROUNDS) {
    const share: Share = { rounds: 0, end: 0, start: 0, both: 0, one: 0 };
    for (let s = idx(WEEKEND_SAT); s < idx(WEEKEND_MON); s++) {
      const e = s + 1 + r.minutes;
      if (e >= n) continue;
      const a = v1Of(s);
      const b = v1Of(e);
      if (!a || !b) continue;
      share.rounds++;
      const move = Math.sign(b.price - a.price);
      const end = b.knocked || (move > 0 ? b.min <= a.price : move < 0 ? b.max >= a.price : b.max !== b.min);
      const start = a.knocked || (move > 0 ? b.price <= a.max : move < 0 ? b.price >= a.min : a.max !== a.min);
      const both = end || start || (move > 0 ? b.min <= a.max : move < 0 ? b.max >= a.min : true);
      if (end) share.end++;
      if (start) share.start++;
      // v1 is priced by one minute, so one print is the whole push.
      if (both) share.both++;
      if (both) share.one++;
    }
    v1[r.label] = share;
  }
  let knockMinutes = 0;
  let knocked = 0;
  for (let k = idx(WEEKEND_SAT); k < idx(WEEKEND_MON); k++) {
    const x = v1Of(k);
    if (!x) continue;
    knockMinutes++;
    if (x.knocked) knocked++;
  }

  const sorted = [...pushes].sort(byNumber);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const starts = windows.filter((_, s) => inWeekend(s)).length;
  return {
    ticker,
    starts,
    pricedStarts: windows.filter((x, s) => inWeekend(s) && x).length,
    pushBps: { median: round2(q(0.5)), p90: round2(q(0.9)), max: round2(sorted.at(-1) ?? 0) },
    v2,
    v1,
    v1KnockOut: { minutes: knockMinutes, knocked },
    checked,
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");

export function measure(ws: number[], tickers: readonly string[]) {
  const out: Record<string, TickerResult[]> = {};
  for (const w of ws) {
    out[w] = tickers.map((t) => {
      const started = performance.now();
      const r = measureTicker(t, w);
      console.error(`W=${w} ${t}: ${Math.round(performance.now() - started)} ms, ${r.checked} windows checked against compositeV2At`);
      return r;
    });
  }
  return out;
}

function main() {
  const ws = (arg("w") ?? "1,3,5").split(",").map(Number);
  const tickers = (arg("tickers")?.split(",") ?? [...WEEKEND_TICKERS]) as string[];
  const results = measure(ws, tickers);
  const file = {
    rule: "composite-v2",
    freshSecs: FRESH_SECS,
    pushBps: PUSH_BPS,
    weekend: { from: WEEKEND_SAT, until: WEEKEND_MON },
    rounds: ROUNDS,
    venues: Object.keys(VENUES),
    results,
  };
  const path = arg("out");
  if (path) writeFileSync(resolve(path), `${JSON.stringify(file, null, 1)}\n`);

  const worstOf = (w: number, key: keyof Share, label: string) =>
    Math.max(...results[w].map((r) => r.v2[label][key] / Math.max(1, r.v2[label].rounds)));
  const shortest = (w: number) => ROUNDS.find((x) => worstOf(w, "both", x.label) <= 0.05)?.label ?? "none measured";

  console.log(`\n### The worst ticker's changeable share, by window (a push at both ends)\n`);
  console.log(`| W | ${ROUNDS.map((r) => r.label).join(" | ")} | Shortest round at 5% or less |`);
  console.log(`|---|${ROUNDS.map(() => "---").join("|")}|---|`);
  for (const w of ws) console.log(`| ${w} | ${ROUNDS.map((x) => `${(100 * worstOf(w, "both", x.label)).toFixed(1)}%`).join(" | ")} | ${shortest(w)} |`);

  for (const w of ws) {
    console.log(`\n### W = ${w}: rounds one venue can change (both ends / end only)\n`);
    console.log(`| Ticker | Priced starts | Push p50 / p90 bps | ${ROUNDS.map((r) => r.label).join(" | ")} |`);
    console.log(`|---|---|---|${ROUNDS.map(() => "---").join("|")}|`);
    for (const r of results[w]) {
      console.log(
        `| ${r.ticker} | ${r.pricedStarts} of ${r.starts} | ${r.pushBps.median} / ${r.pushBps.p90} | ${ROUNDS.map((x) => `${pct(r.v2[x.label].both, r.v2[x.label].rounds)} / ${pct(r.v2[x.label].end, r.v2[x.label].rounds)}`).join(" | ")} |`,
      );
    }
    for (const [key, words] of [
      ["both", "worst, both ends"],
      ["end", "worst, end only"],
      ["start", "worst, start only"],
      ["one", "worst, one minute each end"],
    ] as const) {
      console.log(`| ${words} | | | ${ROUNDS.map((x) => `${(100 * worstOf(w, key, x.label)).toFixed(1)}%`).join(" | ")} |`);
    }
  }
  const w0 = ws[0];
  console.log(`\n### composite-v1, one print (both ends / end only)\n`);
  console.log(`| Ticker | Knocked to the exchange | ${ROUNDS.map((r) => r.label).join(" | ")} |`);
  console.log(`|---|---|${ROUNDS.map(() => "---").join("|")}|`);
  for (const r of results[w0]) {
    console.log(
      `| ${r.ticker} | ${pct(r.v1KnockOut.knocked, r.v1KnockOut.minutes)} | ${ROUNDS.map((x) => `${pct(r.v1[x.label].both, r.v1[x.label].rounds)} / ${pct(r.v1[x.label].end, r.v1[x.label].rounds)}`).join(" | ")} |`,
    );
  }
}

if (require.main === module) main();
