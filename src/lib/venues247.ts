/* The nine venues the composite reads, and which of their markets each stock is
 * pinned to.
 *
 * composite.ts is the rule; this is where its rows come from. Three parts:
 *
 *   the pins      src/data/venues247.json, read and checked by parseVenues247.
 *                 Its "rule" field names the format the builder wrote,
 *                 "composite-v1", which v2 reads unchanged: the pins are the
 *                 same markets whichever rule prices them.
 *   the requests  one fixed request per venue per minute, the same bytes for
 *                 every caller, so a proof's URL can be fetched again by anyone;
 *                 an hour for v1 (venueRequest), and for v2 the 90 minutes
 *                 before the boundary's minute and the window (venueRequestV2)
 *   the fetcher   five seconds per request, finished windows kept, Bitget one
 *                 at a time, and every failure turned into a wait
 *
 * THE FILE, src/data/venues247.json:
 *
 *   {
 *     "rule": "composite-v1",
 *     "tickers": {
 *       "TSLA": [
 *         { "venue": "hyperliquid", "instrument": "xyz:TSLA", "from": 1789600000 },
 *         { "venue": "okx", "instrument": "TSLA-USDT-SWAP", "from": 1789600000 },
 *         { "venue": "lighter", "instrument": "112", "from": 1789600000, "until": 1790200000 }
 *       ]
 *     }
 *   }
 *
 *   tickers     roster tickers (src/data/roster.json), each with the markets
 *               that price it; a ticker with no entries is not listed
 *   venue       one of the nine in composite.ts VENUES
 *   instrument  the venue's own id for the market, checked against the shape
 *               that venue uses (INSTRUMENT below): it goes into a URL
 *   from/until  boundary times, unix seconds, from inclusive and until
 *               exclusive (until optional). A market joins or leaves a stock's
 *               set only from a stated boundary, so the set, and with it the
 *               price, is a function of (stock, boundary) and never of when
 *               the file was deployed. Delisting a market means an `until`,
 *               not deleting its line.
 *
 * One venue appears at most once in a stock's set at any boundary, so a venue
 * is never counted twice towards a quorum. scripts/build-247.ts writes the
 * file (docs/247-pricing.md, step 3).
 *
 * No "server-only" import: scripts/settler.ts runs the oracle from Node. */

import venuesJson from "@/data/venues247.json";

import {
  COMPOSITE_RULE,
  COMPOSITE_V2_RULE,
  closeText,
  V2_LOOKBACK_SECS,
  v2LastMinute,
  VENUES,
  WINDOW_SECS,
  type Candle,
  type VenueId,
  type VenueRequest,
  type VenueWindow,
} from "./composite";

export type PinnedInput = { venue: VenueId; instrument: string; from: number; until?: number };
export type Venues247 = { rule: typeof COMPOSITE_RULE; tickers: Record<string, PinnedInput[]> };

/* Each venue's market ids, as the venue writes them. An instrument is pasted
 * into a URL, so anything else is refused when the file is read, not escaped
 * when it is used. */
const INSTRUMENT: Record<VenueId, RegExp> = {
  hyperliquid: /^[a-z]{1,8}:[A-Z0-9]{1,16}$/, // xyz:TSLA, xyz:PURRDAT
  okx: /^[A-Z0-9]{1,16}-USDT-SWAP$/, // TSLA-USDT-SWAP
  bitget: /^[A-Z0-9]{1,20}USDT$/, // TSLAUSDT
  binance: /^[A-Z0-9]{1,20}USDT$/, // TSLABUSDT
  lighter: /^\d{1,6}$/, // 112, the market_id
  backpack: /^[A-Z0-9]{1,16}\.US_USDC_PERP$/, // TSLA.US_USDC_PERP
  gate: /^[A-Z0-9]{1,16}_USDT$/, // TSLA_USDT
  mexc: /^[A-Z0-9]{1,24}_USDT$/, // TESLA_USDT
  bingx: /^NCSK[A-Z0-9]{1,24}-USDT$/, // NCSKTSLA2USD-USDT
};

/* NEVER PINNED, WHATEVER THE PRICE SAYS.
 *
 * A market can trade near a stock's price and still be something else, so
 * these ids are refused when the file is read, not only when it is built
 * (scripts/build-247.ts refuses the same symbols by name):
 *
 *   CL, BZ       crude oil wherever a futures venue lists them; the roster's
 *                CL is Colgate-Palmolive and BZ is Kanzhun
 *   SHEIN, SKHX  a Hong Kong listing and a Korean share priced through FX
 *   collisions   crypto markets whose symbol is a roster ticker. At Lighter the
 *                ids are its market_id, read from orderBookDetails on 14 Sep
 *                2026 (16 SUI, 50 ARB, 95 MET, 104 STRK, 120 LIT, 127 DASH, 230
 *                SHEIN). At Binance a bStock is TICKER + B, so ARB and DGB
 *                would read as AR and DG. */
