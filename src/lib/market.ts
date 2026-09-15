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
 * cover. "regular" is 9:30 to the close only. It walks calendar days in New
 * York, so a weekend, a holiday or a daylight saving change is simply a day
 * with nothing in it. Pyth's hours are not either of these: see pythSpanAt.
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

/* EVERY OPENING BETWEEN TWO MOMENTS.
 *
 * The starts of the extended sessions (4am) and the regular ones (9:30) after
 * `from` and before `until`, in unix seconds and in order. Two stocks that
 * cannot fight fairly now can only line up again when some market opens, so
 * these are the only moments worth asking about. Walked like sessionFrom, by
 * calendar day in New York, for at most forty days. */
export function openingsBetween(from: number, until: number): number[] {
  const out: number[] = [];
  const p = nyParts(from * 1_000);
  for (let i = 0; i < 40; i++) {
    const noon = nyToMs(p.y, p.m, p.d + i, 12, 0);
    if (noon / 1_000 - 86_400 > until) break;
    if (!isTradingDay(noon)) continue;
    const q = nyParts(noon);
    for (const ms of [nyToMs(q.y, q.m, q.d, 4, 0), nyToMs(q.y, q.m, q.d, OPEN.hour, OPEN.minute)]) {
      const t = Math.floor(ms / 1_000);
      if (t > from && t < until) out.push(t);
    }
  }
  return out;
}

/* PYTH'S US EQUITY FEEDS PRINT FIVE DAYS A WEEK, NOT SIX AND A HALF HOURS.
 *
 * This used to model them as 9:30 to the close, which refused fights at hours
 * Pyth does print and, worse, called a weekend boundary a wait when it is a
 * boundary nothing will ever price. What was measured from Hermes on 14 Sep
 * 2026 (docs/247-pricing.md, section 4):
 *
 *   hours     For each trading day D, the feed prints from 8 PM New York on
 *             the calendar day before D until 8 PM on D, every second. So a
 *             week's weekday nights run into each other: one span from Sunday
 *             8 PM to Friday 8 PM.
 *   the gap   The last print before a weekend is Friday 7:59:59 PM. Hermes
 *             answers 404 inside the gap, and the first print after it is
 *             Sunday 8:00:00 PM.
 *   holidays  A holiday is a day with no span. Labor Day (Monday 7 Sep) had no
 *             Sunday night session: the feed was dark from Friday 8 PM until
 *             Tuesday's day began, Monday 8 PM, 72 hours.
 *   half day  An early close is taken to end at 1 PM. Unmeasured; ending early
 *             is the side that refuses a fight rather than strands one.
 *
 * The program takes a Pyth side's price only from an update whose
 * prev_publish_time is before the boundary and whose publish_time is at or
 * after it. The first print after a gap carries a made-up prev_publish_time,
 * one second before its own, and VOO's first print on Sunday was 8:00:01, so a
 * boundary at 8:00:00 fails for VOO and passes for TSLA. No boundary inside a
 * gap can ever pass. One inside a span passes once the feed has printed before
 * it: TSLA's Sunday print came at 8:00:00 and VOO's at 8:00:01, so a boundary
 * at 8:00:30 passes for both. So only a boundary outside every span is one
 * nothing will ever price (pythPricesAt): the crank never tries it and the
 * pages send its stakes to the stall refund. A boundary in a span's first
 * PYTH_EDGE_SECS is tried like any other, and Hermes' prev and publish times
 * decide it (crank.ts, pythUpdateAt): it used to be called never, which parked
 * fights Hermes could price until their refund, and a feed that comes back
 * later than the boundary is refused there, which ends at the same refund.
 * The margin stays where it
 * protects somebody: the pages refuse a fight whose Pyth side could land
 * within PYTH_EDGE_SECS of either end of a gap (pythGapNear), since the exact
 * second a feed comes back, or a thin feed's last print before a gap, cannot
 * be known in advance. */
export const PYTH_EDGE_SECS = 60;

/** A stretch Pyth prints through without a break, unix seconds, end exclusive. */
export type PythSpan = { start: number; end: number };

