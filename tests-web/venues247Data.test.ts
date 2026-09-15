/* The deployed venue pins, held to what the roster build promised.
 *
 * src/data/venues247.json decides which stocks fight around the clock and
 * which markets price them (docs/247-pricing.md, step 3). It is written by
 * scripts/build-247.ts, which keeps the measurements behind every pin in
 * scripts/data/venues247.evidence.json. A hand edit, a partial rebuild or a
 * cutover moved without rebuilding would each break one of these:
 *
 *   schema      the oracle's own reader accepts it, and nothing else is in it
 *   roster      every stock is a US roster stock quoted in dollars
 *   the flip    TSLA and QQQ are listed, VOO is not (section 4 of the plan)
 *   quorum      every listed stock has 3 anchors pinned, at the cutover and
 *               at every boundary its set changes after it
 *   denied      no pinned id is one the reader refuses, and the reader does
 *               refuse them
 *   evidence    the pins are exactly the markets the build measured as the
 *               same stock (within 1.5% of Yahoo) and alive (fresh in at least
 *               50% of last weekend's minutes), and each listed stock has 3
 *               anchors fresh in at least 90%
 *
 * The thresholds are restated here from the plan and the hardening step
 * (docs/247-hardening.md, which raised the badge from 2 anchors to 3), not
 * imported from the script, so a change to the script's numbers shows up as a
 * failure. */

import { expect } from "chai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { COMPOSITE_FROM, COMPOSITE_RULE, VENUES, type VenueId } from "../src/lib/composite";
import { DENIED_247, inputsAt, parseVenues247, VENUES247 } from "../src/lib/venues247";

const ROOT = resolve(__dirname, "..");
const read = <T>(file: string): T => JSON.parse(readFileSync(resolve(ROOT, file), "utf8")) as T;

type Evidence = {
  rule: string;
  weekend: { from: number; until: number; minutes: number };
  badge: string[];
  tickers: Record<
    string,
    {
      badge: boolean;
      markets: {
        venue: VenueId;
        instrument: string;
        symbol: string;
        anchor: boolean;
        identity: { bps: number } | { refused: string } | null;
        weekend: { fresh: number } | object | null;
        verdict: "badge" | "input" | "refused";
      }[];
    }
  >;
};

const raw = read<{ rule: string; tickers: Record<string, unknown[]> }>("src/data/venues247.json");
const roster = read<{ ticker: string; market: string; currency: string }[]>("src/data/roster.json");
const evidence = read<Evidence>("scripts/data/venues247.evidence.json");

/* The plan's lines. 2,880 weekend minutes; 90% of them is 2,592 and 50% is
 * 1,440. Identity is a median gap of at most 1.5%, 150 bps. */
const WEEKEND_MINUTES = 2_880;
const BADGE_FRESH = 2_592;
const PIN_FRESH = 1_440;
const IDENTITY_BPS = 150;
const BADGE_ANCHORS = 3;

const tickers = Object.keys(raw.tickers);
const freshOf = (m: { weekend: unknown }) => (m.weekend as { fresh?: number } | null)?.fresh ?? -1;

