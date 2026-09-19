/* Build the roster: every tokenized stock on Solana that a fight can hold, the
 * feed id that names it, where its price comes from, and every issuer's
 * mainnet token for it.
 *
 *   npx tsx scripts/build-roster.ts
 *
 * Input: scripts/data/tokens.json, a snapshot of every issuer's Solana tokens
 * with the mint facts read on chain (see scripts/data/README.md for where each
 * list comes from). A token makes the roster only if a fight can escrow it and
 * pay it out:
 *   - it is live (has supply, is not winding down or halted);
 *   - new accounts do not start frozen (an allowlist-only token would freeze
 *     the fight's own escrow);
 *   - no transfer hook program and no transfer fee.
 * Then each stock needs a market price the oracle can read, which the market
 * data source confirms.
 *
 * Output:
 *   - src/data/roster.json: one entry per stock.
 *   - src/data/stocks.mainnet-beta.json: every stakeable issuer token.
 *
 * PYTH_TICKERS (default TSLA,QQQ,VOO: what Pyth's free plan grants) are priced
 * by Pyth, less ON_COMPOSITE; every other stock by the oracle's signed quotes.
 * A stock Pyth does not list gets a feed id of
 * sha256("Equity.<market>.<ticker>/<currency>"), which names it the same way
 * without claiming a Pyth feed exists.
 *
 * TSLA AND QQQ ARE THE ORACLE'S, THOUGH PYTH GRANTS THEM.
 *
 * Pyth's equity feeds are dark from Friday 8 PM to Sunday 8 PM New York and on
 * holidays, so a Pyth stock can never fight at a weekend. Both are pinned in
 * src/data/venues247.json with three anchors or more, so the oracle prices
 * them around the clock (docs/247-pricing.md, section 4, Option B). The
 * registry must say the same: the release runs set_asset(feed, enabled,
 * SOURCE_SIGNED) for each. A duel records its sources when it is created, so a
 * fight made on Pyth before that stays a Pyth fight (lib/stocks.ts). VOO has
 * no weekend market anywhere and stays on Pyth.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { HermesClient } from "@pythnetwork/hermes-client";

const ROOT = path.resolve(__dirname, "..");
loadEnvLocal();

const PYTH_TICKERS = new Set((process.env.PYTH_TICKERS ?? "TSLA,QQQ,VOO").split(",").map((t) => t.trim()));
/** Pyth grants these, but the composite prices them around the clock (see above). */
const ON_COMPOSITE = new Set(["TSLA", "QQQ"]);
const ISSUER_ORDER = ["xStocks", "Ondo", "Backpack", "Superstate", "Securitize", "Bullish", "Remora"];

/* LISTED, AND STILL LEFT OUT, WITH THE REASON.
 *
 * VCX, the Fundrise fund, trades on the NYSE, so it passes every test above.
 * It is also sold as a way into private companies (its holdings include
 * OpenAI, Anthropic and SpaceX), and PreStocks' bounty rules out integrating
 * any other issuer's pre-IPO exposure. A listed fund is not a pre-IPO token,
 * but a judge could fairly read it as one, and one fund out of a thousand
 * stocks is not worth that doubt. tests-web/prestocks.test.ts fails if it
 * comes back. */
const EXCLUDED: Record<string, string> = {
  VCX: "a listed fund sold as pre-IPO exposure; kept off for the PreStocks bounty",
};

/** Shown first, in this order. Everything else follows alphabetically. */
const FEATURED = [
  "TSLA", "NVDA", "AAPL", "QQQ", "SPY", "MSFT", "GOOGL", "AMZN", "META", "MSTR", "COIN",
  "HOOD", "PLTR", "GME", "SPCX", "CRCL", "AMD", "MU", "INTC", "NFLX", "GLD", "AVGO", "ORCL",
  "UBER", "BABA", "DIS", "NKE", "KO", "JPM", "V", "MA", "WMT", "COST", "LLY", "SNDK", "RDDT",
];

/** Brand accents for the names people know; the rest get one from PALETTE. */
const COLORS: Record<string, string> = {
  TSLA: "#E82127", QQQ: "#8C3FFF", VOO: "#E6E6E6", NVDA: "#76B900", AAPL: "#A2AAAD",
  MSFT: "#00A4EF", GOOGL: "#4285F4", AMZN: "#FF9900", META: "#0866FF", AMD: "#ED1C24",
  PLTR: "#C9CBCC", COIN: "#0052FF", HOOD: "#CCFF00", MSTR: "#F7931A", SPY: "#2fe0ff",
  GME: "#ff3ea5", SPCX: "#9aa7b8", CRCL: "#3D8BFF", GLD: "#D4AF37", NFLX: "#E50914",
};
const PALETTE = ["#2fe0ff", "#ff3ea5", "#35f28b", "#ff7a1a", "#8C3FFF", "#3D8BFF", "#ff4d5e", "#00c2a8", "#c77dff", "#5eead4"];