export const DENIED_247: Record<VenueId, readonly string[]> = {
  hyperliquid: ["xyz:CL", "xyz:SHEIN", "xyz:SKHX"],
  okx: ["SHEIN-USDT-SWAP"],
  bitget: ["CLUSDT", "BZUSDT", "SHEINUSDT"],
  binance: ["ARBUSDT", "DGBUSDT"],
  lighter: ["16", "50", "95", "104", "120", "127", "230"],
  backpack: [],
  gate: ["SHEIN_USDT"],
  mexc: ["SHEINSTOCK_USDT"],
  bingx: [],
};

/** Read and check a venues247 file. Throws, naming the first problem. */
export function parseVenues247(raw: unknown): Venues247 {
  const file = raw as { rule?: unknown; tickers?: unknown };
  if (!file || typeof file !== "object") throw new Error("venues247: not an object");
  if (file.rule !== COMPOSITE_RULE) throw new Error(`venues247: rule must be ${COMPOSITE_RULE}`);
  if (!file.tickers || typeof file.tickers !== "object" || Array.isArray(file.tickers)) throw new Error("venues247: tickers must be an object");
  const tickers: Record<string, PinnedInput[]> = {};
  for (const [ticker, list] of Object.entries(file.tickers as Record<string, unknown>)) {
    if (!/^[A-Z0-9.]{1,12}$/.test(ticker)) throw new Error(`venues247: bad ticker ${JSON.stringify(ticker)}`);
    if (!Array.isArray(list)) throw new Error(`venues247 ${ticker}: inputs must be a list`);
    const inputs = list.map((entry, i): PinnedInput => {
      const e = entry as Record<string, unknown>;
      const where = `venues247 ${ticker}[${i}]`;
      if (typeof e.venue !== "string" || !(e.venue in VENUES)) throw new Error(`${where}: unknown venue ${JSON.stringify(e.venue)}`);
      const venue = e.venue as VenueId;
      if (typeof e.instrument !== "string" || !INSTRUMENT[venue].test(e.instrument)) {
        throw new Error(`${where}: ${JSON.stringify(e.instrument)} is not a ${VENUES[venue].name} instrument`);
      }
      if (DENIED_247[venue].includes(e.instrument)) throw new Error(`${where}: ${VENUES[venue].name} ${e.instrument} is denied`);
      if (!Number.isSafeInteger(e.from) || (e.from as number) < 0) throw new Error(`${where}: from must be a boundary in unix seconds`);
      if (e.until !== undefined && (!Number.isSafeInteger(e.until) || (e.until as number) <= (e.from as number))) {
        throw new Error(`${where}: until must be a boundary after from`);
      }
      const extra = Object.keys(e).filter((k) => !["venue", "instrument", "from", "until"].includes(k));
      if (extra.length) throw new Error(`${where}: unknown field ${extra[0]}`);
      return { venue, instrument: e.instrument, from: e.from as number, ...(e.until !== undefined ? { until: e.until as number } : {}) };
    });
    // One venue at a time per stock: overlapping spans of the same venue would count it twice.
    for (let i = 0; i < inputs.length; i++) {
      for (let j = i + 1; j < inputs.length; j++) {
        const [a, b] = [inputs[i], inputs[j]];
        if (a.venue === b.venue && a.from < (b.until ?? Infinity) && b.from < (a.until ?? Infinity)) {
          throw new Error(`venues247 ${ticker}: ${VENUES[a.venue].name} is pinned twice over the same boundaries`);
        }
      }
    }
    if (inputs.length) tickers[ticker] = inputs;
  }
  return { rule: COMPOSITE_RULE, tickers };
}

/** The deployed pins. */
export const VENUES247: Venues247 = parseVenues247(venuesJson);

/** Whether a ticker has any market pinned at all. */
export const listed247 = (ticker: string, file: Venues247 = VENUES247) => (file.tickers[ticker]?.length ?? 0) > 0;

/** The markets pinned for `ticker` at `boundary`. */
export function inputsAt(ticker: string, boundary: number, file: Venues247 = VENUES247): PinnedInput[] {
  return (file.tickers[ticker] ?? []).filter((i) => i.from <= boundary && boundary < (i.until ?? Infinity));
}

