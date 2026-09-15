/* The roster: every tokenized stock that can fight, where its price comes from,
 * and (per cluster) the tokens it can be staked as.
 *
 * src/data/roster.json is built by scripts/build-roster.ts from live data: the
 * issuers' token lists, Pyth's feed list, and the market data source. Each
 * stock has one feed id, the same on every cluster and for every issuer: the
 * Pyth feed id where Pyth lists the stock, or a derived one where it does not.
 *
 * `source` says who prices it on this deployment. "pyth": Pyth updates, checked
 * on chain, trusting nobody. "signed": the oracle's quotes, from the stock's
 * one-minute bars (lib/oracle.ts). The registry on chain records the same
 * choice; setup reads it from here.
 *
 * Tokens are per cluster. On devnet and localnet they are test mints the setup
 * script creates, one per stock; on mainnet they are the issuers' tokenized
 * shares, sometimes several issuers for one stock.
 */

import { PublicKey } from "@solana/web3.js";

import perpsJson from "@/data/perps.json";
import poolsJson from "@/data/pools.json";
import rosterJson from "@/data/roster.json";
import { SOURCE_PYTH, START_DELAY_SECS, type DuelView, type StakeAsset } from "@/lib/duel";
import {
  abroadOpeningAfter,
  abroadOpeningsBetween,
  isBell,
  nyParts,
  openingAfter,
  openingsBetween,
  PYTH_EDGE_SECS,
  pythGapNear,
  pythPricesAt,
  pythReopeningsBetween,
  session,
} from "@/lib/market";
import {
  COMPOSITE_FROM,
  compositePublishTime,
  FALLBACK_MARGIN_SECS,
  fallbackOutlivesHistory,
  historySecs,
  MIN_OFFHOURS_ROUND_SECS,
  V2_WINDOW_MINUTES,
} from "@/lib/composite";
import { exchangeBarFinal, firstBarEnd, sourceAt } from "@/lib/oracle";
import { inputsAt, listed247 } from "@/lib/venues247";

export type Stock = {
  ticker: string;
  name: string;
  kind: "stock" | "etf";
  market: string;
  currency: string;
  /** Feed id, hex, no 0x. */
  feed: string;
  /** True when `feed` is a real Pyth feed id. */
  pyth: boolean;
  source: "pyth" | "signed";
  /** The stock's symbol at the market data source. */
  quote: string;
  /** Accent for the ticker badge. */
  color: string;
  /** Who tokenizes it on Solana mainnet. */
  issuers: string[];
};

export type Token = {
  ticker: string;
  symbol: string;
  issuer: string;
  mint: string;
  decimals: number;
  tokenProgram: string;
};

/* Test clusters list their mints compactly, since every test token is the
 * setup script's: 8 decimals, Token-2022. */