type SnapshotToken = {
  issuer: string;
  symbol: string;
  underlying: string;
  name: string;
  type: string | null;
  isin: string | null;
  listing: string | null;
  mint: string;
  decimals: number;
  tokenProgram: string;
  status: string;
  defaultAccountState: string | null;
  transferHookProgram: string | null;
  transferFeeBps: number | null;
  scaledUiMultiplier: string | null;
};

export type RosterStock = {
  ticker: string;
  name: string;
  kind: "stock" | "etf";
  market: string;
  currency: string;
  /** Hex, no 0x. Pyth's feed id when `pyth` is true. */
  feed: string;
  pyth: boolean;
  source: "pyth" | "signed";
  /** The symbol at the market data source the oracle reads. */
  quote: string;
  color: string;
  issuers: string[];
};

function loadEnvLocal() {
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; stonkwars-roster/1.0)" };

/** Why a token cannot be in a fight, or null if it can. */
function unfit(t: SnapshotToken): string | null {
  if (t.status !== "live") return t.status;
  if (t.defaultAccountState === "frozen") return "accounts start frozen (allowlist only)";
  if (t.transferHookProgram) return "transfer hook";
  if (t.transferFeeBps) return "transfer fee";
  return null;
}

/** A stock's market and its symbol at the market data source. */
function listingOf(t: SnapshotToken): { market: string; quote: string; ticker: string } | null {
  const u = t.underlying.toUpperCase();
  if (t.listing === "HK") {
    const code = u.replace(/\D/g, "");
    if (!code) return null;
    return { market: "HK", quote: `${code.padStart(4, "0")}.HK`, ticker: t.symbol.replace(/x$/, "") };
  }
  if (t.listing && t.listing !== "US") return null; // resolved by ISIN below
  if (!/^[A-Z][A-Z0-9.\-/]*$/.test(u)) return null;
  const ticker = u.replace("/", ".");
  return { market: "US", quote: ticker.replace(/[./]/g, "-"), ticker };
}

/** The source's own symbol for an ISIN, for listings outside the US and HK. */
async function symbolForIsin(isin: string): Promise<string | null> {
  const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${isin}&quotesCount=5&newsCount=0`, { headers: HEADERS });
  if (!r.ok) return null;
  const body = (await r.json()) as { quotes?: { symbol?: string; quoteType?: string }[] };
  return body.quotes?.find((q) => q.quoteType === "EQUITY" || q.quoteType === "ETF")?.symbol ?? null;
}

type Meta = { type: string; currency: string; name: string };

async function describe(symbol: string): Promise<Meta | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`, { headers: HEADERS });
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, 2_000 * (attempt + 1)));
      continue;
    }
    if (!r.ok) return null;
    const meta = ((await r.json()) as { chart?: { result?: { meta?: Record<string, unknown> }[] } }).chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    /* A PRICE IS NOT A LISTING. A delisted stock keeps its last price here
     * for good: Webster Financial (WBS) was delisted from the NYSE when
     * Santander's purchase closed on 20 August 2026, still showed $77.57 a
     * month later, and so stayed on the roster as a stock a fight could be
     * made on and never priced. What makes it a market is that it trades, so a
     * stock with no trade in ten days is left out and named. */
    const last = Number(meta.regularMarketTime ?? 0);
    if (Date.now() / 1000 - last > 10 * 86_400) {
      console.error(`  ${symbol} has not traded since ${new Date(last * 1000).toISOString().slice(0, 10)}; left out`);
      return null;
    }
    return {
      type: String(meta.instrumentType ?? ""),
      currency: String(meta.currency ?? ""),
      name: String(meta.longName ?? meta.shortName ?? ""),
    };
  }
  return null;
}