/* THE REQUEST FOR MINUTE m, PER VENUE.
 *
 * Every window ends at m and reaches back WINDOW_SECS, and each was checked
 * against the live API from this machine on Mon 14 Sep 2026, 22:20 to 22:24
 * UTC, with TSLA and m = 22:10 or 22:12 UTC. What each one returned:
 *
 *   hyperliquid  POST candleSnapshot, startTime and endTime in ms, both
 *                inclusive: start m-3600, end m+59.999 gave 61 rows, the last
 *                at m. Rows {t ms, c text, n trades}. A quiet minute has no
 *                row until the next trade prints it flat behind itself.
 *   okx          history-candles returns rows OLDER than `after` (exclusive),
 *                newest first: after=(m+60)000 put m first. `before` is
 *                exclusive too (after=m, before=m-180 gave m-60 and m-120).
 *                limit=100 reaches m-99 minutes; the rule reads m-60 to m.
 *                Rows [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm],
 *                every minute printed, zero volume included.
 *   bitget       endTime is EXCLUSIVE: startTime m-3600, endTime m gave 60
 *                rows ending m-60, so the request ends at m+60 (61 rows, last
 *                m). Rows [ts, o, h, l, c, baseVol, quoteVol], gap-free.
 *   binance      endTime is inclusive: m-3600 to m gave 61 rows, last m. Rows
 *                [openTime, o, h, l, c, v, closeTime, qv, trades, ...].
 *   lighter      end_timestamp is exclusive (end m gave last m-60; m+60 gave
 *                last m). Seconds and milliseconds both work and returned the
 *                same rows, for now and for two days back, so the unit
 *                question is settled: either, and this sends milliseconds, the
 *                unit its rows carry. count_back is required (400 without it)
 *                and never trims the window: count_back=10 on an hour still
 *                gave 61 rows, and the verification saw count_back=720 widen
 *                an hour to 720. So it is 61, the window's own length, and
 *                composite.ts reads only rows inside the window anyway. Rows
 *                {t ms, c number, v base volume}, every minute printed.
 *   backpack     startTime and endTime in seconds, endTime exclusive: m-3600
 *                to m+60 gave 61 rows, m-3600 to m. Rows {start "YYYY-MM-DD
 *                HH:MM:SS" UTC, close, trades}. The verification saw a short
 *                window drop quiet minutes before its first trade; an hour at
 *                a quiet time here still started with a zero-trade minute.
 *                Either way the rule forward-fills Backpack, and a quiet
 *                leading stretch cannot be the latest candle while anything in
 *                the window traded.
 *   gate         from and to in seconds, both inclusive: 61 rows, last m.
 *                Rows {t s, c text, v contracts}.
 *   mexc         start and end in seconds, both inclusive: 61 rows, last m.
 *                Body {data: {time[], close[], vol[]}} with numbers.
 *   bingx        endTime is EXCLUSIVE, like Bitget: m-3600 to m gave 60 rows
 *                ending m-60, m+60 gave 61 ending m. Newest first. Rows
 *                {time ms, close text, volume text}. */
export function venueRequest(input: Pick<PinnedInput, "venue" | "instrument">, m: number): VenueRequest {
  return spanRequest(input, m - WINDOW_SECS, m);
}

/* THE REQUEST FOR A V2 WINDOW.
 *
 * The same requests over a longer span: from m - V2_LOOKBACK_SECS, for the
 * calibration minutes, to the window's last minute, for the window. Every
 * window semantics above holds, because the span is all that changes. Two
 * venues cap how long a span one request can carry, which caps the window:
 * OKX's history-candles returns at most 100 rows, and the span is 90 + W
 * minutes, so W can be at most 10; Lighter's count_back is set to the span's
 * own row count, as v1 sets it to 61. */
export function venueRequestV2(input: Pick<PinnedInput, "venue" | "instrument">, m: number): VenueRequest {
  return spanRequest(input, m - V2_LOOKBACK_SECS, v2LastMinute(m));
}