const TEST_TOKEN = { issuer: "test", decimals: 8, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" };

export const ROSTER = rosterJson as Stock[];

/* The Solana pool that prices each stock when its exchange is shut, pinned so
 * that anyone can read the same number we did. Stocks missing from it have no
 * pool deep enough to be worth reading, and keep exchange hours. */
const POOLS = poolsJson as Record<string, { pool: string; liquidityUsd: number; volume24hUsd: number; at: string }>;

/* The perpetual market that prices each stock when its exchange is shut. It
 * prints every minute, including weekends, which a pool does not, so it is
 * preferred over one. Every entry was checked to be the same company as the
 * stock it prices; see scripts/build-perps.ts. */
const PERPS = perpsJson as Record<
  string,
  { coin: string; notional24h: number; minutesPerHour: number; markVsMarket: number; at: string }
>;

export const CLUSTER = (process.env.NEXT_PUBLIC_CLUSTER ?? "devnet") as "devnet" | "localnet" | "mainnet-beta";

/* Only this cluster's token list goes into the bundle. NEXT_PUBLIC_CLUSTER is
 * a literal at build time, so the bundler drops the other branches, and with
 * them a thousand-odd mints nobody on this cluster can use. */
/* eslint-disable @typescript-eslint/no-require-imports */
const deployment: { tokens?: (Pick<Token, "ticker" | "symbol" | "mint"> & Partial<Token>)[] } =
  process.env.NEXT_PUBLIC_CLUSTER === "mainnet-beta"
    ? require("@/data/stocks.mainnet-beta.json")
    : process.env.NEXT_PUBLIC_CLUSTER === "localnet"
      ? require("@/data/stocks.localnet.json")
      : require("@/data/stocks.devnet.json");
/* eslint-enable @typescript-eslint/no-require-imports */

/** Every token that can be staked on this cluster. */
export const TOKENS: Token[] = (deployment.tokens ?? []).map((t) => ({ ...TEST_TOKEN, ...t }));

const tokensByTicker = new Map<string, Token[]>();
for (const t of TOKENS) tokensByTicker.set(t.ticker, [...(tokensByTicker.get(t.ticker) ?? []), t]);
const tokenByMint = new Map(TOKENS.map((t) => [t.mint, t]));

/** Stocks with at least one stakeable token here, in roster order. */
export const STAKEABLE = ROSTER.filter((s) => tokensByTicker.has(s.ticker));

/* Tokenized shares carry 8 decimals across the board (xStocks, and the test
 * mints). Anything that shows an amount for a specific mint should still ask
 * decimalsForMint. */
export const STAKE_DECIMALS = TOKENS[0]?.decimals ?? 8;

export const byTicker = (ticker: string) => ROSTER.find((s) => s.ticker === ticker);
export const byFeed = (feed: string) =>
  ROSTER.find((s) => s.feed === feed.replace(/^0x/, "").toLowerCase());

/* WHERE A STOCK'S PRICE COMES FROM, BY FEED ID.
 *
 * Its symbol at the market data source and the currency that source quotes it
 * in, plus what prices it while its exchange is shut: the perpetual market and
 * the Solana pool it was pinned to (scripts/build-perps.ts, build-pools.ts),
 * and, from COMPOSITE_FROM, its ticker in venues247.json when the composite
 * prices it (lib/composite.ts). Only a US stock quoted in dollars is ever
 * given the composite. The ticker is given for a stock pinned at any time;
 * which boundaries its pins cover (their from and until) is decided per
 * boundary by oracle.ts sourceAt. A stock with none of these keeps exchange
 * hours. */
export function quoteSymbolFor(feed: string) {
  const s = byFeed(feed);
  if (!s) return undefined;
  return {
    symbol: s.quote,
    currency: s.currency,
    market: s.market,
    pool: POOLS[s.ticker]?.pool,
    perp: PERPS[s.ticker]?.coin,
    composite: s.market === "US" && s.currency === "USD" && listed247(s.ticker) ? s.ticker : undefined,
  };
}

/** Whether the composite prices `ticker` at `boundary` when its exchange is
 *  shut: with markets pinned in venues247.json at that boundary (a pin's
 *  `until` counts, as it does for the oracle), and at or after the cutover. */
const compositeFrom = (s: Stock, boundary: number) =>
  s.market === "US" && s.currency === "USD" && boundary >= COMPOSITE_FROM && inputsAt(s.ticker, boundary).length > 0;

/* WHAT PRICES A SHUT US STOCK, IF ANYTHING.
 *
 * From COMPOSITE_FROM the composite, for a stock pinned in venues247.json, and
 * nothing for any other: a perp or pool pinned before the cutover (GLD, GME,
 * KO, MCD, MRNA, STRC among them) no longer prices a boundary after it, and
 * such a stock waits for its exchange like every stock with neither
 * (oracle.ts, sourceAt). Before the cutover, the perp or pool as they always
 * did. The rule is per boundary, as the oracle's is: a fight taken before the
 * cutover whose end falls after it ends on the new rule, so the release picks
 * a cutover no open fight crosses (scripts/cutover-check.ts). */
const shutPricedFrom = (s: Stock, boundary: number) =>
  compositeFrom(s, boundary) || (boundary < COMPOSITE_FROM && (!!PERPS[s.ticker] || !!POOLS[s.ticker]));

/* WHO PRICES A SIDE: THE ROSTER FOR A NEW FIGHT, THE DUEL FOR AN OLD ONE.
 *
 * A duel records each side's source when it is created, from the registry
 * (programs/duel, create_duel), and keeps it: an admin set_asset later changes
 * new fights only. So a challenge made on Pyth stays a Pyth fight after TSLA
 * moves to the oracle, and judging its take by the roster would call a Pyth
 * side signed. Every function here takes an optional source for that; a round
 * carrying a duel's creatorSource and opponentSource (a DuelView fits) hands
 * them to mixedHoursAt and nextFairTake, and only a create asks the roster. */
export type SideSource = Stock["source"];

/** A source recorded on chain (SOURCE_PYTH or SOURCE_SIGNED), as the roster writes it. */
export const sourceFromChain = (n: number): SideSource => (n === SOURCE_PYTH ? "pyth" : "signed");

const sourceOf = (s: Stock, source?: SideSource): SideSource => source ?? s.source;

/* WHICH STOCKS FIGHT AROUND THE CLOCK, AT A MOMENT.
 *
 * A stock whose shut exchange still leaves it a price, by the rules for a
 * boundary at `at`: from COMPOSITE_FROM, a stock pinned in venues247.json (45
 * with three fresh anchors, docs/247-hardening.md section 8), and before it a
 * stock with a perp or a pool, as it always was. A Pyth-priced stock is never
 * one: Pyth's equity feeds go dark from Friday 8 PM to Sunday 8 PM New York and
 * on holidays (market.ts, pythSpanAt), however busy its weekend markets are.
 *
 * It is the badge's answer, so it asks the roster's source, which is the
 * source a new fight records. A fight that exists is judged by its own
 * (pricedAt and mixedHoursAt take them).
 *
 * WHEN A PAGE HAS NO CLOCK YET. A server render, the first render in the
 * browser (useNow starts at 0) and the static pages ask about COMPOSITE_FROM
 * itself. The release sets it to the moment it deploys, so that is the set
 * every visitor from then on sees, and a server render and the render that
 * hydrates it always agree. A page with a clock passes it and, before the
 * cutover, sees the perps and pools. */
export const tradesAroundTheClock = (ticker: string, at?: number) => {
  const s = byTicker(ticker);
  return !!s && s.source !== "pyth" && shutPricedFrom(s, at || COMPOSITE_FROM);
};

/* HOW A 24/7 STOCK IS PRICED WHILE ITS EXCHANGE IS SHUT, IN WORDS.
 *
 * "the median of up to 9 markets that trade it around the clock" from the
 * cutover: the markets pinned for it in venues247.json at that moment, of which
 * the composite counts those that traded in the 15 minutes before its window
 * (composite.ts, compositeV2At), so "up to". Before the cutover, its perpetual
 * future or its Solana pool. Null for a stock that waits. */
export function offHoursWords(ticker: string, at?: number): string | null {
  if (!tradesAroundTheClock(ticker, at)) return null;
  const when = at || COMPOSITE_FROM;
  if (when >= COMPOSITE_FROM) return `the median of up to ${compositeMarkets(ticker, when)} markets that trade it around the clock`;
  return PERPS[ticker] ? "its perpetual future" : "its Solana pool";
}

/** How many markets are pinned for `ticker` at `at` (the cutover without one). */
export const compositeMarkets = (ticker: string, at?: number) => inputsAt(ticker, Math.max(at || 0, COMPOSITE_FROM)).length;

/* WHEN A SIDE'S PRICE AT `boundary` CAN BEGIN TO EXIST.
 *
 * Every side of a fight is priced at its own first price at or after a
 * boundary, and this is the moment that price can first appear: the boundary
 * itself when something prices the stock then, or else the opening it waits
 * for. It is the one answer the pages build on, and it is the price clock's
 * answer (priceClock.ts), from the same market.ts functions, so a page cannot
 * let a fight be taken on hours the crank does not price it on. A test holds
 * the two together, second for second, across a holiday, an early close and a
 * daylight saving change (tests-web/stocks.test.ts).
 *
 *   Pyth, US          the boundary while Pyth prints, Sunday 8 PM to Friday
 *                     8 PM New York (pythPricesAt); otherwise null, because a
 *                     Pyth side never waits for an opening: a boundary in its
 *                     dark hours can never be priced at all.
 *   signed, perp/pool the boundary, before COMPOSITE_FROM: the exchange's bars
 *                     from 4am to 8pm, and the perp or pool whenever the
 *                     exchange is shut.
 *   signed, composite the boundary, from COMPOSITE_FROM, for a stock pinned in
 *                     venues247.json: the composite whenever the exchange is
 *                     shut (oracle.ts sourceAt).
 *   signed, neither   the exchange's bars, 4am to 8pm; shut, it waits for the
 *                     next 4am, as oracle.ts's exchangeBarFinal does. From
 *                     COMPOSITE_FROM that includes a stock with only a perp
 *                     or a pool.
 *   outside the US    its own exchange's bars: the boundary in a Hong Kong or
 *                     London session, and otherwise the start of the next one
 *                     (market.ts, abroadOpeningAfter), so a Hong Kong side
 *                     taken while HKEX is shut waits for HKEX; the boundary
 *                     for a market whose sessions are not modelled.
 *
 * `source` is the side's recorded source for a fight that exists; without it,
 * the roster's.
 *
 * ONE THING IT CANNOT KNOW. A pool whose hour before the boundary holds fewer
 * than OFFHOURS_MIN_BARS trades has no price worth signing, and the oracle
 * falls back to the exchange (oracle.ts quoteAt), so a pool-only stock with a
 * thin Saturday hour waits for Monday's 4am bar after all. The composite does
 * the same when too few of its markets traded (composite.ts, step 8b). That
 * depends on trades nobody has seen until the minute has passed, so neither
 * this nor the price clock models it: both call such a stock priced at the
 * boundary.
 *
 * Unix seconds, never before the boundary. Null for a ticker off the roster,
 * for a Pyth boundary that can never be priced, or if nothing opens within
 * ten days. */
export function firstPriceAt(ticker: string, boundary: number, source?: SideSource): number | null {
  const s = byTicker(ticker);
  if (!s) return null;
  if (s.market !== "US") return sourceOf(s, source) === "pyth" ? boundary : abroadOpeningAfter(s.market, boundary);
  if (sourceOf(s, source) === "pyth") return pythPricesAt(boundary) ? boundary : null;
  if (shutPricedFrom(s, boundary)) return boundary;
  return openingAfter(boundary, "extended");
}

/* WHERE A FIGHT ENDING AT `boundary` WOULD GET ITS PRICE.
 *
 * "waits" is the one worth saying out loud: the stock is real, the fight is
 * legal, and nothing will settle it until its market opens again. Somebody
 * picking NFLX at midnight should be told that before they stake, not after.
 *
 * It is firstPriceAt's answer in words. A Pyth stock is "pyth" while Pyth
 * prints, pre-market, after-hours and weekday nights included, and "never" in
 * Pyth's dark hours: it does not wait for anything. A listing in Hong Kong or
 * London is "exchange" in its session and "waits" outside it. */
export function pricedAt(
  ticker: string,
  boundary: number,
  source?: SideSource,
): "exchange" | "pyth" | "perp" | "pool" | "composite" | "waits" | "never" {
  const s = byTicker(ticker);
  if (s && s.market === "US" && sourceOf(s, source) === "pyth") return pythPricesAt(boundary) ? "pyth" : "never";
  if (!s || firstPriceAt(ticker, boundary, source) !== boundary) return "waits";
  if (s.market !== "US" || session(boundary * 1_000) !== "closed") return "exchange";
  if (compositeFrom(s, boundary)) return "composite";
  return PERPS[ticker] ? "perp" : "pool";
}

/* THE TIME A SIDE'S PRICE AT `boundary` WOULD CARRY.
 *
 * firstPriceAt says when a price can begin to exist. This says the
 * publish_time the program would record with it, which is what decides a
 * fight: start_ts is the later side's start publish_time, and a timed round
 * ends its duration after that (programs/duel/src/lib.rs, start_duel). The two
 * differ by the minute bar. A Pyth print carries its own moment, a pool's
 * trimmed mean carries the boundary, and a bar's close carries the end of the
 * bar, up to a minute after the boundary or the opening it waited for.
 *
 *   Pyth, US          firstPriceAt: the boundary while Pyth prints, else null
 *   signed, US        oracle.ts's sourceAt for the boundary: a pool at the
 *                     boundary; otherwise the end of the first bar after
 *                     firstPriceAt, the exchange's, or the perp's when shut
 *   outside the US    a Pyth print at the boundary, a signed bar's end after it
 *
 * Nominal, like the price clock: a minute nobody traded moves a bar-priced
 * side to the next bar, and a thin pool falls back to the exchange (see
 * firstPriceAt). A test holds this to priceClock's readyAt second for second,
 * less PYTH_GRACE_SECS or BAR_SETTLE_SECS. Null as for firstPriceAt. */
export function priceTimeAt(ticker: string, boundary: number, source?: SideSource): number | null {
  const s = byTicker(ticker);
  if (!s) return null;
  if (s.market !== "US") {
    if (sourceOf(s, source) === "pyth") return boundary;
    const opening = firstPriceAt(ticker, boundary, "signed");
    return opening === null ? null : firstBarEnd(opening);
  }
  if (sourceOf(s, source) === "pyth") return firstPriceAt(ticker, boundary, "pyth");
  const composite = compositeFrom(s, boundary) ? ticker : undefined;
  const from = sourceAt(boundary, { market: s.market, pool: POOLS[ticker]?.pool, perp: PERPS[ticker]?.coin, composite });
  if (from === "pool") return boundary;
  if (from === "composite") return compositePublishTime(boundary);
  const first = firstPriceAt(ticker, boundary, "signed");
  return first === null ? null : firstBarEnd(first);
}

/* HOW FAR APART TWO SIDES' PRICES MAY BE.
 *
 * A Pyth side's price carries the boundary and a bar-priced side's the end of
 * the minute the boundary falls in, up to a minute later. Fights have always
 * started and ended that far apart, and nobody's round is decided by it. So
 * two sides whose price times (priceTimeAt) are within a minute of each other
 * count as together. It compares the times the program records, not the
 * boundaries: a pool's price at 3:59:02am and a 4:01:00 bar are two minutes
 * apart, though their boundaries are under one. Beyond a minute the gap is the
 * fight. */
export const SAME_PRICE_SECS = 60;

/* HOW LATE A TAKE CAN LAND AFTER IT WAS CHECKED.
 *
 * The program prices a fight from accepted_ts, the moment the accept lands,
 * not the moment a page looked. A signed transaction carries a recent
 * blockhash and Solana drops it once that blockhash is 150 blocks old: about a
 * minute at 400ms a block, and ninety seconds allows for slow blocks. The
 * fight page checks at the click and fetches its blockhash after, and the
 * Action route checks again after fetching the one it hands out. So a take
 * checked at `now` lands between now and now + TAKE_SLACK_SECS, and it has to
 * be fair wherever in that window it lands. */
export const TAKE_SLACK_SECS = 90;

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "4:30 PM ET", for New York wall-clock parts. */
const clockWords = (p: { hh: number; mm: number }) =>
  `${p.hh % 12 || 12}:${String(p.mm).padStart(2, "0")} ${p.hh < 12 ? "AM" : "PM"} ET`;

/** "Monday 4:30 PM ET", or "Monday 4:30 PM" without the zone. */
function nyWords(unix: number, zone = true): string {
  const p = nyParts(unix * 1_000);
  const words = `${WEEKDAY_NAMES[p.wd]} ${clockWords(p)}`;
  return zone ? words : words.slice(0, -" ET".length);
}

/** "Monday's 9:30 AM ET opening bell", "Monday's 4:00 AM ET pre-market open". */
export function openingWords(unix: number): string {
  const p = nyParts(unix * 1_000);
  const what = p.hh === 9 && p.mm === 30 ? " opening bell" : p.hh === 4 && p.mm === 0 ? " pre-market open" : "";
  return `${WEEKDAY_NAMES[p.wd]}'s ${clockWords(p)}${what}`;
}

/** "days", "hours" or "minutes": how far apart two prices would land, said plainly. */
const apart = (secs: number) => (secs >= 86_400 ? "days" : secs >= 3_600 ? "hours" : "minutes");

/** A fight's end rule as the program holds it (DuelView fits): a duration
 *  counted from the later start price, or a fixed end; and, for a challenge
 *  already made, when it stops being takeable. */
export type EndRule = {
  durationSecs: number;
  endTs: number;
  expiresTs?: number;
  /** For a duel that exists, each side's recorded source, SOURCE_PYTH or
   *  SOURCE_SIGNED; without them, each side is judged by the roster. */
  creatorSource?: number;
  opponentSource?: number;
};

/** Each side's source, by ticker: the duel's where it recorded them (`a` is the
 *  creator's stock and `b` the opponent's), otherwise the roster's. */
type Sources = (ticker: string) => SideSource | undefined;

function sourcesOf(a: string, b: string, round?: EndRule): Sources {
  const ca = round?.creatorSource;
  const ob = round?.opponentSource;
  return (t) => (t === a && ca !== undefined ? sourceFromChain(ca) : t === b && ob !== undefined ? sourceFromChain(ob) : undefined);
}

/** Where a fight's two sides would part: which of its prices, the boundary
 *  they are taken after, the side whose price comes first and the side whose
 *  price comes later, when each can first exist, and how far apart the two
 *  prices would be stamped. */
export type Apart = {
  at: "start" | "end";
  boundary: number;
  early: string;
  late: string;
  earlyFrom: number;
  lateFrom: number;
  secs: number;
};

/** Undefined when either side's hours are unknown. */
function apartAtBoundary(a: string, b: string, boundary: number, at: Apart["at"], src: Sources): Apart | null | undefined {
  const pa = priceTimeAt(a, boundary, src(a));
  const pb = priceTimeAt(b, boundary, src(b));
  const fa = firstPriceAt(a, boundary, src(a));
  const fb = firstPriceAt(b, boundary, src(b));
  if (pa === null || pb === null || fa === null || fb === null) return undefined;
  if (Math.abs(pa - pb) <= SAME_PRICE_SECS) return null;
  return pa < pb
    ? { at, boundary, early: a, late: b, earlyFrom: fa, lateFrom: fb, secs: pb - pa }
    : { at, boundary, early: b, late: a, earlyFrom: fb, lateFrom: fa, secs: pa - pb };
}

/* WHERE A FIGHT TAKEN AT `acceptedTs` WOULD PART, IF ANYWHERE.
 *
 * The program's own sums, with priceTimeAt for each side's price: the start
 * boundary is acceptedTs + START_DELAY_SECS, start_ts is the later side's price
 * time there, and a timed round ends durationSecs after start_ts while a fixed
 * one ends at endTs (programs/duel/src/lib.rs, start_duel). The start is
 * checked first, then the end. Null when both prices land within
 * SAME_PRICE_SECS at both, and for a ticker off the roster, whose hours
 * nothing here knows. A round carrying a duel's sources is judged by them. */
export function apartIfTakenAt(a: string, b: string, acceptedTs: number, round?: EndRule): Apart | null {
  const src = sourcesOf(a, b, round);
  const start = acceptedTs + START_DELAY_SECS;
  const began = apartAtBoundary(a, b, start, "start", src);
  if (began === undefined) return null;
  if (began || !round) return began;
  const startTs = Math.max(priceTimeAt(a, start, src(a))!, priceTimeAt(b, start, src(b))!);
  const end = round.durationSecs > 0 ? startTs + round.durationSecs : round.endTs;
  return end > 0 ? (apartAtBoundary(a, b, end, "end", src) ?? null) : null;
}

/** Where a take checked at `now` could part, wherever in the next
 *  TAKE_SLACK_SECS it lands. Two checks cover it: the hours that part a pair
 *  are hours long, and a later accept only ever moves both boundaries later,
 *  so a window fair at both ends is fair throughout (a test walks it second by
 *  second). */
function apartWithin(a: string, b: string, now: number, round?: EndRule): Apart | null {
  return apartIfTakenAt(a, b, now, round) ?? apartIfTakenAt(a, b, now + TAKE_SLACK_SECS, round);
}

/** When the later side of a start that parts still prices at `now` itself,
 *  the close a take sent now could land after: the first whole minute of the
 *  take window at which it no longer prices. Null otherwise. */
function closeAhead(p: Apart, now: number, src: Sources): number | null {
  if (p.at !== "start" || firstPriceAt(p.late, now, src(p.late)) !== now) return null;
  const last = now + TAKE_SLACK_SECS + START_DELAY_SECS;
  for (let m = Math.ceil((now + START_DELAY_SECS) / 60) * 60; m <= last; m += 60) {
    if (firstPriceAt(p.late, m, src(p.late)) !== m) return m;
  }
  return null;
}

/* WHY TWO SIDES WOULD PART, IN WORDS.
 *
 * From the side of whoever is reading, and true for each kind of stock. A Pyth
 * side is never the one that waits: its price carries its boundary whenever it
 * can exist at all, and where it cannot, darkWords says so instead.
 *
 *   A listing in Hong Kong or London trades now only inside its own session
 *   and waits for the next one outside it, so the words for it are the words
 *   for any stock. (They used to hedge, when its hours were not modelled.)
 *
 *   A take sent while the later side still prices, which could land after its
 *   close, says so with the close (`stops`), rather than claiming a side that
 *   still trades has stopped.
 *
 *   Two sides that both price at the boundary can still be stamped minutes
 *   apart: a composite side's price is the median of the W minutes from it,
 *   stamped at their end (composite.ts), and a Pyth print or an exchange bar
 *   is stamped within the minute. That is the only way both price and still
 *   part, so the words name the window. */
function apartWords(p: Apart, stops: number | null, round?: EndRule): string {
  const gap = apart(p.secs);
  const earlyPrices = p.earlyFrom === p.boundary;
  const lateFrom = openingWords(p.lateFrom);
  const window = `the median of its 24/7 markets over the ${V2_WINDOW_MINUTES} minutes from`;

  if (earlyPrices && p.lateFrom === p.boundary && stops === null) {
    if (p.at === "end") {
      const when = `${round && round.durationSecs > 0 ? "around" : "at"} ${nyWords(p.boundary)}`;
      return `This round would end ${when}, when ${p.late} is priced by ${window} the end and ${p.early} at once, so their end prices would be ${gap} apart.`;
    }
    return `${p.late} is priced by ${window} the start and ${p.early} at once, so their start prices would be ${gap} apart.`;
  }

  if (p.at === "end") {
    const when = `${round && round.durationSecs > 0 ? "around" : "at"} ${nyWords(p.boundary)}`;
    const middle = !earlyPrices
      ? `when neither trades, and ${p.early} would take its end price at ${openingWords(p.earlyFrom)} but ${p.late} not until ${lateFrom}`
      : `when ${p.early} still trades but ${p.late} waits for ${lateFrom}`;
    return `This round would end ${when}, ${middle}, so their end prices would be ${gap} apart.`;
  }

  const tail = `so their start prices would be ${gap} apart.`;
  if (stops !== null) {
    const then = !earlyPrices ? `${p.early} would then start at ${openingWords(p.earlyFrom)}` : `${p.early} would then start at once`;
    return (
      `${p.late} stops pricing at ${clockWords(nyParts(stops * 1_000))}, and a take now could land after that. ` +
      `${then} but ${p.late} not until ${lateFrom}, ${tail}`
    );
  }
  if (!earlyPrices) return `${p.early} would start at ${openingWords(p.earlyFrom)} but ${p.late} not until ${lateFrom}, ${tail}`;
  return `${p.late} waits for its exchange to open but ${p.early} trades now, ${tail}`;
}

/* WHERE A PYTH SIDE WOULD LAND IN THE DARK.
 *
 * A Pyth stock's price at a boundary exists only while Pyth prints, Sunday
 * 8 PM to Friday 8 PM New York with holidays out (market.ts, pythSpanAt). A
 * start or an end that lands in one of its gaps, or within PYTH_EDGE_SECS of
 * either end of one, may never be priced, and the fight would sit a week for
 * the stall refund. Unlike two sides that part, this is not about the pair:
 * two Pyth stocks in the same gap are no better off than one, which is how
 * TSLA v QQQ used to be allowed on a Saturday.
 *
 * Checked where apartIfTakenAt checks: the start boundary, and the end the
 * program would compute from the later side's start price. */
type Dark = { at: "start" | "end"; boundary: number; tickers: string[]; from: number; until: number };

const byPyth = (ticker: string, src: Sources) => {
  const s = byTicker(ticker);
  return !!s && s.market === "US" && sourceOf(s, src(ticker)) === "pyth";
};

function darkAtBoundary(a: string, b: string, boundary: number, at: Dark["at"], src: Sources): Dark | null {
  const tickers = [...new Set([a, b])].filter((t) => byPyth(t, src));
  const gap = tickers.length ? pythGapNear(boundary) : null;
  return gap ? { at, boundary, tickers, ...gap } : null;
}

function darkIfTakenAt(a: string, b: string, acceptedTs: number, round?: EndRule): Dark | null {
  const src = sourcesOf(a, b, round);
  const start = acceptedTs + START_DELAY_SECS;
  const began = darkAtBoundary(a, b, start, "start", src);
  if (began || !round) return began;
  const pa = priceTimeAt(a, start, src(a));
  const pb = priceTimeAt(b, start, src(b));
  if (pa === null || pb === null) return null;
  const end = round.durationSecs > 0 ? Math.max(pa, pb) + round.durationSecs : round.endTs;
  return end > 0 ? darkAtBoundary(a, b, end, "end", src) : null;
}

/** The same, wherever in the next TAKE_SLACK_SECS a take sent at `now` lands.
 *  Both ends are enough, as for apartWithin: a gap with its margins is hours
 *  long, and a later accept only moves both boundaries later. */
function darkWithin(a: string, b: string, now: number, round?: EndRule): Dark | null {
  return darkIfTakenAt(a, b, now, round) ?? darkIfTakenAt(a, b, now + TAKE_SLACK_SECS, round);
}

/** "Pyth does not publish TSLA from Friday 8:00 PM to Sunday 8:00 PM ET, ...". */
function darkWords(d: Dark, round?: EndRule): string {
  const names = d.tickers.join(" or ");
  const hours = `Pyth does not publish ${names} from ${nyWords(d.from, false)} to ${nyWords(d.until)}`;
  if (d.at === "start") return `${hours}, and a fight whose start lands then, or within a minute of it, can never be priced.`;
  const when = `${round && round.durationSecs > 0 ? "around" : "at"} ${nyWords(d.boundary)}`;
  return `This round would end ${when}, but ${hours}, and an end that lands then, or within a minute of it, can never be priced.`;
}

/* A ROUND TOO SHORT FOR A 24/7 PRICE TO DECIDE.
 *
 * The composite's markets sit so close together once de-biased that one venue
 * can move a price by a fraction of a basis point, but a weekend's median
 * 15-minute move is about that size too. Measured on last weekend's minutes
 * (docs/247-hardening.md), one venue pushing through the window could change
 * up to 35.5% of 15-minute rounds for some stock, and no more than 2.6% of
 * 12-hour rounds for any. So a round whose start or end the composite prices
 * for either side must run MIN_OFFHOURS_ROUND_SECS, counted as the program
 * counts it: from the later start price to the end.
 *
 * A bell round is exempt, as the plan decided: its end rings in session, where
 * the exchange prices both sides, so a push can only reach its start, and from
 * any composite start the next bell is at least nine hours on, where the start
 * alone changed no more than 4.3% of 4-hour rounds. A fixed end at any other
 * moment is not a bell and gets the minimum.
 *
 * Checked where apartIfTakenAt checks, and across the take window the same way:
 * the hours the composite prices are hours long, and a later accept only moves
 * both boundaries later.
 *
 * IT IS ALSO THE EDGE RULE. The plan refused a round under EDGE_ROUND_SECS
 * whose start and end fall either side of an edge between the exchange and the
 * composite (8 PM or 4 AM New York, an early close, a holiday), because the two
 * sat a median 5.4 bps apart at Friday's close and 13.8 bps at Monday's open
 * (docs/247-pricing.md, section 3), about a weekend's 15-minute move. Such a
 * round has one end the composite prices, so this minimum, three times as
 * long, refuses every one of them, with the sentence below; and a bell round
 * that starts on the composite runs at least nine hours. A test walks each kind
 * of edge to hold that (tests-web/stocks.test.ts). */
export const EDGE_ROUND_SECS = 4 * 3_600;

type Short = { at: "start" | "end"; boundary: number; tickers: string[]; secs: number };

function shortIfTakenAt(a: string, b: string, acceptedTs: number, round?: EndRule): Short | null {
  if (!round) return null;
  const src = sourcesOf(a, b, round);
  const start = acceptedTs + START_DELAY_SECS;
  const pa = priceTimeAt(a, start, src(a));
  const pb = priceTimeAt(b, start, src(b));
  if (pa === null || pb === null) return null;
  const startTs = Math.max(pa, pb);
  const end = round.durationSecs > 0 ? startTs + round.durationSecs : round.endTs;
  if (end <= 0 || end - startTs >= MIN_OFFHOURS_ROUND_SECS) return null;
  const composite = (boundary: number) => [...new Set([a, b])].filter((t) => pricedAt(t, boundary, src(t)) === "composite");
  const bell = round.durationSecs === 0 && isBell(round.endTs);
  const atStart = bell ? [] : composite(start);
  if (atStart.length) return { at: "start", boundary: start, tickers: atStart, secs: end - startTs };
  const atEnd = composite(end);
  return atEnd.length ? { at: "end", boundary: end, tickers: atEnd, secs: end - startTs } : null;
}

function shortWithin(a: string, b: string, now: number, round?: EndRule): Short | null {
  return shortIfTakenAt(a, b, now, round) ?? shortIfTakenAt(a, b, now + TAKE_SLACK_SECS, round);
}

/** Whether this round is too short for the prices it would get, taken at
 *  `now`: /new switches such round chips off. */
export const tooShortOffHours = (a: string, b: string, now: number, round: EndRule) => shortWithin(a, b, now, round) !== null;

const MIN_ROUND_WORDS = `${MIN_OFFHOURS_ROUND_SECS / 3_600} hours`;

/** "NVDA and AAPL would be priced by their 24/7 markets at the start, ...". */
function shortWords(s: Short, round?: EndRule): string {
  const names = s.tickers.join(" and ");
  const their = s.tickers.length === 1 ? "its" : "their";
  const why = `and a round priced that way must run at least ${MIN_ROUND_WORDS}, because over a shorter one a single market could tip the result.`;
  if (s.at === "start") return `${names} would be priced by ${their} 24/7 markets at the start of this round, ${why}`;
  const when = `${round && round.durationSecs > 0 ? "around" : "at"} ${nyWords(s.boundary)}`;
  return `This round would end ${when}, when ${names} would be priced by ${their} 24/7 markets, ${why}`;
}

/* A 24/7 SIDE WHOSE FALLBACK WOULD OUTLIVE ITS PROOF.
 *
 * A composite side whose markets turn out too thin at its boundary waits for
 * the exchange's first bar after it, and the oracle can only sign that bar
 * while the markets still serve the minutes that show the side fell back
 * (composite.ts, fallbackOutlivesHistory). In the first hours of a closure
 * that runs into a holiday (the evening before Christmas to the next morning,
 * the night before New Year's Day, a Friday night before a Monday holiday),
 * that bar comes more than three days later, past Hyperliquid's history, and
 * such a side could never be priced: the fight would sit a week for the stall
 * refund. Nobody can know at the take whether the markets will be thin, so a
 * round with a start or an end there is refused for any stock whose set would
 * be stranded, and can be taken again once both land from `freeFrom` on.
 *
 * Checked where shortIfTakenAt checks: the start boundary, and the end the
 * program would compute from the later side's start price. */
type Stranded = { at: "start" | "end"; boundary: number; tickers: string[]; opening: number; freeFrom: number; days: number };

function strandedAtBoundary(a: string, b: string, boundary: number, at: Stranded["at"], src: Sources): Stranded | null {
  const final = exchangeBarFinal(boundary);
  if (final === null) return null;
  const venuesOf = (t: string) => inputsAt(t, boundary).map((i) => i.venue);
  const tickers = [...new Set([a, b])].filter((t) => pricedAt(t, boundary, src(t)) === "composite" && fallbackOutlivesHistory(boundary, final, venuesOf(t)));
  if (!tickers.length) return null;
  const history = Math.min(...tickers.map((t) => historySecs(venuesOf(t))));
  const freeFrom = Math.ceil((final - history + FALLBACK_MARGIN_SECS) / 60) * 60;
  return { at, boundary, tickers, opening: openingAfter(boundary, "extended") ?? final, freeFrom, days: Math.floor(history / 86_400) };
}

function strandedIfTakenAt(a: string, b: string, acceptedTs: number, round?: EndRule): Stranded | null {
  const src = sourcesOf(a, b, round);
  const start = acceptedTs + START_DELAY_SECS;
  const began = strandedAtBoundary(a, b, start, "start", src);
  if (began || !round) return began;
  const pa = priceTimeAt(a, start, src(a));
  const pb = priceTimeAt(b, start, src(b));
  if (pa === null || pb === null) return null;
  const end = round.durationSecs > 0 ? Math.max(pa, pb) + round.durationSecs : round.endTs;
  return end > 0 ? strandedAtBoundary(a, b, end, "end", src) : null;
}

function strandedWithin(a: string, b: string, now: number, round?: EndRule): Stranded | null {
  return strandedIfTakenAt(a, b, now, round) ?? strandedIfTakenAt(a, b, now + TAKE_SLACK_SECS, round);
}

/** "TSLA would be priced by its 24/7 markets at the start of this round, ...". */
function strandedWords(s: Stranded, round?: EndRule): string {
  const names = s.tickers.join(" and ");
  const their = s.tickers.length === 1 ? "its" : "their";
  const fallback =
    `If too few of them trade then, the price waits for the exchange's first bar at ${openingWords(s.opening)}, more than ` +
    `${s.days} days later, when the markets no longer serve the minutes that prove it, so this fight could never be priced.`;
  if (s.at === "start") return `${names} would be priced by ${their} 24/7 markets at the start of this round, ${nyWords(s.boundary)}. ${fallback}`;
  const when = `${round && round.durationSecs > 0 ? "around" : "at"} ${nyWords(s.boundary)}`;
  return `This round would end ${when}, when ${names} would be priced by ${their} 24/7 markets. ${fallback}`;
}

/* THE FIRST MOMENT A FIGHT COULD BE TAKEN FAIRLY, AFTER `from`.
 *
 * Two sides that part now can only line up again when some market opens, and
 * a Pyth side in the dark can only be taken again once Pyth has printed for
 * PYTH_EDGE_SECS, so this asks at each of those moments before the challenge
 * expires (round.expiresTs, or ten days on when there is none) and returns the
 * first whose whole take window is fair. A round too short for the composite
 * is fair again once both its ends fall where the exchange prices it, which is
 * also an opening. A round stranded in a holiday closure is also tried at the
 * moment its start, or its end, first lands from the stranded stretch's end.
 * Null when none is. */
export function nextFairTake(a: string, b: string, from: number, round?: EndRule): number | null {
  const src = sourcesOf(a, b, round);
  const until = round?.expiresTs || from + 10 * 86_400;
  const moments = openingsBetween(from, until);
  if (byPyth(a, src) || byPyth(b, src)) moments.push(...pythReopeningsBetween(from, until));
  // A listing abroad lines up again when its own exchange opens.
  for (const market of new Set([a, b].map((t) => byTicker(t)?.market ?? "US"))) moments.push(...abroadOpeningsBetween(market, from, until));
  const stranded = strandedWithin(a, b, from, round);
  if (stranded) {
    for (const t of [stranded.freeFrom - START_DELAY_SECS, stranded.freeFrom - START_DELAY_SECS - (round?.durationSecs ?? 0)]) {
      if (t > from && t < until) moments.push(t);
    }
  }
  for (const t of [...new Set(moments)].sort((x, y) => x - y)) {
    if (!darkWithin(a, b, t, round) && !apartWithin(a, b, t, round) && !shortWithin(a, b, t, round) && !strandedWithin(a, b, t, round)) return t;
  }
  return null;
}

/* WHETHER TWO STOCKS CAN FIGHT FAIRLY, TAKEN AT `now`.
 *
 * First, whether either side can be priced at all: a Pyth side whose start or
 * end would land where Pyth is dark can never be (darkWithin), whatever the
 * other side does. VOO taken at 7:59:30pm on a Friday, or any time on a
 * Saturday, is refused for that alone.
 *
 * Then, each side's start is its own first price after the boundary, and so
 * is each side's end. When the program would stamp the two more than
 * SAME_PRICE_SECS apart, the fight is decided by the gap between them rather
 * than by the round. On today's roster that happens two ways, since the only
 * stocks that wait at all wait for the same 4am bar:
 *
 *   One side waits and the other trades now: NFLX, with neither perp nor
 *   pool, at 9pm on a Monday against NVDA, which has its perp. NVDA would
 *   start then and NFLX at Tuesday's 4am bar, so the night would decide it.
 *
 *   The pair starts together but the round ends where they part: NFLX
 *   against NVDA, an hour from 7:30pm on a Monday. NFLX's bars stop at 8, so
 *   the round would end on NVDA's 8:31 perp bar and on NFLX's Tuesday 4:01.
 *
 * Last, a pair that lines up but whose round the composite would price at
 * either end must run MIN_OFFHOURS_ROUND_SECS (shortWithin): AAPL v NVDA for
 * 15 minutes on a Saturday after the cutover is refused, for 12 hours it is
 * not. And such a round must not start or end where a fallback to the
 * exchange would come after the markets' history runs out (strandedWithin):
 * AAPL v NVDA for 24 hours from 6 PM on Christmas Eve is refused.
 *
 * `now` is when the take is sent, and it lands up to TAKE_SLACK_SECS later,
 * so the pair must be fair for an accept anywhere in that window: a fixed-end
 * challenge taken at 7:59:58pm starts at 8:00:00, after NFLX's last bar.
 * `round` is the fight's end rule; without it only the start is checked.
 *
 * Returns the sentence that explains the unfair case, for the page to show
 * beside the button it disables, or null when the pair can fight. The advice
 * that ends it depends on who reads it: somebody making the challenge can pick
 * other stocks or another round, and somebody taking it can only pick a time,
 * so a taker is told the next moment it can be taken. "why" is the reason
 * alone, with no advice, for a page that says what to do itself (queueAt). A
 * ticker off the roster is left alone: nothing here knows its hours. */
export function mixedHoursAt(
  a: string,
  b: string,
  now: number,
  round?: EndRule,
  reader: "creator" | "taker" | "why" = "creator",
): string | null {
  const taker = (reason: string, never = "It closes before the two line up again.") => {
    const from = nextFairTake(a, b, now, round);
    return `${reason} ${from === null ? never : `You can take it from ${openingWords(from)}.`}`;
  };

  const dark = darkWithin(a, b, now, round);
  if (dark) {
    const reason = darkWords(dark, round);
    if (reader === "why") return reason;
    if (reader === "taker") return taker(reason, "It closes before it can be taken.");
    const stocks = dark.tickers.length === 1 ? "a stock" : "stocks";
    return dark.at === "start"
      ? `${reason} Pick ${stocks} Pyth does not price, or come back from ${openingWords(dark.until + PYTH_EDGE_SECS)}.`
      : `${reason} Pick a round that ends while Pyth publishes, or ${stocks} Pyth does not price.`;
  }

  const p = apartWithin(a, b, now, round);
  if (!p) {
    const short = shortWithin(a, b, now, round);
    if (short) {
      const reason = shortWords(short, round);
      if (reader === "why") return reason;
      if (reader === "taker") return taker(reason, "It closes before it can be taken.");
      return `${reason} Pick a round of ${MIN_ROUND_WORDS} or more, or a bell.`;
    }
    const stranded = strandedWithin(a, b, now, round);
    if (!stranded) return null;
    const reason = strandedWords(stranded, round);
    if (reader === "why") return reason;
    if (reader === "taker") return taker(reason, "It closes before it can be taken.");
    return stranded.at === "start"
      ? `${reason} Come back from ${nyWords(stranded.freeFrom)}.`
      : `${reason} Pick a round that ends while the exchange trades, or from ${nyWords(stranded.freeFrom)} on.`;
  }
  const stops = closeAhead(p, now, sourcesOf(a, b, round));
  const reason = apartWords(p, stops, round);
  if (reader === "why") return reason;
  if (reader === "taker") return taker(reason);
  const stamped = stops === null && p.earlyFrom === p.boundary && p.lateFrom === p.boundary;
  const advice = stamped
    ? "Pick two priced the same way: two stocks priced around the clock, or two that are not."
    : p.at === "end"
      ? "Pick a round that ends while both trade, or two that trade the same hours."
      : stops !== null
        ? "Pick two that trade the same hours."
        : p.earlyFrom === p.boundary
          ? "Pick two that both trade now, or two that both wait."
          : "Pick two that open at the same time, or two that both trade now.";
  return `${reason} ${advice}`;
}

/* QUEUE A CHALLENGE, DO NOT REFUSE IT, WHEN IT CAN BE FAIR LATER.
 *
 * A pair that cannot start fairly now can often start fairly at the next
 * opening: NFLX v NVDA on a Saturday lines up at Monday's 4 AM, and a 15-minute
 * AAPL v NVDA round the composite would price lines up once the exchange prices
 * both ends. Such a challenge can still be made. Nobody can take it before
 * `queued`, the first moment nextFairTake finds before it expires, and a take
 * then starts it at the first prices after, as any take does. The take gate is
 * unchanged: the fight page, the Action route and the sparring wallet ask
 * mixedHoursAt at the take, and it refuses every earlier moment.
 *
 * A challenge that could never be taken fairly before it expires (VOO for a
 * round that would end in Pyth's weekend, whenever it starts) is refused, with
 * mixedHoursAt's sentence for the reader.
 *
 * `round` must carry the expiry the challenge will have (expiresTs), because
 * the queue must end before it. Null when a take now is fair. */
export type Queue = { queued: number; why: string } | { refused: string };

export function queueAt(
  a: string,
  b: string,
  now: number,
  round: EndRule,
  reader: "creator" | "taker" = "creator",
): Queue | null {
  const why = mixedHoursAt(a, b, now, round, "why");
  if (why === null) return null;
  const from = nextFairTake(a, b, now, round);
  return from !== null ? { queued: from, why } : { refused: mixedHoursAt(a, b, now, round, reader)! };
}

/** How many of the roster fight around the clock at `at`, for the pages that
 *  say so; without a moment, from the cutover (see tradesAroundTheClock). */
export const aroundTheClockAt = (at?: number) => ROSTER.filter((s) => tradesAroundTheClock(s.ticker, at)).length;

/** The count from the cutover: every stock pinned in venues247.json that the
 *  roster prices by the oracle. The static pages and the docs say this one. */
export const AROUND_THE_CLOCK = aroundTheClockAt();

export const tokensFor = (ticker: string) => tokensByTicker.get(ticker) ?? [];

/** The token a stock is staked as on this cluster (its first issuer's), or
 * null if it has none. */
export function stakeAssetFor(ticker: string): StakeAsset | null {
  const t = tokensFor(ticker)[0];
  return t ? { mint: new PublicKey(t.mint), tokenProgram: new PublicKey(t.tokenProgram) } : null;
}

export function tokenForMint(mint: PublicKey | string): Token | undefined {
  return tokenByMint.get(typeof mint === "string" ? mint : mint.toBase58());
}

export const tickerForMint = (mint: PublicKey | string) => tokenForMint(mint)?.ticker;
export const decimalsForMint = (mint: PublicKey | string) => tokenForMint(mint)?.decimals ?? STAKE_DECIMALS;

/* WHETHER A FIGHT IS BETWEEN TWO LISTED STOCKS.
 *
 * The program takes any mint, and early test fights were staked in test BTC,
 * ETH and SOL, or in mints this cluster's token list no longer names at all.
 * They stay on chain, but they are not stock fights: counted, they swamp the
 * tally with test crypto and fill the boards with "? VS ?" rows. Both sides
 * must map to a token here and that token's ticker must be on the roster. */
export function isListedDuel(d: Pick<DuelView, "creatorMint" | "opponentMint">): boolean {
  const listed = (mint: PublicKey) => {
    const ticker = tickerForMint(mint);
    return !!ticker && !!byTicker(ticker);
  };
  return listed(d.creatorMint) && listed(d.opponentMint);
}

/** "NVDAx": the symbol of the token a stock is staked as here. */
export const tokenSymbol = (ticker: string) => tokensFor(ticker)[0]?.symbol ?? `${ticker}x`;

/** How a stock is priced, in the words the page uses: by the roster for a new
 *  fight, or by the source a fight recorded when it has one. */
export const sourceLabel = (s: Pick<Stock, "source">, recorded?: SideSource) =>
  (recorded ?? s.source) === "pyth" ? "Pyth" : "Stonk Wars oracle";