const daySpans = new Map<string, PythSpan | null>();

/** The span of the trading day on (y, m, d), which may roll over a month's
 *  end, or null when that day is not a trading day. */
function pythDay(y: number, m: number, d: number): PythSpan | null {
  const key = `${y}-${m}-${d}`;
  if (daySpans.has(key)) return daySpans.get(key)!;
  const noon = nyToMs(y, m, d, 12, 0);
  let span: PythSpan | null = null;
  if (isTradingDay(noon)) {
    const q = nyParts(noon);
    span = {
      start: Math.floor(nyToMs(q.y, q.m, q.d - 1, 20, 0) / 1_000),
      end: Math.floor(nyToMs(q.y, q.m, q.d, EARLY_CLOSE.has(ymd(q)) ? 13 : 20, 0) / 1_000),
    };
  }
  daySpans.set(key, span);
  return span;
}

/** The whole span Pyth prints through that contains `t` (unix seconds),
 *  joined across weekday nights, or null when Pyth is dark at `t`. */
export function pythSpanAt(t: number): PythSpan | null {
  const p = nyParts(t * 1_000);
  // From 8 PM a moment belongs to the next day's span.
  const d = p.d + (p.hh >= 20 ? 1 : 0);
  const own = pythDay(p.y, p.m, d);
  if (!own || t < own.start || t >= own.end) return null;
  let { start, end } = own;
  for (let i = 1; i <= 10; i++) {
    const before = pythDay(p.y, p.m, d - i);
    if (!before || before.end !== start) break;
    start = before.start;
  }
  for (let i = 1; i <= 10; i++) {
    const after = pythDay(p.y, p.m, d + i);
    if (!after || after.start !== end) break;
    end = after.end;
  }
  return { start, end };
}

/** Whether a Pyth US equity price can exist for `boundary`: inside a span,
 *  its first second included. */
export function pythPricesAt(boundary: number): boolean {
  return pythSpanAt(boundary) !== null;
}

/* THE GAP A PYTH BOUNDARY IS IN, OR TOO CLOSE TO.
 *
 * From the end of the span before it to the start of the span after it, in
 * unix seconds: the stretch a refusal names. Null when `boundary` is at least
 * PYTH_EDGE_SECS inside a span at both ends, which is where the pages let a
 * Pyth side's start or end land. Walked by calendar day, like sessionFrom, for
 * at most ten days either way. */
export function pythGapNear(boundary: number): { from: number; until: number } | null {
  const span = pythSpanAt(boundary);
  if (span && boundary >= span.start + PYTH_EDGE_SECS && boundary <= span.end - PYTH_EDGE_SECS) return null;
  if (span) {
    return boundary < span.start + PYTH_EDGE_SECS
      ? { from: pythEndBefore(span.start), until: span.start }
      : { from: span.end, until: pythStartAfter(span.end) };
  }
  return { from: pythEndBefore(boundary), until: pythStartAfter(boundary) };
}

/** The end of the last span to end at or before `t`. */
function pythEndBefore(t: number): number {
  const p = nyParts(t * 1_000);
  for (let i = 0; i <= 10; i++) {
    const day = pythDay(p.y, p.m, p.d + 1 - i);
    if (day && day.end <= t && pythSpanAt(day.end - 1)!.end === day.end) return day.end;
  }
  throw new Error("Pyth printed on no day in the ten before this");
}

/** The start of the first span to start at or after `t`. */
function pythStartAfter(t: number): number {
  const p = nyParts(t * 1_000);
  for (let i = 0; i <= 11; i++) {
    const day = pythDay(p.y, p.m, p.d + i);
    if (day && day.start >= t && pythSpanAt(day.start)!.start === day.start) return day.start;
  }
  throw new Error("Pyth prints on no day in the ten after this");
}

/** Every moment in (from, until) that is PYTH_EDGE_SECS past the start of a
 *  span, in order: the moments a fight refused because Pyth was dark can
 *  first be taken again. */
