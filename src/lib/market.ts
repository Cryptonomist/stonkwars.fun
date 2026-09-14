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

/* Half days: the market shuts at 1:00 PM, so the bell there is 12:59:30. A
 * "Friday bell" on the day after Thanksgiving that ignored this would end an
 * hour and a half into the after-hours session. */
const EARLY_CLOSE = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);

export const BELL = { hour: 15, minute: 59, second: 30 };
const EARLY_BELL = { hour: 12, minute: 59, second: 30 };
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
  const close = EARLY_CLOSE.has(ymd(p)) ? 13 * 60 : 16 * 60;
  if (minutes >= 9 * 60 + 30 && minutes < close) return "open";
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "pre";
  if (minutes >= close && minutes < (close === 16 * 60 ? 20 * 60 : 17 * 60)) return "after";
  return "closed";
}

/* WHEN A MARKET IS NEXT RUNNING, FROM A MOMENT.
 *
 * The first instant at or after `ms` inside a session, or `ms` itself when one
 * is already running. "extended" is any session but closed, 4am to 8pm on a
 * trading day (5pm on a half day): the hours the exchange's own minute bars
 * cover. "regular" is 9:30 to the close only: the hours Pyth's US equity feeds
 * print. It walks calendar days in New York, so a weekend, a holiday or a
 * daylight saving change is simply a day with nothing in it.
 *
 * Asked about a boundary, this is the moment a side's first price after it
 * can begin to exist, which is a fixed time: it does not move with the clock,
 * and it stays in the past once the market that made it has shut again. Null
 * only if nothing opens within ten days, which no closure on the calendar
 * comes near. */
export function sessionFrom(ms: number, hours: "extended" | "regular"): number | null {
  const p = nyParts(ms);
  for (let i = 0; i < 10; i++) {
    // Noon on each calendar day; Date.UTC rolls a day past the month's end over.
    const noon = nyToMs(p.y, p.m, p.d + i, 12, 0);
    if (!isTradingDay(noon)) continue;
    const q = nyParts(noon);
    const early = EARLY_CLOSE.has(ymd(q));
    const start =
      hours === "regular" ? nyToMs(q.y, q.m, q.d, OPEN.hour, OPEN.minute) : nyToMs(q.y, q.m, q.d, 4, 0);
    const end = hours === "regular" ? nyToMs(q.y, q.m, q.d, early ? 13 : 16, 0) : nyToMs(q.y, q.m, q.d, early ? 17 : 20, 0);
    if (ms < start) return start;
    if (ms < end) return ms;
  }
  return null;
}

/* THE SAME, FOR A BOUNDARY IN UNIX SECONDS.
 *
 * The price clock asks it for every side that waits, and the roster asks it to
 * decide whether two sides of a fight start together. They share this one
 * function so that the page that lets a fight be taken and the crank that
 * prices it cannot disagree about when a market opens. Null only as for
 * sessionFrom. */
export function openingAfter(boundary: number, hours: "extended" | "regular"): number | null {
  const ms = sessionFrom(boundary * 1_000, hours);
  return ms === null ? null : Math.floor(ms / 1_000);
}

/** The bell on the trading day containing `ms`, as unix seconds. */
function bellOn(ms: number): number {
  const p = nyParts(ms);
  const b = EARLY_CLOSE.has(ymd(p)) ? EARLY_BELL : BELL;
  return Math.floor(nyToMs(p.y, p.m, p.d, b.hour, b.minute, b.second) / 1000);
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
