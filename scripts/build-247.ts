/* Which markets price each stock while its exchange is shut, and which stocks
 * fight around the clock.
 *
 *   npx tsx scripts/build-247.ts --cache ~/stonkwars-research/weekend-2026-09-12 [--sweep] [--offline]
 *
 * Writes src/data/venues247.json, the pins composite-v1 reads
 * (src/lib/venues247.ts), plus the measurements behind every pin in
 * scripts/data/venues247.evidence.json and the build log in
 * docs/247-roster.md. It replaces running build-perps.ts and build-pools.ts
 * for boundaries from COMPOSITE_FROM on; their files stay for the boundaries
 * before it. docs/247-pricing.md, step 3, is the specification.
 *
 * FOUR QUESTIONS PER MARKET, IN ORDER.
 *
 *   listed    the venue's own market list, fetched live, names a stock market
 *             whose symbol is a US roster ticker: HL's perpAnnotation says
 *             "(Nasdaq: TSLA)", OKX files it under instCategory 3, Bitget
 *             under isRwa, Gate under contract_type stocks, MEXC under its
 *             Stock zone, BingX under the NCSK prefix, Backpack under
 *             rwaMarketType. Binance and Lighter have no such flag, so for
 *             them the price below is the whole check.
 *   not denied  a few symbols are something else wherever they trade (CL is
 *             crude oil, not Colgate), and a few are crypto coins that share a
 *             roster ticker. Refused by name here, and by instrument id when
 *             the file is read (DENIED_247).
 *   the stock  its one-minute closes in a regular-session hour sit within 1.5%
 *             of Yahoo's closes for the same minutes (median of the gaps).
 *             The window is fetched with the oracle's own request
 *             (venues247.ts fetchVenueWindow), so an instrument that passes is
 *             exactly the id the oracle will ask for. Gate's PG perp trades
 *             at 0.95 of Procter & Gamble and its TFC at 0.77 of Truist; a
 *             ticker is not an identity.
 *   alive     over last weekend's 2,880 minutes (Sat 12 Sep 00:00 to Mon 14
 *             Sep 00:00 UTC), the share of minutes with a trade at that venue
 *             in the 15 minutes before: the composite's own freshness test,
 *             run on every minute. Read from one-minute data only, from the
 *             research cache, or fetched once into it with --sweep.
 *
 * THEN PER STOCK.
 *
 *   pin       a market that passed all four and was fresh in at least 50% of
 *             the minutes is an input. One market per venue per stock.
 *   badge     at least 2 anchors and at least 3 markets in all fresh in at
 *             least 90% of the minutes. Only a stock with the badge is
 *             written to venues247.json: listed means priced 24/7, so every
 *             stock the composite prices has a quorum on an ordinary
 *             weekend minute, and the rest keep the exchange's hours.
 *
 * WHAT IT READS AND WHEN.
 *
 *   --cache DIR   the research sweep of 14 Sep (stonkwars-research, outside the
 *                 repo). Yahoo's Friday closes, Hyperliquid's weekend minutes
 *                 (it serves only about 3.5 days, so they exist nowhere else
 *                 now), Lighter's and Backpack's, the twelve archived stocks at
 *                 every CEX, hourly weekend liveness, and the lead's counts.
 *                 What this script fetches is kept under DIR/build247, so a
 *                 second run asks the venues nothing but their market lists.
 *   --sweep       fetch weekend minutes for markets the cache lacks, into
 *                 DIR/build247/weekend, while the venues still serve them
 *                 (Gate keeps about 6.9 days). Only for markets that could
 *                 still matter: a market whose hourly liveness caps it below
 *                 50% is not fetched, and neither is a stock that cannot reach
 *                 the badge even if every market it has were fresh. On 14 Sep
 *                 2026 this was 534 markets and 5,490 requests.
 *   --offline     reuse the market lists saved by the last run: with the cache
 *                 filled, the whole build runs without a request.
 *   --from UNIX   the boundary new pins start at (default COMPOSITE_FROM).
 *   --verify-sweep TICKER
 *                 sweep one archived stock at every venue and compare with the
 *                 research's own files. TSLA and AMZN gave the same fresh and
 *                 traded minute counts at all nine venues.
 *
 * Rate limits: each venue is asked one request at a time with a pause
 * between, and a 429 from anyone stops the run (what was fetched is kept). */

import fs from "fs";
import os from "os";
import path from "path";

import { COMPOSITE_FROM, COMPOSITE_RULE, FRESH_SECS, VENUES, VENUE_ORDER, type Candle, type VenueId, type VenueWindow } from "../src/lib/composite";
import { DENIED_247, fetchVenueWindow, parseVenueBody, parseVenues247, type PinnedInput, type Venues247 } from "../src/lib/venues247";

const ROOT = path.resolve(__dirname, "..");

/* LAST WEEKEND, AND THE HOUR THE IDENTITY IS CHECKED IN. */
const SAT0 = 1_789_171_200; // Sat 12 Sep 2026 00:00 UTC
const MON0 = 1_789_344_000; // Mon 14 Sep 2026 00:00 UTC
const WEEKEND_MINUTES = (MON0 - SAT0) / 60; // 2,880
/** Fri 11 Sep 2026 19:59 UTC, 3:59 PM New York: the window is the regular
 *  session's last hour, the latest the research saved Yahoo minutes for. */
const IDENTITY_MINUTE = 1_789_156_740;

const IDENTITY_MAX_BPS = 150;
const BADGE_FRESH = 2_592; // 90% of 2,880
const PIN_FRESH = 1_440; // 50% of 2,880
const BADGE_ANCHORS = 2;
const BADGE_MARKETS = 3;

/* REFUSED BY NAME (docs/247-pricing.md, step 3).
 *
 * CL, BZ, SHEIN and SKHX are refused at every venue. The crypto collisions are
 * refused where the collision is: Lighter lists coins under bare symbols (SUI,
 * MET, LIT ...), so there the symbol is refused. At Binance a bStock is TICKER
 * + B, and the coins that read that way (ARB as AR, DGB as DG) are refused by
 * id in DENIED_247; refusing the bare names there would also refuse STXB,
 * which is priced like Seagate, not like Stacks. Hyperliquid's main dex, where
 * its coins live, is never read. */
const DENY_EVERYWHERE = new Set(["CL", "BZ", "SHEIN", "SKHX"]);
const DENY_COLLISIONS = new Set(["SUI", "STX", "SNX", "W", "STRK", "AR", "MET", "LIT", "DASH", "ARB", "DG"]);
const COLLISION_VENUES = new Set<VenueId>(["lighter"]);

type RosterStock = { ticker: string; name: string; market: string; currency: string; quote: string; source: string };

/* ---------------------------------------------------------------- arguments */

function args() {
  const a = process.argv.slice(2);
  const value = (flag: string) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const cache = value("--cache")?.replace(/^~(?=$|\/)/, os.homedir());
  if (!cache || !fs.existsSync(cache)) throw new Error("--cache must name the research directory (stonkwars-research/weekend-2026-09-12)");
  const from = value("--from") ? Number(value("--from")) : COMPOSITE_FROM;
  if (!Number.isSafeInteger(from)) throw new Error("--from must be unix seconds");
  return { cache, sweep: a.includes("--sweep"), offline: a.includes("--offline"), from };
}

/* ---------------------------------------------------------------- network */

class RateLimited extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let requests = 0;