function spanRequest(input: Pick<PinnedInput, "venue" | "instrument">, start: number, m: number): VenueRequest {
  const i = input.instrument;
  const rows = (m - start) / 60 + 1;
  if (rows > 100) throw new Error(`a span of ${rows} minutes is more than OKX returns in one request`);
  switch (input.venue) {
    case "hyperliquid":
      return {
        method: "POST",
        url: "https://api.hyperliquid.xyz/info",
        body: JSON.stringify({ type: "candleSnapshot", req: { coin: i, interval: "1m", startTime: start * 1_000, endTime: (m + 59) * 1_000 } }),
      };
    case "okx":
      return { method: "GET", url: `https://www.okx.com/api/v5/market/history-candles?instId=${i}&bar=1m&after=${(m + 60) * 1_000}&limit=100` };
    case "bitget":
      return {
        method: "GET",
        url: `https://api.bitget.com/api/v2/mix/market/history-candles?symbol=${i}&productType=USDT-FUTURES&granularity=1m&startTime=${start * 1_000}&endTime=${(m + 60) * 1_000}&limit=200`,
      };
    case "binance":
      return {
        method: "GET",
        url: `https://data-api.binance.vision/api/v3/klines?symbol=${i}&interval=1m&startTime=${start * 1_000}&endTime=${m * 1_000}&limit=1000`,
      };
    case "lighter":
      return {
        method: "GET",
        url: `https://mainnet.zklighter.elliot.ai/api/v1/candles?market_id=${i}&resolution=1m&start_timestamp=${start * 1_000}&end_timestamp=${(m + 60) * 1_000}&count_back=${rows}`,
      };
    case "backpack":
      return { method: "GET", url: `https://api.backpack.exchange/api/v1/klines?symbol=${i}&interval=1m&startTime=${start}&endTime=${m + 60}` };
    case "gate":
      return { method: "GET", url: `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${i}&interval=1m&from=${start}&to=${m}` };
    case "mexc":
      return { method: "GET", url: `https://contract.mexc.com/api/v1/contract/kline/${i}?interval=Min1&start=${start}&end=${m}` };
    case "bingx":
      return {
        method: "GET",
        url: `https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${i}&interval=1m&startTime=${start * 1_000}&endTime=${(m + 60) * 1_000}&limit=1440`,
      };
  }
}

class BadBody extends Error {}

const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN);
const seconds = (ms: unknown) => {
  const t = num(ms) / 1_000;
  if (!Number.isInteger(t)) throw new BadBody(`timestamp ${String(ms)}`);
  return t;
};
const candle = (t: number, close: unknown, amount: unknown): Candle => {
  const text = closeText(close);
  const a = num(amount);
  if (text === null || !Number.isInteger(t) || !Number.isFinite(a)) throw new BadBody(`row at ${t}`);
  return { t, close: text, traded: a > 0 };
};
const list = (x: unknown, what: string): unknown[] => {
  if (!Array.isArray(x)) throw new BadBody(`${what} is not a list`);
  return x;
};

/** A venue's response body as candles, in whatever order it sent them.
 *  Throws on a body that is not the shape the venue answers with. */
export function parseVenueBody(venue: VenueId, body: unknown): Candle[] {
  const b = body as Record<string, unknown> | unknown[] | null;
  switch (venue) {
    case "hyperliquid":
      return list(b, "body").map((r) => {
        const row = r as { t: unknown; c: unknown; n: unknown };
        return candle(seconds(row.t), row.c, row.n);
      });
    case "okx": {
      const o = b as { code?: unknown; data?: unknown };
      if (o?.code !== "0") throw new BadBody(`code ${String(o?.code)}`);
      // A candle still forming (confirm "0") is not history yet.
      return list(o.data, "data")
        .map((r) => list(r, "row"))
        .filter((r) => r[8] !== "0")
        .map((r) => candle(seconds(r[0]), r[4], r[5]));
    }
    case "bitget": {
      const o = b as { code?: unknown; data?: unknown };
      if (o?.code !== "00000") throw new BadBody(`code ${String(o?.code)}`);
      return list(o.data, "data").map((r) => {
        const row = list(r, "row");
        return candle(seconds(row[0]), row[4], row[5]);
      });
    }
    case "binance":
      return list(b, "body").map((r) => {
        const row = list(r, "row");
        return candle(seconds(row[0]), row[4], row[8]);
      });
    case "lighter": {
      const o = b as { c?: unknown };
      return list(o?.c, "c").map((r) => {
        const row = r as { t: unknown; c: unknown; v: unknown };
        return candle(seconds(row.t), row.c, row.v);
      });
    }
    case "backpack":
      return list(b, "body").map((r) => {
        const row = r as { start: unknown; close: unknown; trades: unknown };
        if (typeof row.start !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.start)) throw new BadBody(`start ${String(row.start)}`);
        return candle(Date.parse(`${row.start.replace(" ", "T")}Z`) / 1_000, row.close, row.trades);
      });
    case "gate":
      return list(b, "body").map((r) => {
        const row = r as { t: unknown; c: unknown; v: unknown };
        return candle(num(row.t), row.c, row.v);
      });
    case "mexc": {
      const d = (b as { success?: unknown; data?: { time?: unknown; close?: unknown; vol?: unknown } })?.data;
      const time = list(d?.time, "time");
      const close = list(d?.close, "close");
      const vol = list(d?.vol, "vol");
      if (close.length !== time.length || vol.length !== time.length) throw new BadBody("columns differ in length");
      return time.map((t, k) => candle(num(t), close[k], vol[k]));
    }
    case "bingx": {
      const o = b as { code?: unknown; data?: unknown };
      if (o?.code !== 0) throw new BadBody(`code ${String(o?.code)}`);
      return list(o.data, "data").map((r) => {
        const row = r as { time: unknown; close: unknown; volume: unknown };
        return candle(seconds(row.time), row.close, row.volume);
      });
    }
  }
}