describe("venues247.json, the round-the-clock roster", () => {
  it("is read by the oracle's own reader, and holds nothing else", () => {
    expect(Object.keys(raw).sort()).to.deep.equal(["rule", "tickers"]);
    expect(raw.rule).to.equal(COMPOSITE_RULE);
    expect(parseVenues247(raw)).to.deep.equal(VENUES247);
    expect(tickers).to.deep.equal([...tickers].sort());
    for (const t of tickers) expect(raw.tickers[t].length, t).to.be.greaterThan(0);
  });

  it("lists only US roster stocks quoted in dollars", () => {
    const byTicker = new Map(roster.map((s) => [s.ticker, s]));
    for (const t of tickers) {
      const s = byTicker.get(t);
      expect(s, `${t} is on the roster`).to.not.equal(undefined);
      expect([s!.market, s!.currency], t).to.deep.equal(["US", "USD"]);
    }
  });

  it("lists TSLA and QQQ, which move to the composite, and not VOO, which stays on Pyth", () => {
    expect(tickers).to.include("TSLA");
    expect(tickers).to.include("QQQ");
    expect(tickers).to.not.include("VOO");
  });

  it("gives every stock 3 anchors, at the cutover and wherever its set changes after it", () => {
    for (const t of tickers) {
      const pins = VENUES247.tickers[t];
      const moments = [COMPOSITE_FROM, ...pins.flatMap((p) => [p.from, p.until ?? p.from])].filter((b) => b >= COMPOSITE_FROM);
      for (const b of new Set(moments)) {
        const set = inputsAt(t, b);
        const venues = new Set(set.map((i) => i.venue));
        expect(venues.size, `${t} markets at ${b}`).to.equal(set.length);
        expect(set.length, `${t} markets at ${b}`).to.be.at.least(3);
        expect(set.filter((i) => VENUES[i.venue].anchor).length, `${t} anchors at ${b}`).to.be.at.least(BADGE_ANCHORS);
      }
    }
  });

  it("pins no denied market, and the reader refuses one", () => {
    for (const t of tickers) {
      for (const p of VENUES247.tickers[t]) expect(DENIED_247[p.venue], `${t} ${p.venue}`).to.not.include(p.instrument);
    }
    // Crude oil next to Colgate, and a crypto coin under a roster ticker.
    const colgate = { rule: COMPOSITE_RULE, tickers: { CL: [{ venue: "hyperliquid", instrument: "xyz:CL", from: COMPOSITE_FROM }] } };
    expect(() => parseVenues247(colgate)).to.throw(/denied/);
    const sui = { rule: COMPOSITE_RULE, tickers: { SUI: [{ venue: "lighter", instrument: "16", from: COMPOSITE_FROM }] } };
    expect(() => parseVenues247(sui)).to.throw(/denied/);
    // And by name: no pinned market is one of the symbols the plan denies.
    const everywhere = ["CL", "BZ", "SHEIN", "SKHX"];
    const lighter = ["SUI", "STX", "SNX", "W", "STRK", "AR", "MET", "LIT", "DASH", "ARB", "DG"];
    for (const t of tickers) {
      for (const m of evidence.tickers[t].markets.filter((x) => x.verdict !== "refused")) {
        expect(everywhere, `${t} ${m.venue} ${m.instrument}`).to.not.include(m.symbol);
        if (m.venue === "lighter") expect(lighter, `${t} lighter ${m.instrument}`).to.not.include(m.symbol);
      }
    }
  });

  it("pins exactly the markets the build measured as the stock and alive, and badges what cleared 90%", () => {
    expect(evidence.rule).to.equal(COMPOSITE_RULE);
    expect(evidence.weekend.minutes).to.equal(WEEKEND_MINUTES);
    expect((evidence.weekend.until - evidence.weekend.from) / 60).to.equal(WEEKEND_MINUTES);
    expect(evidence.badge).to.deep.equal(tickers);

    for (const t of tickers) {
      const e = evidence.tickers[t];
      expect(e?.badge, t).to.equal(true);
      const pinned = e.markets.filter((m) => m.verdict !== "refused");
      const open = VENUES247.tickers[t].filter((p) => p.until === undefined);
      expect(open.map((p) => `${p.venue} ${p.instrument}`).sort(), t).to.deep.equal(pinned.map((m) => `${m.venue} ${m.instrument}`).sort());

      for (const m of pinned) {
        const id = m.identity as { bps?: number } | null;
        expect(id?.bps, `${t} ${m.venue} identity`).to.be.a("number");
        expect(id!.bps!, `${t} ${m.venue} identity`).to.be.at.most(IDENTITY_BPS);
        expect(freshOf(m), `${t} ${m.venue} freshness`).to.be.at.least(PIN_FRESH);
        expect(m.verdict, `${t} ${m.venue} verdict`).to.equal(freshOf(m) >= BADGE_FRESH ? "badge" : "input");
      }
      const at90 = pinned.filter((m) => freshOf(m) >= BADGE_FRESH);
      expect(at90.length, `${t} markets at 90%`).to.be.at.least(3);
      expect(at90.filter((m) => m.anchor).length, `${t} anchors at 90%`).to.be.at.least(BADGE_ANCHORS);
      for (const m of e.markets) expect(m.anchor, `${t} ${m.venue}`).to.equal(VENUES[m.venue].anchor);
    }
  });

  it("badges no stock the evidence did not measure to the badge", () => {
    for (const [t, e] of Object.entries(evidence.tickers)) {
      if (tickers.includes(t)) continue;
      expect(e.badge, t).to.equal(false);
      // Every market measured as the stock and 90% fresh, one per venue.
      const at90 = new Set(
        e.markets.filter((m) => ((m.identity as { bps?: number } | null)?.bps ?? Infinity) <= IDENTITY_BPS && freshOf(m) >= BADGE_FRESH).map((m) => m.venue),
      );
      const clears = at90.size >= 3 && [...at90].filter((v) => VENUES[v].anchor).length >= BADGE_ANCHORS;
      expect(clears, `${t} is measured to the badge but not listed`).to.equal(false);
    }
  });
});