async function getJson(url: string, init?: { method?: string; body?: string }): Promise<{ body: unknown } | { error: string }> {
  requests++;
  try {
    const r = await fetch(url, {
      method: init?.method ?? "GET",
      headers: { accept: "application/json", "user-agent": "stonkwars-build-247/1.0", ...(init?.body ? { "content-type": "application/json" } : {}) },
      ...(init?.body ? { body: init.body } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status === 429) throw new RateLimited(`429 from ${new URL(url).host}`);
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return { body: await r.json() };
  } catch (e) {
    if (e instanceof RateLimited) throw e;
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** One queue per venue: requests in order, a pause between. */
const PAUSE_MS: Record<VenueId | "yahoo", number> = {
  hyperliquid: 400,
  okx: 160,
  bitget: 150,
  binance: 120,
  lighter: 250,
  backpack: 250,
  gate: 150,
  mexc: 200,
  bingx: 250,
  yahoo: 600,
};

async function perVenue<T>(jobs: T[], venueOf: (j: T) => VenueId | "yahoo", run: (j: T) => Promise<void>): Promise<void> {
  const groups = new Map<string, T[]>();
  for (const j of jobs) groups.set(venueOf(j), [...(groups.get(venueOf(j)) ?? []), j]);
  await Promise.all(
    [...groups.entries()].map(async ([venue, list]) => {
      for (const j of list) {
        await run(j);
        await sleep(PAUSE_MS[venue as VenueId]);
      }
    }),
  );
}

/* ---------------------------------------------------------------- files */

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
function writeJson(file: string, value: unknown, indent?: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, indent)}\n`);
}
const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");

/* ---------------------------------------------------------------- 1. market lists */

type Listed = { venue: VenueId; instrument: string; symbol: string; note: string };

const LIST_URLS: Record<VenueId, { url: string; method?: string; body?: string }> = {
  hyperliquid: { url: "https://api.hyperliquid.xyz/info", method: "POST", body: JSON.stringify({ type: "metaAndAssetCtxs", dex: "xyz" }) },
  okx: { url: "https://www.okx.com/api/v5/public/instruments?instType=SWAP" },
  bitget: { url: "https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES" },
  binance: { url: "https://data-api.binance.vision/api/v3/exchangeInfo" },
  lighter: { url: "https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails" },
  backpack: { url: "https://api.backpack.exchange/api/v1/markets" },
  gate: { url: "https://api.gateio.ws/api/v4/futures/usdt/contracts" },
  mexc: { url: "https://contract.mexc.com/api/v1/contract/detail" },
  bingx: { url: "https://open-api.bingx.com/openApi/swap/v2/quote/contracts" },
};

type SavedList = { venue: VenueId; url: string; fetchedAt: string; body: unknown; annotations?: Record<string, unknown> };

/* A US listing as Hyperliquid's annotation writes it: "(Nasdaq: TSLA)",
 * "(NYSE Arca: SPY)". A Korean share "(KRX: 000660)" or a barrel of WTI has
 * none, so it names no roster stock. */
const US_LISTING = /\((Nasdaq|NYSE(?: Arca| American)?|Cboe[A-Za-z ]*|BATS[A-Za-z ]*): ([A-Z][A-Z0-9.]*)\)/;

async function marketList(venue: VenueId, work: string, offline: boolean): Promise<SavedList> {
  const file = path.join(work, "lists", `${venue}.json`);
  if (offline) {
    if (!fs.existsSync(file)) throw new Error(`--offline: no saved list for ${venue}`);
    return readJson<SavedList>(file);
  }
  const { url, method, body } = LIST_URLS[venue];
  const got = await getJson(url, { method, body });
  if ("error" in got) throw new Error(`${venue} market list: ${got.error}`);
  const saved: SavedList = { venue, url, fetchedAt: new Date().toISOString(), body: got.body };
  if (venue === "hyperliquid") {
    // Names: one perpAnnotation per live market.
    const [meta] = got.body as [{ universe: { name: string; isDelisted?: boolean }[] }];
    saved.annotations = {};
    for (const u of meta.universe) {
      if (u.isDelisted) continue;
      const a = await getJson(url, { method: "POST", body: JSON.stringify({ type: "perpAnnotation", coin: u.name }) });
      saved.annotations[u.name] = "error" in a ? { error: a.error } : a.body;
      await sleep(PAUSE_MS.hyperliquid);
    }
  }
  writeJson(file, saved);
  return saved;
}

function listedMarkets(saved: SavedList): Listed[] {
  const b = saved.body as never;
  const out: Listed[] = [];
  switch (saved.venue) {
    case "hyperliquid": {
      const [meta] = b as [{ universe: { name: string; isDelisted?: boolean }[] }];
      for (const u of meta.universe) {
        if (u.isDelisted) continue;
        const a = saved.annotations?.[u.name] as { category?: string; description?: string } | null | undefined;
        const m = a?.description ? US_LISTING.exec(a.description) : null;
        if (!m) continue;
        out.push({ venue: "hyperliquid", instrument: u.name, symbol: m[2], note: `annotation: ${a!.description!.split(",")[0].slice(0, 120)}` });
      }
      break;
    }
    case "okx":
      for (const x of (b as { data: { instCategory: string; settleCcy: string; state: string; instId: string; ctValCcy: string }[] }).data) {
        if (x.instCategory !== "3" || x.settleCcy !== "USDT" || x.state !== "live" || x.instId !== `${x.ctValCcy}-USDT-SWAP`) continue;
        out.push({ venue: "okx", instrument: x.instId, symbol: x.ctValCcy, note: "OKX stock swap (instCategory 3)" });
      }
      break;
    case "bitget":
      for (const x of (b as { data: { isRwa: string; symbolStatus: string; symbol: string; baseCoin: string; quoteCoin: string }[] }).data) {
        if (x.isRwa !== "YES" || x.symbolStatus !== "normal" || x.quoteCoin !== "USDT" || x.symbol !== `${x.baseCoin}USDT`) continue;
        out.push({ venue: "bitget", instrument: x.symbol, symbol: x.baseCoin, note: "Bitget RWA perp (isRwa YES)" });
      }
      break;
    case "binance":
      for (const x of (b as { symbols: { symbol: string; status: string; baseAsset: string; quoteAsset: string }[] }).symbols) {
        if (x.status !== "TRADING" || x.quoteAsset !== "USDT" || !/^[A-Z0-9]{2,}B$/.test(x.baseAsset) || x.symbol !== `${x.baseAsset}USDT`) continue;
        out.push({ venue: "binance", instrument: x.symbol, symbol: x.baseAsset.slice(0, -1), note: `Binance spot ${x.baseAsset} (TICKER + B, no category flag)` });
      }
      break;
    case "lighter":
      for (const x of (b as { order_book_details: { symbol: string; market_id: number; market_type: string; status: string }[] }).order_book_details) {
        if (x.market_type !== "perp" || x.status !== "active") continue;
        out.push({ venue: "lighter", instrument: String(x.market_id), symbol: x.symbol, note: `Lighter perp ${x.symbol} (no category flag)` });
      }
      break;
    case "backpack":
      for (const x of b as { symbol: string; baseSymbol: string; marketType: string; rwaMarketType: string | null; quoteSymbol: string }[]) {
        if (x.marketType !== "PERP" || !x.rwaMarketType || !/\.US$/.test(x.baseSymbol) || x.symbol !== `${x.baseSymbol}_USDC_PERP`) continue;
        out.push({ venue: "backpack", instrument: x.symbol, symbol: x.baseSymbol.slice(0, -3), note: `Backpack perp (rwaMarketType ${x.rwaMarketType})` });
      }
      break;
    case "gate":
      for (const x of b as { name: string; contract_type: string; status: string; in_delisting: boolean }[]) {
        if (x.contract_type !== "stocks" || x.status !== "trading" || x.in_delisting || !/_USDT$/.test(x.name)) continue;
        out.push({ venue: "gate", instrument: x.name, symbol: x.name.slice(0, -5), note: "Gate stock perp (contract_type stocks)" });
      }
      break;
    case "mexc":
      for (const x of (b as { data: { symbol: string; baseCoinName: string; quoteCoin: string; state: number; conceptPlate?: string[]; displayNameEn?: string }[] }).data) {
        if (!x.conceptPlate?.includes("mc-trade-zone-Stock") || x.state !== 0 || x.quoteCoin !== "USDT") continue;
        out.push({ venue: "mexc", instrument: x.symbol, symbol: x.baseCoinName, note: `MEXC Stock zone, ${x.displayNameEn ?? x.symbol}` });
      }
      break;
    case "bingx":
      for (const x of (b as { data: { symbol: string; status: number; currency: string; displayName: string }[] }).data) {
        if (!x.symbol.startsWith("NCSK") || x.status !== 1 || x.currency !== "USDT" || !/-USDT$/.test(x.displayName)) continue;
        out.push({ venue: "bingx", instrument: x.symbol, symbol: x.displayName.slice(0, -5), note: `BingX single-stock perp (NCSK), ${x.displayName}` });
      }
      break;
  }
  return out;
}

/* ---------------------------------------------------------------- 2. identity */

type YahooHour = { t: number[]; c: (number | null)[] };

async function yahooHour(stock: RosterStock, cache: string, work: string, m: number): Promise<{ hour: YahooHour; source: string } | null> {
  const preserved = path.join(cache, "cexr/yahoo", `${stock.ticker}.json`);
  const fetched = path.join(work, "yahoo", `${safeName(stock.ticker)}__${m}.json`);
  const covers = (y: YahooHour) => y.t.some((t, i) => t >= m - 3_600 && t <= m && y.c[i] != null);
  for (const [file, source] of [
    [preserved, `cexr/yahoo/${stock.ticker}.json`],
    [fetched, `build247/yahoo/${safeName(stock.ticker)}__${m}.json`],
  ] as const) {
    if (fs.existsSync(file)) {
      const y = readJson<YahooHour>(file);
      if (covers(y)) return { hour: y, source };
    }
  }
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(stock.quote)}?period1=${m - 3_600}&period2=${m + 60}&interval=1m&includePrePost=false`;
  const got = await getJson(url);
  await sleep(PAUSE_MS.yahoo);
  if ("error" in got) return null;
  const r = (got.body as { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } }).chart?.result?.[0];
  const hour = { t: r?.timestamp ?? [], c: r?.indicators?.quote?.[0]?.close ?? [] };
  writeJson(fetched, hour);
  return covers(hour) ? { hour, source: `build247/yahoo/${safeName(stock.ticker)}__${m}.json (live)` } : null;
}

type Identity = { bps: number; pairs: number; tradedPairs: number } | { refused: string };

function identityOf(rows: Candle[], y: YahooHour, m: number): Identity {
  const yahoo = new Map<number, number>();
  y.t.forEach((t, i) => {
    const c = y.c[i];
    if (c != null && c > 0 && t >= m - 3_600 && t <= m) yahoo.set(t, c);
  });
  const pairs = rows.filter((r) => yahoo.has(r.t)).map((r) => ({ traded: r.traded, gap: Math.abs(Number(r.close) / yahoo.get(r.t)! - 1) }));
  if (!pairs.length) return { refused: "no candle in the same minutes as Yahoo's regular-session closes" };
  const traded = pairs.filter((p) => p.traded);
  const use = (traded.length ? traded : pairs).map((p) => p.gap).sort((a, b) => a - b);
  const mid = use.length >> 1;
  const median = use.length % 2 ? use[mid] : (use[mid - 1] + use[mid]) / 2;
  return { bps: Math.round(median * 1e5) / 10, pairs: pairs.length, tradedPairs: traded.length };
}

async function identityWindow(l: Listed, work: string, m: number): Promise<VenueWindow> {
  const file = path.join(work, "identity", l.venue, `${safeName(l.instrument)}__${m}.json`);
  if (fs.existsSync(file)) {
    const kept = readJson<VenueWindow>(file);
    if ("rows" in kept) return kept;
  }
  const w = await fetchVenueWindow(l, m, { now: Math.floor(Date.now() / 1_000), timeoutMs: 15_000, settleSecs: 20 });
  requests++;
  if ("error" in w && w.error === "HTTP 429") throw new RateLimited(`429 from ${l.venue}`);
  if ("rows" in w) writeJson(file, w);
  return w;
}

/* ---------------------------------------------------------------- 3. weekend minutes */

type Minutes = { t: number; traded: boolean }[];
type WeekendData = { minutes: Minutes; source: string };

const tsec = (t: unknown) => {
  const n = Number(t);
  return n > 1e11 ? Math.floor(n / 1_000) : n;
};

/* Whether a file reaches over the whole weekend. Venues that print every
 * minute must have rows at both ends; Hyperliquid and Backpack leave quiet
 * minutes out, so for them the file's own start and end are what count. */
function spans(rows: Minutes, venue: VenueId, declared?: { start: number; end: number }): boolean {
  if (!rows.length) return false;
  if (declared) return declared.start <= SAT0 && declared.end >= MON0 - 60;
  const first = rows[0].t;
  const last = rows[rows.length - 1].t;
  return last >= MON0 - 60 && (VENUES[venue].forwardFill ? first <= SAT0 + 3_600 : first <= SAT0);
}

const CEX_KEY: Partial<Record<VenueId, string>> = {
  okx: "okx_perp",
  bitget: "bitget_perp",
  binance: "binance_bstock",
  gate: "gate_perp",
  mexc: "mexc_perp",
  bingx: "bingx_perp",
};
const CEXR_VENUE: Partial<Record<VenueId, string>> = { okx: "OKX", bitget: "Bitget", binance: "Binance", gate: "Gate", mexc: "MEXC", bingx: "BingX" };

function cachedWeekend(l: Listed, ticker: string, cache: string, work: string): WeekendData | null {
  const sorted = (m: Minutes) => m.sort((a, b) => a.t - b.t);
  const tryFile = (rel: string, read: (raw: unknown) => { minutes: Minutes; declared?: { start: number; end: number } } | null): WeekendData | null => {
    const file = path.join(cache, rel);
    if (!fs.existsSync(file)) return null;
    const got = read(readJson(file));
    if (!got) return null;
    const minutes = sorted(got.minutes);
    return spans(minutes, l.venue, got.declared) ? { minutes, source: rel } : null;
  };

  // What --sweep fetched before.
  const swept = path.join(work, "weekend", `${l.venue}__${safeName(l.instrument)}.json`);
  if (fs.existsSync(swept)) {
    const s = readJson<{ rows: [number, string, number][] }>(swept);
    const minutes = sorted(s.rows.map(([t, , traded]) => ({ t, traded: traded > 0 })));
    if (spans(minutes, l.venue)) return { minutes, source: `build247/weekend/${path.basename(swept)}` };
  }

  switch (l.venue) {
    case "hyperliquid": {
      const coin = l.instrument.replace(":", "_");
      const hl = (raw: unknown) => {
        const d = raw as { start?: number; end?: number; candles?: { t: number; n: number }[] } | { t: number; n: number }[];
        const candles = Array.isArray(d) ? d : d.candles ?? [];
        return {
          minutes: candles.map((c) => ({ t: tsec(c.t), traded: Number(c.n) > 0 })),
          declared: !Array.isArray(d) && d.start && d.end ? { start: tsec(d.start), end: tsec(d.end) } : undefined,
        };
      };
      return tryFile(`sw247/hl/${coin}.json`, hl) ?? tryFile(`cexr/hl/${coin}.json`, hl) ?? tryFile(`hlr_data/c1m/${coin}.json`, hl);
    }
    case "lighter":
    case "backpack": {
      const kind = l.venue === "lighter" ? "lighter" : "backpackperp";
      const field = l.venue === "lighter" ? "v" : "n";
      const read = (raw: unknown) => ({
        minutes: (raw as Record<string, unknown>[]).map((r) => ({ t: tsec(r.t), traded: Number(r[field] ?? 0) > 0 })),
      });
      const key = l.venue === "lighter" ? "lighter_perp" : "backpack_perp";
      return (
        tryFile(`cr_data/v/${kind}_${ticker}.json`, read) ??
        tryFile(`sw247/data/${key}__${ticker}.json`, (raw) => ({
          minutes: (raw as { rows: Record<string, unknown>[] }).rows.map((r) => ({ t: tsec(r.t), traded: Number(r[field] ?? 0) > 0 })),
        }))
      );
    }
    default: {
      // The twelve archived stocks, with the hour before the weekend.
      const field = l.venue === "binance" ? "n" : "v";
      const archived = tryFile(`sw247/data/${CEX_KEY[l.venue]}__${ticker}.json`, (raw) => {
        const maps = readJson<Record<string, Record<string, string>>>(path.join(cache, "sw247/breadth/symbol_maps.json"));
        if (maps[CEX_KEY[l.venue]!]?.[ticker] !== l.instrument) return null;
        return { minutes: (raw as { rows: Record<string, unknown>[] }).rows.map((r) => ({ t: tsec(r.t), traded: Number(r[field] ?? 0) > 0 })) };
      });
      if (archived) return archived;
      // The CEX lens's full weekends: [t, close, traded 0/1] from Sat 00:00.
      return tryFile(`cexr/full/${CEXR_VENUE[l.venue]}__${l.instrument}.json`, (raw) => ({
        minutes: (raw as { bars: [number, number, number][] }).bars.map(([t, , traded]) => ({ t, traded: traded > 0 })),
      }));
    }
  }
}

/** Fresh minutes: a trade at this venue in the 840 s up to and including m. */
function freshness(minutes: Minutes): { fresh: number; traded: number } {
  const traded = minutes.filter((r) => r.traded).map((r) => r.t);
  let i = -1;
  let fresh = 0;
  for (let m = SAT0; m < MON0; m += 60) {
    while (i + 1 < traded.length && traded[i + 1] <= m) i++;
    if (i >= 0 && traded[i] >= m - FRESH_SECS) fresh++;
  }
  return { fresh, traded: traded.filter((t) => t >= SAT0 && t < MON0).length };
}

/* THE SWEEP. One venue at a time, its history endpoint paged over the weekend
 * and the hour before, each page read with the oracle's own body parser. */
function sweepPages(l: Listed): { url: string; body?: string }[] {
  const from = SAT0 - 3_600;
  const pages: { url: string; body?: string }[] = [];
  const i = l.instrument;
  const step = (span: number, make: (a: number, b: number) => string) => {
    for (let a = from; a < MON0; a += span) pages.push({ url: make(a, Math.min(a + span, MON0)) });
  };
  switch (l.venue) {
    case "okx": // rows older than `after`, 100 at a time
      for (let after = MON0; after > from; after -= 6_000) pages.push({ url: `https://www.okx.com/api/v5/market/history-candles?instId=${i}&bar=1m&after=${after * 1_000}&limit=100` });
      break;
    case "bitget": // endTime exclusive, 200 rows
      step(12_000, (a, b) => `https://api.bitget.com/api/v2/mix/market/history-candles?symbol=${i}&productType=USDT-FUTURES&granularity=1m&startTime=${a * 1_000}&endTime=${b * 1_000}&limit=200`);
      break;
    case "binance": // both ends inclusive, 1,000 rows
      step(60_000, (a, b) => `https://data-api.binance.vision/api/v3/klines?symbol=${i}&interval=1m&startTime=${a * 1_000}&endTime=${(b - 60) * 1_000}&limit=1000`);
      break;
    case "gate": // both ends inclusive
      step(86_400, (a, b) => `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${i}&interval=1m&from=${a}&to=${b - 60}`);
      break;
    case "mexc": // both ends inclusive
      step(86_400, (a, b) => `https://contract.mexc.com/api/v1/contract/kline/${i}?interval=Min1&start=${a}&end=${b - 60}`);
      break;
    case "bingx": // endTime exclusive, 1,440 rows
      step(86_400, (a, b) => `https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${i}&interval=1m&startTime=${a * 1_000}&endTime=${b * 1_000}&limit=1440`);
      break;
    case "lighter": // end exclusive; count_back no smaller than the window
      step(30_000, (a, b) => `https://mainnet.zklighter.elliot.ai/api/v1/candles?market_id=${i}&resolution=1m&start_timestamp=${a * 1_000}&end_timestamp=${b * 1_000}&count_back=500`);
      break;
    case "backpack": // seconds, end exclusive, at most about 10 hours a request
      step(36_000, (a, b) => `https://api.backpack.exchange/api/v1/klines?symbol=${i}&interval=1m&startTime=${a}&endTime=${b}`);
      break;
    case "hyperliquid": // one request: up to 5,000 candles, both ends inclusive
      pages.push({
        url: "https://api.hyperliquid.xyz/info",
        body: JSON.stringify({ type: "candleSnapshot", req: { coin: i, interval: "1m", startTime: from * 1_000, endTime: MON0 * 1_000 - 1 } }),
      });
      break;
  }
  return pages;
}

async function sweep(l: Listed, work: string, into = "weekend"): Promise<string | null> {
  const pages = sweepPages(l);
  const rows = new Map<number, Candle>();
  for (const p of pages) {
    const got = await getJson(p.url, p.body ? { method: "POST", body: p.body } : undefined);
    if ("error" in got) return `${VENUES[l.venue].name} history: ${got.error}`;
    try {
      for (const c of parseVenueBody(l.venue, got.body)) if (c.t >= SAT0 - 3_600 && c.t < MON0) rows.set(c.t, c);
    } catch (e) {
      return `${VENUES[l.venue].name} history: ${e instanceof Error ? e.message : e}`;
    }
    await sleep(PAUSE_MS[l.venue]);
  }
  const sorted = [...rows.values()].sort((a, b) => a.t - b.t);
  writeJson(path.join(work, into, `${l.venue}__${safeName(l.instrument)}.json`), {
    venue: l.venue,
    instrument: l.instrument,
    fetchedAt: new Date().toISOString(),
    requests: pages.map((p) => (p.body ? `POST ${p.url} ${p.body}` : p.url)),
    rows: sorted.map((c) => [c.t, c.close, c.traded ? 1 : 0]),
  });
  return null;
}

/* HOURLY LIVENESS CAPS FRESHNESS. In an hour with no trade only its first 14
 * minutes can still be fresh, so h live hours of 48 allow at most
 * 60h + 14(48 - h) fresh minutes. The research saved hourly bars for every
 * market it mapped (sw247/breadth), which says, without fetching minutes,
 * which markets cannot reach 50% or 90%. Used only to decide what to sweep. */
function freshCap(l: Listed, ticker: string, cache: string): { cap: number; liveHours: number } | null {
  const key = CEX_KEY[l.venue];
  if (!key) return null;
  const maps = readJson<Record<string, Record<string, string>>>(path.join(cache, "sw247/breadth/symbol_maps.json"));
  if (maps[key]?.[ticker] !== l.instrument) return null;
  const rows = readJson<{ rows: Record<string, [number, number, number, number, number | null][]> }>(path.join(cache, `sw247/breadth/${key}.json`)).rows[ticker];
  if (!rows) return null;
  const liveHours = new Set(rows.filter((r) => r[0] >= SAT0 && r[0] < MON0 && r[3] > 0).map((r) => r[0])).size;
  return { cap: 60 * liveHours + 14 * (48 - liveHours), liveHours };
}

/* ---------------------------------------------------------------- 4. decisions */

type Market = Listed & {
  ticker: string;
  anchor: boolean;
  identity?: Identity & { source?: string };
  weekend?: { fresh: number; traded: number; source: string } | { cap: number; liveHours: number } | { missing: string };
  verdict: "badge" | "input" | "refused";
  why: string;
};

const pct = (fresh: number) => `${((fresh / WEEKEND_MINUTES) * 100).toFixed(1)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* --verify-sweep TICKER: fetch a stock the research archived, venue by venue,
 * the way the sweep does, and compare what the two say about the weekend. A
 * sweep that paged wrong or read a field wrong shows up here as a different
 * count, before it decides anyone else's badge. */
async function verifySweep(ticker: string, cache: string, work: string) {
  const maps = readJson<Record<string, Record<string, string | number>>>(path.join(cache, "sw247/breadth/symbol_maps.json"));
  const keys: [VenueId, string][] = [
    ["hyperliquid", "xyz"],
    ["okx", "okx_perp"],
    ["bitget", "bitget_perp"],
    ["binance", "binance_bstock"],
    ["lighter", "lighter_perp"],
    ["backpack", "backpack_perp"],
    ["gate", "gate_perp"],
    ["mexc", "mexc_perp"],
    ["bingx", "bingx_perp"],
  ];
  for (const [venue, key] of keys) {
    const instrument = maps[key]?.[ticker];
    if (instrument === undefined) continue;
    const l: Listed = { venue, instrument: String(instrument), symbol: ticker, note: "" };
    const archived = cachedWeekend(l, ticker, cache, path.join(work, "no-sweeps"));
    const failed = await sweep(l, work, "verify");
    if (failed) {
      console.log(`${VENUES[venue].name.padEnd(12)} ${failed}`);
      continue;
    }
    const s = readJson<{ rows: [number, string, number][] }>(path.join(work, "verify", `${venue}__${safeName(l.instrument)}.json`));
    const swept = freshness(s.rows.map(([t, , traded]) => ({ t, traded: traded > 0 })));
    const a = archived ? freshness(archived.minutes) : null;
    console.log(
      `${VENUES[venue].name.padEnd(12)} ${l.instrument.padEnd(22)} swept fresh ${swept.fresh} traded ${swept.traded}` +
        `  archived ${a ? `fresh ${a.fresh} traded ${a.traded} (${archived!.source})` : "none"}${a && (a.fresh !== swept.fresh || a.traded !== swept.traded) ? "  DIFFERENT" : ""}`,
    );
  }
}

async function main() {
  const opts = args();
  const work = path.join(opts.cache, "build247");
  const started = new Date().toISOString();
  const verify = process.argv.indexOf("--verify-sweep");
  if (verify >= 0) return verifySweep(process.argv[verify + 1], opts.cache, work);

  const roster = readJson<RosterStock[]>(path.join(ROOT, "src/data/roster.json"));
  const us = new Map(roster.filter((s) => s.market === "US" && s.currency === "USD").map((s) => [s.ticker, s]));
  const byKey = new Map([...us.keys()].map((t) => [t.replace(/[.\-/]/g, ""), t]));

  /* 1. Lists. */
  console.log("market lists", opts.offline ? "(saved)" : "(live)");
  const lists = {} as Record<VenueId, SavedList>;
  await Promise.all(VENUE_ORDER.map(async (v) => (lists[v] = await marketList(v, work, opts.offline))));
  const markets: Market[] = [];
  const listCounts = {} as Record<VenueId, number>;
  for (const v of VENUE_ORDER) {
    const all = listedMarkets(lists[v]);
    listCounts[v] = all.length;
    for (const l of all) {
      const key = l.symbol.replace(/[.\-/]/g, "");
      // BingX suffixes a few US names (AMDUS-USDT); the price decides which reading is right.
      const tickers = [byKey.get(key), v === "bingx" && /US$/.test(key) ? byKey.get(key.slice(0, -2)) : undefined].filter((t): t is string => !!t);
      for (const ticker of new Set(tickers)) markets.push({ ...l, ticker, anchor: VENUES[v].anchor, verdict: "refused", why: "" });
    }
    console.log(`  ${VENUES[v].name.padEnd(12)} ${String(all.length).padStart(4)} stock markets listed, ${markets.filter((x) => x.venue === v).length} on US roster tickers`);
  }

  /* Not denied. */
  const deniedSeen: string[] = [];
  for (const mk of markets) {
    const byName = DENY_EVERYWHERE.has(mk.ticker) || DENY_EVERYWHERE.has(mk.symbol) || (COLLISION_VENUES.has(mk.venue) && (DENY_COLLISIONS.has(mk.ticker) || DENY_COLLISIONS.has(mk.symbol)));
    const byId = DENIED_247[mk.venue].includes(mk.instrument);
    if (byName || byId) {
      mk.why = byId ? `denied instrument id (DENIED_247)` : `denied symbol ${mk.symbol} at ${VENUES[mk.venue].name}`;
      deniedSeen.push(`${mk.venue} ${mk.instrument} (${mk.symbol} -> ${mk.ticker})`);
      if (byName && !byId) console.log(`  not in DENIED_247 yet: ${mk.venue} ${mk.instrument} (${mk.symbol})`);
    }
  }
  // Denied ids the lists carry under any symbol, so DENIED_247 can be kept whole.
  for (const v of VENUE_ORDER) {
    for (const l of listedMarkets(lists[v])) {
      if (DENY_EVERYWHERE.has(l.symbol) || (COLLISION_VENUES.has(v) && DENY_COLLISIONS.has(l.symbol))) {
        if (!DENIED_247[v].includes(l.instrument)) console.log(`  listed and denied by name, not in DENIED_247: ${v} ${l.instrument} (${l.symbol})`);
      }
    }
  }

  /* 2. Identity. */
  const m = IDENTITY_MINUTE;
  console.log(`\nidentity: ${markets.filter((x) => !x.why).length} markets against Yahoo, minutes ${m - 3_600} to ${m}`);
  const yahoo = new Map<string, Awaited<ReturnType<typeof yahooHour>>>();
  for (const t of new Set(markets.filter((x) => !x.why).map((x) => x.ticker))) yahoo.set(t, await yahooHour(us.get(t)!, opts.cache, work, m));
  await perVenue(
    markets.filter((x) => !x.why),
    (x) => x.venue,
    async (mk) => {
      const y = yahoo.get(mk.ticker);
      if (!y) {
        mk.identity = { refused: "no Yahoo closes for the hour" };
        mk.why = "identity unverified: no Yahoo closes for the hour";
        return;
      }
      const w = await identityWindow(mk, work, m);
      if ("error" in w) {
        mk.identity = { refused: w.error };
        mk.why = `identity unverified: ${w.error}`;
        return;
      }
      const id = identityOf(w.rows, y.hour, m);
      mk.identity = { ...id, source: y.source };
      if ("refused" in id) mk.why = `identity unverified: ${id.refused}`;
      else if (id.bps > IDENTITY_MAX_BPS) mk.why = `not the stock: ${(id.bps / 100).toFixed(2)}% from Yahoo in the same minutes`;
    },
  );

  /* 3. Weekend minutes. */
  const alive = markets.filter((x) => !x.why);
  for (const mk of alive) {
    const got = cachedWeekend(mk, mk.ticker, opts.cache, work);
    if (got) mk.weekend = { ...freshness(got.minutes), source: got.source };
  }
  // Whether each market could be 90% fresh: measured, or not ruled out by its hourly cap.
  const could90 = new Map<Market, boolean>();
  for (const mk of alive) {
    const w = mk.weekend;
    const cap = w ? null : freshCap(mk, mk.ticker, opts.cache);
    could90.set(mk, w && "fresh" in w ? w.fresh >= BADGE_FRESH : !cap || cap.cap >= BADGE_FRESH);
  }
  const potential = (ticker: string) => {
    const venues = new Set(alive.filter((x) => x.ticker === ticker && could90.get(x)).map((x) => x.venue));
    return { anchors: [...venues].filter((v) => VENUES[v].anchor).length, markets: venues.size };
  };
  const toSweep: Market[] = [];
  for (const mk of alive) {
    if (mk.weekend) continue;
    const cap = freshCap(mk, mk.ticker, opts.cache);
    const p = potential(mk.ticker);
    if (cap && cap.cap < PIN_FRESH) {
      mk.weekend = cap;
      mk.why = `at most ${pct(cap.cap)} fresh: traded in ${cap.liveHours} of 48 weekend hours`;
    } else if (p.anchors < BADGE_ANCHORS || p.markets < BADGE_MARKETS) {
      mk.weekend = cap ?? { missing: "not fetched" };
      mk.why = `not fetched: the stock cannot reach the badge (at most ${plural(p.anchors, "anchor")} and ${plural(p.markets, "market")} could be 90% fresh)`;
    } else toSweep.push(mk);
  }
  if (toSweep.length) {
    if (!opts.sweep) {
      console.log(`\n${toSweep.length} markets have no weekend minutes in the cache; run with --sweep to fetch them`);
      for (const mk of toSweep) {
        mk.weekend = { missing: "no weekend minutes in the cache" };
        mk.why = "no weekend minutes in the cache (run with --sweep)";
      }
    } else {
      console.log(`\nsweeping weekend minutes for ${toSweep.length} markets`);
      let done = 0;
      await perVenue(toSweep, (x) => x.venue, async (mk) => {
        const failed = await sweep(mk, work);
        const got = failed ? null : cachedWeekend(mk, mk.ticker, opts.cache, work);
        if (got) mk.weekend = { ...freshness(got.minutes), source: got.source };
        else {
          mk.weekend = { missing: failed ?? "sweep did not cover the weekend" };
          mk.why = `weekend minutes unavailable: ${failed ?? "the history did not cover the weekend"}`;
        }
        if (++done % 25 === 0) console.log(`  ${done}/${toSweep.length}`);
      });
    }
  }

  /* 4. Per stock. */
  const byTicker = new Map<string, Market[]>();
  for (const mk of markets) byTicker.set(mk.ticker, [...(byTicker.get(mk.ticker) ?? []), mk]);
  const badge: string[] = [];
  const chosen = new Map<string, Market[]>();
  for (const [ticker, list] of byTicker) {
    for (const mk of list) {
      if (mk.why) continue;
      const w = mk.weekend;
      if (!w || !("fresh" in w)) {
        mk.why ||= "no weekend minutes";
        continue;
      }
      if (w.fresh < PIN_FRESH) mk.why = `${pct(w.fresh)} fresh over the weekend, under 50%`;
    }
    // One market per venue: the freshest, then the closest to Yahoo.
    const pins: Market[] = [];
    for (const v of VENUE_ORDER) {
      const ok = list.filter((x) => x.venue === v && !x.why);
      ok.sort((a, b) => (b.weekend as { fresh: number }).fresh - (a.weekend as { fresh: number }).fresh || (a.identity as { bps: number }).bps - (b.identity as { bps: number }).bps);
      if (ok[0]) pins.push(ok[0]);
      for (const other of ok.slice(1)) other.why = `a fresher ${VENUES[v].name} market was chosen (${ok[0].instrument})`;
    }
    const at90 = pins.filter((x) => (x.weekend as { fresh: number }).fresh >= BADGE_FRESH);
    const has = at90.filter((x) => x.anchor).length >= BADGE_ANCHORS && at90.length >= BADGE_MARKETS;
    for (const x of pins) {
      x.verdict = has ? ((x.weekend as { fresh: number }).fresh >= BADGE_FRESH ? "badge" : "input") : "refused";
      x.why = has ? (x.verdict === "badge" ? "pinned, counts towards the badge" : "pinned as an input, under 90% fresh") : `the stock has no badge: ${plural(at90.filter((y) => y.anchor).length, "anchor")} and ${plural(at90.length, "market")} at 90%`;
    }
    if (has) {
      badge.push(ticker);
      chosen.set(ticker, pins);
    }
  }
  badge.sort();

  /* Write venues247.json: keep the boundaries of pins that stay, close the ones that go. */
  const file = path.join(ROOT, "src/data/venues247.json");
  const before = parseVenues247(readJson(file));
  const tickers: Venues247["tickers"] = {};
  const names = [...new Set([...Object.keys(before.tickers), ...badge])].sort();
  for (const t of names) {
    const old = before.tickers[t] ?? [];
    const pins = chosen.get(t) ?? [];
    const out: PinnedInput[] = [];
    for (const o of old) {
      const kept = o.until === undefined && pins.some((p) => p.venue === o.venue && p.instrument === o.instrument);
      out.push(kept || o.until !== undefined ? o : { ...o, until: Math.max(opts.from, o.from + 60) });
    }
    for (const p of pins) {
      if (!out.some((o) => o.venue === p.venue && o.instrument === p.instrument && o.until === undefined)) out.push({ venue: p.venue, instrument: p.instrument, from: opts.from });
    }
    out.sort((a, b) => VENUE_ORDER.indexOf(a.venue) - VENUE_ORDER.indexOf(b.venue) || a.from - b.from);
    tickers[t] = out;
  }
  const next = { rule: COMPOSITE_RULE, tickers };
  parseVenues247(next); // the same checks the oracle makes when it loads the file
  // One pin per line, as venues247.ts documents the file.
  const pinsText = Object.entries(tickers)
    .map(([t, list]) => `    ${JSON.stringify(t)}: [\n${list.map((p) => `      ${JSON.stringify(p).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/^\{/, "{ ").replace(/\}$/, " }")}`).join(",\n")}\n    ]`)
    .join(",\n");
  const text = `{\n  "rule": ${JSON.stringify(COMPOSITE_RULE)},\n  "tickers": {\n${pinsText}\n  }\n}\n`;
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(next)) throw new Error("venues247.json did not round-trip");
  fs.writeFileSync(file, text);

  /* Evidence: every market on a stock that had at least one market pass identity. */
  const evidenceTickers: Record<string, unknown> = {};
  for (const t of [...byTicker.keys()].sort()) {
    const list = byTicker.get(t)!;
    if (!list.some((x) => x.identity && "bps" in x.identity)) continue;
    // Measured for every stock, badge or not: venues with a market that is the stock and 90% fresh.
    const at90 = new Set(list.filter((x) => x.identity && "bps" in x.identity && x.identity.bps <= IDENTITY_MAX_BPS && x.weekend && "fresh" in x.weekend && x.weekend.fresh >= BADGE_FRESH).map((x) => x.venue));
    evidenceTickers[t] = {
      badge: badge.includes(t),
      anchors90: [...at90].filter((v) => VENUES[v].anchor).length,
      markets90: at90.size,
      markets: list
        .sort((a, b) => VENUE_ORDER.indexOf(a.venue) - VENUE_ORDER.indexOf(b.venue))
        .map((x) => ({
          venue: x.venue,
          instrument: x.instrument,
          symbol: x.symbol,
          anchor: x.anchor,
          name: x.note,
          identity: x.identity ?? null,
          weekend: x.weekend ?? null,
          verdict: x.verdict,
          why: x.why,
        })),
    };
  }
  const evidence = {
    rule: COMPOSITE_RULE,
    builtAt: started,
    cache: "stonkwars-research/weekend-2026-09-12",
    identityWindow: { from: m - 3_600, until: m, note: "Fri 11 Sep 2026 14:59 to 15:59 New York, regular session; Yahoo closes from the research cache" },
    weekend: { from: SAT0, until: MON0, minutes: WEEKEND_MINUTES, freshSecs: FRESH_SECS },
    thresholds: { identityMaxBps: IDENTITY_MAX_BPS, pinFresh: PIN_FRESH, badgeFresh: BADGE_FRESH, badgeAnchors: BADGE_ANCHORS, badgeMarkets: BADGE_MARKETS },
    lists: Object.fromEntries(VENUE_ORDER.map((v) => [v, { url: lists[v].url, fetchedAt: lists[v].fetchedAt, stockMarkets: listCounts[v] }])),
    denied: deniedSeen.sort(),
    badge,
    tickers: evidenceTickers,
  };
  // One market per line: readable, and a rebuild diffs by market.
  const tickersText = Object.entries(evidenceTickers)
    .map(([t, e]) => {
      const { markets: ms, ...head } = e as { markets: unknown[] };
      const inner = ms.map((x) => `    ${JSON.stringify(x)}`).join(",\n");
      return `  ${JSON.stringify(t)}: ${JSON.stringify(head).slice(0, -1)}, "markets": [\n${inner}\n  ]}`;
    })
    .join(",\n");
  const evidenceText = JSON.stringify({ ...evidence, tickers: "TICKERS" }, null, 1).replace('"TICKERS"', `{\n${tickersText}\n }`);
  JSON.parse(evidenceText);
  fs.writeFileSync(path.join(ROOT, "scripts/data/venues247.evidence.json"), `${evidenceText}\n`);

  writeLog(evidence as unknown as Evidence, opts.cache, roster);

  const anchors3 = badge.filter((t) => chosen.get(t)!.filter((x) => x.verdict === "badge" && x.anchor).length >= 3);
  console.log(`\n${badge.length} stocks fight around the clock (${anchors3.length} with 3 or more anchors at 90%), ${requests} requests`);
  console.log("written src/data/venues247.json, scripts/data/venues247.evidence.json, docs/247-roster.md");
}

/* ---------------------------------------------------------------- the log */

type EvidenceMarket = {
  venue: VenueId;
  instrument: string;
  symbol: string;
  anchor: boolean;
  name: string;
  identity: { bps: number; pairs: number; tradedPairs: number } | { refused: string } | null;
  weekend: { fresh: number; traded: number; source: string } | { cap: number; liveHours: number } | { missing: string } | null;
  verdict: "badge" | "input" | "refused";
  why: string;
};
type Evidence = {
  builtAt: string;
  badge: string[];
  lists: Record<VenueId, { url: string; fetchedAt: string; stockMarkets: number }>;
  denied: string[];
  tickers: Record<string, { badge: boolean; anchors90: number; markets90: number; markets: EvidenceMarket[] }>;
};

const SHORT: Record<VenueId, string> = { hyperliquid: "HL", okx: "OKX", bitget: "BG", binance: "BN", lighter: "LT", backpack: "BP", gate: "GT", mexc: "MX", bingx: "BX" };
const LEAD_KEY: Record<string, VenueId> = {
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

/** "BG 92.7% (412)": weekend freshness, and in brackets the minutes that traded. */
const freshWords = (venue: VenueId, w: { fresh: number; traded: number }) => `${SHORT[venue]} ${pct(w.fresh)} (${w.traded.toLocaleString("en-US")})`;

function marketWords(x: EvidenceMarket): string {
  const w = x.weekend;
  if (w && "fresh" in w) return freshWords(x.venue, w);
  if (x.identity && "bps" in x.identity && x.identity.bps > IDENTITY_MAX_BPS) return `${SHORT[x.venue]} not the stock (${(x.identity.bps / 100).toFixed(2)}% off Yahoo)`;
  if (x.identity && "refused" in x.identity) return `${SHORT[x.venue]} unverified (${x.identity.refused.startsWith("no candle") ? "no candle in the identity hour" : x.identity.refused})`;
  if (w && "cap" in w) return `${SHORT[x.venue]} ${x.why.startsWith("not fetched") ? "not fetched, " : ""}at most ${pct(w.cap)} (${w.liveHours}/48 hours traded)`;
  if (/denied/.test(x.why)) return `${SHORT[x.venue]} denied`;
  return `${SHORT[x.venue]} ${x.why}`;
}

/** Why a stock does or does not have the badge, in the numbers that decided it. */
function reason(ev: Evidence, t: string): string {
  const e = ev.tickers[t];
  if (!e) return "no market on any of the nine venues passed the identity check";
  const best = new Map<VenueId, EvidenceMarket>();
  for (const x of e.markets) {
    const prev = best.get(x.venue);
    const score = (y: EvidenceMarket) => (y.weekend && "fresh" in y.weekend ? y.weekend.fresh : -1);
    if (!prev || score(x) > score(prev)) best.set(x.venue, x);
  }
  const parts = VENUE_ORDER.filter((v) => best.has(v)).map((v) => marketWords(best.get(v)!));
  const skipped = e.markets.find((x) => x.why.startsWith("not fetched"));
  return (
    `${plural(e.anchors90, "anchor")} and ${plural(e.markets90, "market")} at 90%: ${parts.join(", ")}` +
    (skipped ? `. Minutes not fetched: ${skipped.why.replace(/^not fetched: /, "")}` : "")
  );
}

function writeLog(ev: Evidence, cache: string, roster: RosterStock[]) {
  const lead = readJson<{ A2T3: string[]; A3: string[]; qual: Record<string, Record<string, string>> }>(path.join(cache, "lead_count2.json"));
  const perps = readJson<Record<string, unknown>>(path.join(ROOT, "src/data/perps.json"));
  const pools = readJson<Record<string, unknown>>(path.join(ROOT, "src/data/pools.json"));
  const today = roster.filter((s) => s.source !== "pyth" && (s.ticker in perps || s.ticker in pools)).map((s) => s.ticker).sort();
  const mine = new Set(ev.badge);
  const plan = new Set(lead.A2T3);
  const three = (t: string) => (ev.tickers[t]?.markets ?? []).filter((x) => x.verdict === "badge" && x.anchor).length;
  const leadWords = (t: string) =>
    Object.entries(lead.qual[t] ?? {})
      .map(([k, v]) => `${SHORT[LEAD_KEY[k]]} ${v}`)
      .join(", ") || "none";

  const lines: string[] = [];
  const say = (s = "") => lines.push(s);
  say("# Stonk Wars 24/7 roster: build log");
  say();
  say(`Generated by \`scripts/build-247.ts\` at ${ev.builtAt}. The numbers below are the script's measurements; the full record of every market it considered is \`scripts/data/venues247.evidence.json\`.`);
  say();
  say("## How it was built");
  say();
  say("- **Market lists:** fetched live from each venue at the times below.");
  say("- **Identity:** each market's one-minute closes from Fri 11 Sep 2026, 14:59 to 15:59 New York (regular session), fetched with the oracle's own request (`fetchVenueWindow`), against Yahoo's closes for the same minutes from the research cache. The regular session was closed when this roster was first built (Monday 14 Sep, evening in New York), so the check uses Friday's last hour, the latest the research saved Yahoo minutes for. Median gap at most 1.5%.");
  say("- **Liveness:** exact 15-minute freshness over the 2,880 weekend minutes (Sat 12 Sep 00:00 to Mon 14 Sep 00:00 UTC), from one-minute data: the research cache for Hyperliquid, Lighter, Backpack and the archived stocks, and a one-time sweep of the venues' history for the other CEX markets (saved under `build247/weekend` in the cache).");
  say("- **Pin** at 50% freshness or more; **badge** with at least 2 anchors and at least 3 markets at 90% or more. Only badge stocks are written to `src/data/venues247.json`.");
  say("- **Reading the tables:** `BG 92.7% (412)` means the Bitget market was fresh in 92.7% of the weekend's minutes and 412 of those minutes had a trade. HL Hyperliquid, OKX, BG Bitget, BN Binance, LT Lighter, BP Backpack (anchors); GT Gate, MX MEXC, BX BingX (inputs that never make the two anchors).");
  say();
  say("| Venue | Stock markets listed | Fetched |");
  say("|---|---|---|");
  for (const v of VENUE_ORDER) say(`| ${VENUES[v].name} | ${ev.lists[v].stockMarkets} | ${ev.lists[v].fetchedAt} |`);
  say();
  say(`Denied by name or id: ${ev.denied.length ? ev.denied.map((d) => `\`${d}\``).join(", ") : "none listed"}.`);
  say();
  say(`## Result: ${ev.badge.length} stocks, ${ev.badge.filter((t) => three(t) >= 3).length} of them with 3 or more anchors`);
  say();
  say("| Ticker | Counts towards the badge (90%+) | Pinned as input (50 to 90%) |");
  say("|---|---|---|");
  for (const t of ev.badge) {
    const ms = ev.tickers[t].markets;
    const words = (verdict: string) =>
      ms
        .filter((x) => x.verdict === verdict)
        .map((x) => freshWords(x.venue, x.weekend as { fresh: number; traded: number }))
        .join(", ") || "none";
    say(`| ${t} | ${words("badge")} | ${words("input")} |`);
  }
  say();
  say("## Against the plan (docs/247-pricing.md, section 2)");
  say();
  say("The plan's lists are the lead's own output, `lead_count2.json` in the research cache: 48 badge names (`A2T3`) and 36 with three anchors (`A3`). The plan counted CEX markets by a proxy (at least 10 traded minutes in each of two probe hours and trades in at least 44 of 48 weekend hours) and Hyperliquid, Lighter and Backpack by exact freshness. This build measures every market exactly, which is where most differences come from. The last column is what the lead counted: traded minutes in the two probe hours (Sat 16:00 and Sun 08:00 UTC) for a CEX, and `f` freshness for HL, LT and BP.");
  say();
  // How the exact measure differs from the proxy, over the markets that count towards a badge here.
  const counted = ev.badge.flatMap((t) => ev.tickers[t].markets.filter((x) => x.verdict === "badge" && x.anchor).map((x) => ({ t, x })));
  const byLead = (t: string, v: VenueId) => Object.keys(lead.qual[t] ?? {}).some((k) => LEAD_KEY[k] === v);
  const medianOf = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? (s.length % 2 ? s[s.length >> 1] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)) : 0;
  };
  const tradedOf = (x: EvidenceMarket) => (x.weekend as { traded: number }).traded;
  const agreed = counted.filter(({ t, x }) => byLead(t, x.venue)).map(({ x }) => tradedOf(x));
  const added = counted.filter(({ t, x }) => !byLead(t, x.venue)).map(({ x }) => tradedOf(x));
  say(
    `Where the two disagree, it is thin markets. Of the ${counted.length} anchor markets counting towards a badge here, the plan also counted ${agreed.length}, ` +
      `with a median of ${medianOf(agreed).toLocaleString("en-US")} traded weekend minutes; the other ${added.length} have a median of ${medianOf(added).toLocaleString("en-US")}. ` +
      "A market that trades once every ten minutes is fresh in nearly every minute of the composite's 15-minute test, but falls under the proxy's 10 traded minutes an hour. " +
      "Freshness is the test the composite applies to every minute it prices, so it is what decides here; a floor on traded minutes would be a new rule, and is the lead's call.",
  );
  say();
  const kept = today.filter((t) => plan.has(t));
  const lost = today.filter((t) => !plan.has(t));
  const gained = lead.A2T3.filter((t) => !today.includes(t));
  const row = (t: string) => `| ${t} | ${mine.has(t) ? "yes" : "**no**"} | ${reason(ev, t)} | ${leadWords(t)} |`;
  for (const [title, list] of [
    [`Plan: keeps 24/7 (${kept.length})`, kept],
    [`Plan: gains 24/7 (${gained.length})`, gained],
    [`Plan: loses 24/7 (${lost.length})`, lost],
  ] as const) {
    say(`### ${title}`);
    say();
    say("| Ticker | Badge here | Measured | Plan counted |");
    say("|---|---|---|---|");
    for (const t of list) say(row(t));
    say();
  }
  const extra = ev.badge.filter((t) => !plan.has(t));
  say(`### Badge here, not in the plan's 48 (${extra.length})`);
  say();
  if (extra.length) {
    say("| Ticker | Measured | Plan counted |");
    say("|---|---|---|");
    for (const t of extra) say(`| ${t} | ${reason(ev, t)} | ${leadWords(t)} |`);
  } else say("None.");
  say();
  const missing = lead.A2T3.filter((t) => !mine.has(t));
  say(`### In the plan's 48, no badge here (${missing.length})`);
  say();
  if (missing.length) {
    say("| Ticker | Measured | Plan counted |");
    say("|---|---|---|");
    for (const t of missing) say(`| ${t} | ${reason(ev, t)} | ${leadWords(t)} |`);
  } else say("None.");
  say();
  const a3missing = lead.A3.filter((t) => !mine.has(t));
  const a3fewer = lead.A3.filter((t) => mine.has(t) && three(t) < 3);
  say(`### The plan's 36 three-anchor names`);
  say();
  say(`${lead.A3.length - a3missing.length} of ${lead.A3.length} are in the output; ${lead.A3.length - a3missing.length - a3fewer.length} still have 3 or more anchors at 90% here.`);
  say();
  if (a3missing.length || a3fewer.length) {
    say("| Ticker | In the output | Measured | Plan counted |");
    say("|---|---|---|---|");
    for (const t of [...a3missing, ...a3fewer]) say(`| ${t} | ${mine.has(t) ? "yes, fewer than 3 anchors" : "**no**"} | ${reason(ev, t)} | ${leadWords(t)} |`);
    say();
  }
  for (const t of ["VOO", "NFLX", "PURR", "BRK.B", "CL"]) say(`- **${t}:** ${mine.has(t) ? "badge. " : "no badge. "}${reason(ev, t)}.`);
  say();
  fs.writeFileSync(path.join(ROOT, "docs/247-roster.md"), `${lines.join("\n")}`);
}

main().catch((e) => {
  console.error(e instanceof RateLimited ? `stopped: ${e.message}. What was fetched is kept; run again later.` : e);
  process.exit(1);
});