export function pythReopeningsBetween(from: number, until: number): number[] {
  const out: number[] = [];
  const p = nyParts(from * 1_000);
  for (let i = 0; i < 41; i++) {
    const day = pythDay(p.y, p.m, p.d + i);
    if (!day) continue;
    if (day.start - 86_400 > until) break;
    const t = day.start + PYTH_EDGE_SECS;
    if (t > from && t < until && pythSpanAt(day.start)!.start === day.start) out.push(t);
  }
  return out;
}

/* HONG KONG AND LONDON.
 *
 * The roster lists 79 Hong Kong stocks and one London one (NWG), and their
 * sides are priced by their own exchange's one-minute bars, which exist only
 * in their sessions. This used to be unmodelled, and every non-US boundary was
 * called priced at once: a Hong Kong stock taken against a US one while HKEX
 * was shut started its side at the next Hong Kong session, hours after the US
 * side (found by the adversarial study reading this code). Now each exchange's
 * sessions are known, so such a side waits for its opening exactly as a US
 * stock waits for 4 AM, and the pages refuse a take the gap would decide.
 *
 *   HKEX  09:30 to 12:00 and 13:00 to 16:10 Hong Kong time: the morning
 *         session, the lunch break, and the afternoon session with its closing
 *         auction (16:00 to 16:10). On a half day (the eves of Christmas, New
 *         Year and Lunar New Year when they are weekdays) only the morning
 *         session, with its auction to 12:10. Hong Kong has no daylight
 *         saving. Closed on Hong Kong's general holidays that fall on a
 *         weekday. Sources: HKEX's Securities Market trading hours page for
 *         the sessions; the holidays are the Hong Kong Government's 1823
 *         calendar (www.1823.gov.hk/common/ical/en.json) for 2026 and 2027,
 *         which the research saved and checked against HKEX's 2026 Stock
 *         Connect calendar and the Government's 2027 gazette notice (press
 *         release P2026051400300); the half days are HKEX's rule applied to
 *         those years, from the same research (weekend-mark coverage lens,
 *         read 15 Sep 2026). A typhoon or black rainstorm closure cannot be
 *         known in advance and is not modelled.
 *   LSE   08:00 to 16:35 London time: continuous trading and the closing
 *         auction (16:30 to 16:35). On Christmas Eve and New Year's Eve, when
 *         they are weekdays, it ends at 12:35. Closed on England and Wales
 *         bank holidays, from GOV.UK (www.gov.uk/bank-holidays.json, saved by
 *         the same research). The half-day hours are the LSE's long-standing
 *         convention and were not confirmed for 2026 and 2027.
 *
 * A market with none of these (none on the roster today) keeps the old rule:
 * priced at the boundary, because guessing its hours would be worse. */
type Minutes = [open: number, close: number];
type Exchange = { zone: string; sessions: Minutes[]; half: Minutes[]; holidays: Set<string>; halfDays: Set<string> };

const EXCHANGES: Record<string, Exchange> = {
  HK: {
    zone: "Asia/Hong_Kong",
    sessions: [
      [9 * 60 + 30, 12 * 60],
      [13 * 60, 16 * 60 + 10],
    ],
    half: [[9 * 60 + 30, 12 * 60 + 10]],
    holidays: new Set([
      "2026-01-01", "2026-02-17", "2026-02-18", "2026-02-19", "2026-04-03", "2026-04-06", "2026-04-07",
      "2026-05-01", "2026-05-25", "2026-06-19", "2026-07-01", "2026-10-01", "2026-10-19", "2026-12-25",
      "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-26", "2027-03-29", "2027-04-05", "2027-05-13",
      "2027-06-09", "2027-07-01", "2027-09-16", "2027-10-01", "2027-10-08", "2027-12-27",
    ]),
    halfDays: new Set(["2026-12-24", "2026-12-31", "2027-02-05", "2027-12-24", "2027-12-31"]),
  },
  GB: {
    zone: "Europe/London",
    sessions: [[8 * 60, 16 * 60 + 35]],
    half: [[8 * 60, 12 * 60 + 35]],
    holidays: new Set([
      "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28",
      "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28",
    ]),
    halfDays: new Set(["2026-12-24", "2026-12-31", "2027-12-24", "2027-12-31"]),
  },
};

