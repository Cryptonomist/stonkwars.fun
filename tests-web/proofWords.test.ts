/* The receipt's reading of a 24/7 proof: every figure it prints is the proof's
 * own, a price in ticks is printed exactly, and the sentences say what priced
 * the side and what those markets are. The proof is built from last weekend's
 * real minutes (tests-web/fixtures/weekend-2026-09-12), as the composite tests
 * build it. */

import { expect } from "chai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  closeText,
  compositeV2At,
  V2_LOOKBACK_SECS,
  V2_WINDOW_SECS,
  type Candle,
  type CompositeV2Proof,
  type Reference,
  type VenueId,
  type VenueWindow,
} from "../src/lib/composite";
import { BAR_SETTLE_SECS, exchangeBarFinal } from "../src/lib/oracle";
import { proofSentences, proofTable, requestWords, sameAsChain, ticksText, whyWords } from "../src/lib/proofWords";
import { WEEKEND_VENUES, weekendMinutes, type WeekendVenue } from "./fixtures/weekend";

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

const YAHOO = JSON.parse(readFileSync(resolve(__dirname, "fixtures/weekend-2026-09-12/yahoo.json"), "utf8")) as {
  rows: Record<string, { friday: [number, number] }>;
};
const fridayClose = (ticker: string): Reference => {
  const [t, c] = YAHOO.rows[ticker].friday;
  return { t, close: closeText(c)! };
};

/** Saturday 12 Sep, 16:00 UTC: noon in New York. */
const SAT16 = 1_789_228_800;

function proofAt(ticker: string, m: number): { proof: CompositeV2Proof; price: bigint } {
  const windows: VenueWindow[] = WEEKEND_VENUES.flatMap((v) => {
    const rows = weekendMinutes(v, ticker);
    if (!rows) return [];
    const candles = rows.map((r): Candle => ({ t: r.t, close: closeText(r.c)!, traded: r.traded }));
    return [
      {
        venue: VENUE_OF[v],
        instrument: `${ticker}-fixture`,
        request: { method: "GET" as const, url: `https://example.invalid/${VENUE_OF[v]}/${ticker}/${m}` },
        rows: candles.filter((r) => r.t >= m - V2_LOOKBACK_SECS && r.t <= m + V2_WINDOW_SECS - 60),
      },
    ];
  });
  const r = compositeV2At({
    boundary: m,
    now: m + V2_WINDOW_SECS + BAR_SETTLE_SECS,
    settleSecs: BAR_SETTLE_SECS,
    windows,
    reference: fridayClose(ticker),
    exchangeFinal: exchangeBarFinal(m),
  });
  if (!("price" in r)) throw new Error(`expected a price, got ${JSON.stringify(r)}`);
  return { proof: r.proof, price: r.price };
}

describe("a 24/7 proof, read back on the receipt", () => {
  it("prints a price in ticks exactly, and knows it is the price on chain", () => {
    expect(ticksText("4123456")).to.equal("412.3456");
    expect(ticksText("5")).to.equal("0.0005");
    expect(ticksText("-120000")).to.equal("-12.0000");
    expect(ticksText(null)).to.equal(null);
    expect(ticksText("1.5")).to.equal(null);
    expect(sameAsChain("4123456", 4_123_456n, -4)).to.equal(true);
    expect(sameAsChain("4123456", 412_345_600_000n, -9)).to.equal(true);
    expect(sameAsChain("4123456", 4_123_457n, -4)).to.equal(false);
    expect(sameAsChain(null, 4_123_456n, -4)).to.equal(false);
  });

  it("draws one row per market and one column per window minute, every figure the proof's own", () => {
    const { proof, price } = proofAt("TSLA", SAT16);
    const table = proofTable(proof);
    expect(table.minutes).to.deep.equal([SAT16, SAT16 + 60, SAT16 + 120]);
    expect(table.rows.map((r) => r.venue)).to.deep.equal(proof.venues.map((v) => v.name));
    expect(table.rows.filter((r) => r.counted).length).to.equal(proof.counted);
    for (const [i, row] of table.rows.entries()) {
      const v = proof.venues[i];
      expect(row.why).to.equal(whyWords(v.why));
      for (const [k, cell] of row.cells.entries()) {
        expect(cell.close).to.equal(v.minutes[k].close);
        expect(cell.calibrated).to.equal(ticksText(v.minutes[k].calibrated));
        expect(cell.kept).to.equal(v.minutes[k].kept);
      }
    }
    expect(table.medians).to.deep.equal(proof.minutes.map((m) => ticksText(m.value)));
    expect(sameAsChain(proof.price, price, -4)).to.equal(true);
  });

  it("says what priced the side, what those markets are, and how long each row can be fetched again", () => {
    const { proof } = proofAt("TSLA", SAT16);
    const said = proofSentences(proof, "TSLA");
    expect(said[0]).to.equal(
      `Priced 24/7 by the Stonk Wars oracle: the median, over the 3 minutes from Sat 12 PM ET, of the one-minute closes of the ${proof.counted} markets ` +
        "that traded TSLA in the 15 minutes before, each first corrected by its own premium to the others over the hour before.",
    );
    expect(said[1]).to.equal(
      "These are perpetual futures and tokenized shares, not the exchange listing; a weekend price is what those markets traded, not the next open.",
    );
    expect(said[2]).to.equal(
      "Every request above is public. Hyperliquid keeps about 3 days of one-minute history and Gate about 6 days, " +
        "so those rows can be fetched again only that long; the other markets keep 25 days or more.",
    );
  });

  it("names a request somebody can make again", () => {
    expect(requestWords({ method: "GET", url: "https://www.okx.com/api/v5/market/history-candles?instId=TSLA-USDT-SWAP" })).to.deep.equal({
      href: "https://www.okx.com/api/v5/market/history-candles?instId=TSLA-USDT-SWAP",
      label: "GET www.okx.com",
      body: null,
    });
    expect(requestWords({ method: "POST", url: "https://api.hyperliquid.xyz/info", body: "{}" })).to.deep.equal({
      href: null,
      label: "POST api.hyperliquid.xyz",
      body: "{}",
    });
  });
});