/** Run `fn` over `items`, `n` at a time. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
    }),
  );
  return out;
}

const sha256hex = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function colorFor(ticker: string) {
  if (COLORS[ticker]) return COLORS[ticker];
  return PALETTE[crypto.createHash("sha1").update(ticker).digest()[0] % PALETTE.length];
}

const cleanName = (n: string) =>
  n.replace(/\s+(Inc\.?|Corporation|Corp\.?|Holdings?|Ltd\.?|Limited|plc|N\.V\.|S\.A\.)$/i, "").replace(/,\s*$/, "").trim();

async function main() {
  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/data/tokens.json"), "utf8")) as SnapshotToken[];
  const skipped = new Map<string, number>();
  const fit = snapshot.filter((t) => {
    const why = unfit(t);
    if (why) skipped.set(`${t.issuer}: ${why}`, (skipped.get(`${t.issuer}: ${why}`) ?? 0) + 1);
    return !why;
  });
  for (const [why, n] of skipped) console.error(`  left out ${n} (${why})`);

  // Group every fit token under its stock.
  type Group = { market: string; quote: string; ticker: string; tokens: SnapshotToken[] };
  const groups = new Map<string, Group>();
  const pending: SnapshotToken[] = [];
  for (const t of fit) {
    const l = listingOf(t);
    if (!l) {
      pending.push(t);
      continue;
    }
    const key = `${l.market}:${l.quote}`;
    const g = groups.get(key) ?? { ...l, tokens: [] };
    g.tokens.push(t);
    groups.set(key, g);
  }
  for (const t of pending) {
    const quote = t.isin ? await symbolForIsin(t.isin) : null;
    if (!quote) {
      console.error(`  no market symbol for ${t.symbol} (${t.isin ?? "no ISIN"}); left out`);
      continue;
    }
    const key = `${t.listing}:${quote}`;
    const g = groups.get(key) ?? { market: t.listing ?? "?", quote, ticker: t.symbol.replace(/x$/, ""), tokens: [] };
    g.tokens.push(t);
    groups.set(key, g);
  }
  console.error(`${fit.length} fit tokens in ${groups.size} stocks; checking each with the market data source`);

  let pythIds = new Map<string, string>();
  if (process.env.PYTH_API_KEY) {
    const hermes = new HermesClient(process.env.HERMES_URL || "https://pyth.dourolabs.app/hermes", { accessToken: process.env.PYTH_API_KEY });
    const feeds = await hermes.getPriceFeeds({ assetType: "equity" });
    pythIds = new Map(
      feeds
        .map((f) => [/^Equity\.US\.([A-Z0-9.\-]+)\/USD$/.exec(String(f.attributes.symbol ?? ""))?.[1], f.id] as const)
        .filter((e): e is [string, string] => !!e[0]),
    );
    console.error(`${pythIds.size} Pyth US equity feeds`);
  } else {
    console.error("PYTH_API_KEY not set: every feed id will be derived, and nothing priced by Pyth");
  }

  const list = [...groups.values()];
  const metas = await pool(list, 6, (g) => describe(g.quote));

  const roster: RosterStock[] = [];
  const mainnet: { ticker: string; symbol: string; issuer: string; mint: string; decimals: number; tokenProgram: string }[] = [];
  const used = new Set<string>();
  list.forEach((g, i) => {
    const meta = metas[i];
    if (!meta) {
      console.error(`  no market data for ${g.ticker} (${g.quote}); left out`);
      return;
    }
    if (EXCLUDED[g.ticker]) {
      console.error(`  ${g.ticker} left out: ${EXCLUDED[g.ticker]}`);
      return;
    }
    let ticker = g.ticker;
    if (used.has(ticker)) ticker = `${ticker}.${g.market}`;
    used.add(ticker);
    const tokens = g.tokens.sort((a, b) => ISSUER_ORDER.indexOf(a.issuer) - ISSUER_ORDER.indexOf(b.issuer));
    const pythId = g.market === "US" ? pythIds.get(ticker) ?? pythIds.get(ticker.replace(".", "-")) : undefined;
    const currency = meta.currency || "USD";
    const issuerName = tokens.find((t) => t.issuer !== "Backpack")?.name ?? "";
    roster.push({
      ticker,
      name: cleanName(issuerName && !/\.US$/.test(issuerName) ? issuerName : meta.name || tokens[0].name),
      kind: meta.type === "ETF" || tokens.some((t) => t.type === "etf") ? "etf" : "stock",
      market: g.market,
      currency,
      feed: pythId?.replace(/^0x/, "") ?? sha256hex(`Equity.${g.market}.${ticker}/${currency}`),
      pyth: !!pythId,
      source: pythId && PYTH_TICKERS.has(ticker) && !ON_COMPOSITE.has(ticker) ? "pyth" : "signed",
      quote: g.quote,
      color: colorFor(ticker),
      issuers: [...new Set(tokens.map((t) => t.issuer))],
    });
    for (const t of tokens) {
      mainnet.push({ ticker, symbol: t.symbol, issuer: t.issuer, mint: t.mint, decimals: t.decimals, tokenProgram: t.tokenProgram });
    }
  });

  const rank = (t: string) => {
    const i = FEATURED.indexOf(t);
    return i === -1 ? FEATURED.length : i;
  };
  roster.sort((a, b) => rank(a.ticker) - rank(b.ticker) || a.ticker.localeCompare(b.ticker));
  const order = new Map(roster.map((s, i) => [s.ticker, i]));
  mainnet.sort((a, b) => order.get(a.ticker)! - order.get(b.ticker)! || ISSUER_ORDER.indexOf(a.issuer) - ISSUER_ORDER.indexOf(b.issuer));

  fs.writeFileSync(path.join(ROOT, "src/data/roster.json"), JSON.stringify(roster).replace(/},{/g, "},\n{") + "\n");
  fs.writeFileSync(
    path.join(ROOT, "src/data/stocks.mainnet-beta.json"),
    JSON.stringify({ tokens: mainnet }).replace(/},{/g, "},\n{") + "\n",
  );

  const byIssuer = ISSUER_ORDER.map((i) => [i, mainnet.filter((t) => t.issuer === i).length] as const).filter(([, n]) => n);
  console.error(
    `roster: ${roster.length} stocks (${roster.filter((s) => s.kind === "etf").length} ETFs, ` +
      `${roster.filter((s) => s.market !== "US").length} listed outside the US), ` +
      `${roster.filter((s) => s.source === "pyth").length} priced by Pyth, ${roster.filter((s) => s.pyth).length} with a Pyth feed id; ` +
      `${mainnet.length} mainnet tokens: ${byIssuer.map(([i, n]) => `${i} ${n}`).join(", ")}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
