/* LAST WEEKEND'S MINUTES, AT NINE VENUES, FOR TWELVE STOCKS.
 *
 * The 24/7 price rule (docs/247-pricing.md) rests on one weekend of real
 * one-minute data: Saturday 12 and Sunday 13 September 2026. Hyperliquid
 * serves only about three and a half days of minutes, so by the time anyone
 * reruns the numbers from its API the Saturday is gone. The research sweep
 * saved what it fetched on 14 September (stonkwars-research/weekend-2026-09-12,
 * outside the repo), and these files are that data trimmed to what the rule
 * reads: each minute's start, its close, and the field that says whether
 * anything traded in it.
 *
 *   window   Fri 11 Sep 23:00 UTC to Mon 14 Sep 01:00 UTC, end exclusive: the
 *            measured 48 hours with an hour either side, so a boundary at
 *            Saturday 00:00 still has its hour of history behind it
 *   rows     [t, close, traded] with t the minute's start in unix seconds and
 *            traded the venue's own count or volume, exactly as saved: trades
 *            (n) at Hyperliquid, Binance and Backpack, volume (v) elsewhere.
 *            A minute traded when that number is above zero.
 *   missing  Backpack lists no MSFT, MSTR or COIN perp, and its AMZN file came
 *            back empty, so those four are absent rather than zero. Backpack
 *            also omits quiet minutes at the start of a window, so its counts
 *            fall short of 3,000.
 *
 * Checked when they were cut: run through the lead's own simulation
 * (lead_sim.py), they give its figures exactly, 2,880 of 2,880 priced minutes
 * for eleven stocks and 2,879 for MSFT. Nine files, 7,259,173 bytes in all.
 *
 * Read with fs, not imported: a JSON import this size makes tsc type every
 * row. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "weekend-2026-09-12");

/** The nine venues, the six anchors first, as the plan orders them. */
export const WEEKEND_VENUES = [
  "xyz",
  "okx_perp",
  "bitget_perp",
  "binance_bstock",
  "lighter_perp",
  "backpack_perp",
  "gate_perp",
  "mexc_perp",
  "bingx_perp",
] as const;
export type WeekendVenue = (typeof WEEKEND_VENUES)[number];

/** The twelve stocks the research archived at minute level. */
export const WEEKEND_TICKERS = ["TSLA", "NVDA", "AAPL", "GOOGL", "AMZN", "META", "MSTR", "COIN", "HOOD", "CRCL", "MU", "MSFT"] as const;

/** The whole file's window, unix seconds, end exclusive. */
export const WEEKEND_FROM = 1_789_167_600; // Fri 11 Sep 23:00 UTC
export const WEEKEND_UNTIL = 1_789_347_600; // Mon 14 Sep 01:00 UTC
/** The 2,880 minutes the plan's figures are measured over. */
export const WEEKEND_SAT = 1_789_171_200; // Sat 12 Sep 00:00 UTC
export const WEEKEND_MON = 1_789_344_000; // Mon 14 Sep 00:00 UTC

export type Minute = { t: number; c: number; traded: boolean; amount: number };

export type WeekendFile = {
  venue: WeekendVenue;
  anchor: boolean;
  /** Which of the venue's fields `amount` is: trades or volume. */
  field: "n" | "v";
  from: number;
  until: number;
  /** Where the untrimmed file is, under stonkwars-research. */
  source: string;
  rows: Partial<Record<string, Minute[]>>;
};

const cache = new Map<WeekendVenue, WeekendFile>();

/** One venue's file, every stock in it, oldest minute first. */
export function loadWeekend(venue: WeekendVenue): WeekendFile {
  const hit = cache.get(venue);
  if (hit) return hit;
  const raw = JSON.parse(readFileSync(resolve(DIR, `${venue}.json`), "utf8")) as {
    venue: string;
    anchor: boolean;
    traded: "n" | "v";
    from: number;
    until: number;
    source: string;
    rows: Record<string, [number, number, number][]>;
  };
  if (raw.venue !== venue) throw new Error(`${venue}.json names ${raw.venue}`);
  const rows: WeekendFile["rows"] = {};
  for (const [ticker, list] of Object.entries(raw.rows)) {
    rows[ticker] = list.map(([t, c, amount]) => ({ t, c, amount, traded: amount > 0 }));
  }
  const file: WeekendFile = { venue, anchor: raw.anchor, field: raw.traded, from: raw.from, until: raw.until, source: raw.source, rows };
  cache.set(venue, file);
  return file;
}

/** One stock's minutes at one venue, or null where the venue has none. */
export function weekendMinutes(venue: WeekendVenue, ticker: string): Minute[] | null {
  return loadWeekend(venue).rows[ticker] ?? null;
}

/** The size on disk of every file, in bytes. */
export function weekendBytes(): number {
  return WEEKEND_VENUES.reduce((sum, v) => sum + readFileSync(resolve(DIR, `${v}.json`)).length, 0);
}
