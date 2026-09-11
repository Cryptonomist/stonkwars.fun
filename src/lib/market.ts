/* The market's clock, which is New York's.
 *
 * Duels end at a boundary in unix seconds and the program knows nothing about
 * sessions: the end price is simply the first Pyth price at or after it. So the
 * one thing that matters here is offering end times that land INSIDE a trading
 * session, where a price follows within a second. "The bell" is therefore
 * 3:59:30 PM ET, thirty seconds before the close, not 4:00:00: at 4:00:00 the
 * next print might be the following morning's.
 */

const NY = "America/New_York";

/** Full-day closures, NYSE, for the rest of the hackathon's year and next. */
const HOLIDAYS = new Set([
  "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

export const BELL = { hour: 15, minute: 59, second: 30 };
const OPEN = { hour: 9, minute: 30 };

type Parts = { y: number; m: number; d: number; hh: number; mm: number; ss: number; wd: number };

const dtf = new Intl.DateTimeFormat("en-US", {
  timeZone: NY,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function nyParts(ms: number): Parts {
  const p: Record<string, string> = {};
  for (const { type, value } of dtf.formatToParts(new Date(ms))) p[type] = value;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    hh: Number(p.hour) % 24,
    mm: Number(p.minute),
    ss: Number(p.second),
    wd: WEEKDAYS.indexOf(p.weekday),
  };
}

/** Unix ms for a wall-clock time in New York. DST-correct by construction. */
export function nyToMs(y: number, m: number, d: number, hh: number, mm: number, ss = 0): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const offsetAt = (ms: number) => {
    const p = nyParts(ms);
    return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - ms;
  };
  let ms = guess - offsetAt(guess);
  const second = offsetAt(ms);
  if (guess - second !== ms) ms = guess - second;
  return ms;
}

const ymd = (p: Pick<Parts, "y" | "m" | "d">) =>
  `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;

export function isTradingDay(ms: number): boolean {
  const p = nyParts(ms);
  return p.wd >= 1 && p.wd <= 5 && !HOLIDAYS.has(ymd(p));
}

export type Session = "open" | "pre" | "after" | "closed";

export function session(ms = Date.now()): Session {
  if (!isTradingDay(ms)) return "closed";
  const p = nyParts(ms);
  const minutes = p.hh * 60 + p.mm;
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "open";
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "pre";
  if (minutes >= 16 * 60 && minutes < 20 * 60) return "after";
  return "closed";
}

/** The bell on the trading day containing `ms`, as unix seconds. */
function bellOn(ms: number): number {
  const p = nyParts(ms);
  return Math.floor(nyToMs(p.y, p.m, p.d, BELL.hour, BELL.minute, BELL.second) / 1000);
}

/** The next bell at least `minLeadSecs` away. */
export function nextBell(now = Date.now(), minLeadSecs = 15 * 60): number {
  for (let i = 0; i < 10; i++) {
    const day = now + i * 86_400_000;
    if (!isTradingDay(day)) continue;
    const t = bellOn(day);
    if (t - now / 1000 >= minLeadSecs) return t;
  }
  throw new Error("No trading day in the next ten days");
}

/** This week's Friday bell (or the last trading day of the week, if Friday is
 *  a holiday), rolling to next week once it has passed. */
export function weekBell(now = Date.now(), minLeadSecs = 15 * 60): number {
  let best = 0;
  for (let i = 0; i < 14; i++) {
    const day = now + i * 86_400_000;
    if (!isTradingDay(day)) continue;
    const t = bellOn(day);
    if (t - now / 1000 < minLeadSecs) continue;
    const wd = nyParts(day).wd;
    best = t;
    // Friday, or the last trading day before a weekend.
    const next = day + 86_400_000;
    if (wd === 5 || !isTradingDay(next)) return best;
  }
  return best;
}

/** Minutes until the market next opens, for "opens in" copy. */
export function nextOpen(now = Date.now()): number {
  for (let i = 0; i < 10; i++) {
    const day = now + i * 86_400_000;
    if (!isTradingDay(day)) continue;
    const p = nyParts(day);
    const t = nyToMs(p.y, p.m, p.d, OPEN.hour, OPEN.minute) / 1000;
    if (t > now / 1000) return t;
  }
  return 0;
}