/* A FINISHED WINDOW NEVER CHANGES, SO IT IS ASKED FOR ONCE.
 *
 * Kept only when its minute m closed more than a minute and the settle time
 * ago AND its rows reach m. The second half matters for Hyperliquid, which has
 * no row for a quiet minute until the next trade: a window without m may yet
 * gain it, and the venue's answer about m is only settled once it has. Until
 * then it is asked again, which is also what fetchPerpBars does. */
const finished = new Map<string, VenueWindow>();
const MAX_FINISHED = 2_000;

export function windowFinished(rows: Candle[], m: number, now: number, settleSecs: number): boolean {
  return now >= m + 60 + settleSecs && rows.some((r) => r.t >= m);
}

/* BITGET ONE AT A TIME.
 *
 * Its public market endpoints allow a handful of requests a second per IP, and
 * a crank pass pricing several stocks at one boundary asks for all of them at
 * once. So Bitget requests queue behind each other; every other venue is asked
 * in parallel. */
let bitgetQueue: Promise<unknown> = Promise.resolve();
function serialBitget<T>(work: () => Promise<T>): Promise<T> {
  const run = bitgetQueue.then(work, work);
  bitgetQueue = run.catch(() => undefined);
  return run;
}

/** Forget every kept window. For tests. */
export function forgetVenueWindows(): void {
  finished.clear();
}

/* ONE VENUE'S WINDOW FOR MINUTE m.
 *
 * Never throws. A timeout, an HTTP error of any kind (429, 451 and 403
 * included), or a body of the wrong shape comes back as { error }, which
 * composite.ts turns into a wait: excluding a venue that failed to answer
 * would make the price depend on when somebody asked. */
export async function fetchVenueWindow(
  input: Pick<PinnedInput, "venue" | "instrument">,
  m: number,
  opts: { now: number; timeoutMs: number; settleSecs: number; rule?: typeof COMPOSITE_RULE | typeof COMPOSITE_V2_RULE },
): Promise<VenueWindow> {
  const v2 = opts.rule === COMPOSITE_V2_RULE;
  const request = v2 ? venueRequestV2(input, m) : venueRequest(input, m);
  // The window is finished once its own last minute is.
  const lastMinute = v2 ? v2LastMinute(m) : m;
  const key = `${request.url} ${"body" in request ? request.body : ""}`;
  const had = finished.get(key);
  if (had) return had;

  const base = { venue: input.venue, instrument: input.instrument, request };
  const ask = async (): Promise<VenueWindow> => {
    try {
      const r = await fetch(request.url, {
        method: request.method,
        headers: { accept: "application/json", ...("body" in request ? { "content-type": "application/json" } : {}) },
        ...("body" in request ? { body: request.body } : {}),
        cache: "no-store",
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if (!r.ok) return { ...base, error: `HTTP ${r.status}` };
      const rows = parseVenueBody(input.venue, await r.json());
      return { ...base, rows };
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError") return { ...base, error: `no answer in ${opts.timeoutMs / 1_000}s` };
      if (e instanceof BadBody) return { ...base, error: `unexpected answer (${e.message})` };
      return { ...base, error: e instanceof SyntaxError ? "unexpected answer (not JSON)" : "could not be reached" };
    }
  };
  const window = input.venue === "bitget" ? await serialBitget(ask) : await ask();
  if ("rows" in window && windowFinished(window.rows, lastMinute, opts.now, opts.settleSecs)) {
    if (finished.size >= MAX_FINISHED) finished.clear();
    finished.set(key, window);
  }
  return window;
}