/** Whether a listing's sessions are modelled here: Hong Kong and London. */
export const sessionsModelled = (market: string) => market in EXCHANGES;

const zoneFormats = new Map<string, Intl.DateTimeFormat>();
function zoneParts(zone: string, ms: number): Parts {
  let f = zoneFormats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    zoneFormats.set(zone, f);
  }
  const p: Record<string, string> = {};
  for (const { type, value } of f.formatToParts(new Date(ms))) p[type] = value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour) % 24, mm: Number(p.minute), ss: Number(p.second), wd: WEEKDAYS.indexOf(p.weekday) };
}

/** Unix ms for a wall-clock time in `zone`, the way nyToMs does it for New York. */
function zoneToMs(zone: string, y: number, m: number, d: number, hh: number, mm: number): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (ms: number) => {
    const p = zoneParts(zone, ms);
    return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - ms;
  };
  let ms = guess - offsetAt(guess);
  const second = offsetAt(ms);
  if (guess - second !== ms) ms = guess - second;
  return ms;
}

/** Each session on the calendar day (y, m, d) in the exchange's zone, as unix
 *  seconds [start, end), end exclusive; empty on a weekend or holiday. */
function sessionsOn(x: Exchange, y: number, m: number, d: number): [number, number][] {
  const noon = zoneParts(x.zone, zoneToMs(x.zone, y, m, d, 12, 0));
  if (noon.wd === 0 || noon.wd === 6) return [];
  const key = ymd(noon);
  if (x.holidays.has(key)) return [];
  return (x.halfDays.has(key) ? x.half : x.sessions).map(([open, close]) => [
    Math.floor(zoneToMs(x.zone, noon.y, noon.m, noon.d, Math.floor(open / 60), open % 60) / 1_000),
    Math.floor(zoneToMs(x.zone, noon.y, noon.m, noon.d, Math.floor(close / 60), close % 60) / 1_000),
  ]);
}

/* THE MOMENT A LISTING ABROAD CAN FIRST BE PRICED, FROM A BOUNDARY.
 *
 * The boundary itself while its exchange is in a session, otherwise the start
 * of the next session, walked by calendar day in the exchange's own zone for
 * at most ten days. The boundary, unchanged, for a market not modelled. Null
 * only if nothing opens within ten days. */
export function abroadOpeningAfter(market: string, boundary: number): number | null {
  const x = EXCHANGES[market];
  if (!x) return boundary;
  const p = zoneParts(x.zone, boundary * 1_000);
  for (let i = 0; i < 10; i++) {
    for (const [start, end] of sessionsOn(x, p.y, p.m, p.d + i)) {
      if (boundary < start) return start;
      if (boundary < end) return boundary;
    }
  }
  return null;
}

/** Every session start of a modelled exchange in (from, until), in order. */
export function abroadOpeningsBetween(market: string, from: number, until: number): number[] {
  const x = EXCHANGES[market];
  if (!x) return [];
  const out: number[] = [];
  const p = zoneParts(x.zone, from * 1_000);
  for (let i = 0; i < 41; i++) {
    const sessions = sessionsOn(x, p.y, p.m, p.d + i);
    if (Math.floor(zoneToMs(x.zone, p.y, p.m, p.d + i, 0, 0) / 1_000) - 86_400 > until) break;
    for (const [start] of sessions) if (start > from && start < until) out.push(start);
  }
  return out;
}

/** The bell on the trading day containing `ms`, as unix seconds. */
function bellOn(ms: number): number {
  const p = nyParts(ms);
  const b = EARLY_CLOSE.has(ymd(p)) ? EARLY_BELL : BELL;
  return Math.floor(nyToMs(p.y, p.m, p.d, b.hour, b.minute, b.second) / 1000);
}

/** Whether `unix` is a bell: 3:59:30 PM New York on a trading day, 12:59:30
 *  on a half day. */
export function isBell(unix: number): boolean {
  return Number.isInteger(unix) && unix > 0 && isTradingDay(unix * 1_000) && bellOn(unix * 1_000) === unix;
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
