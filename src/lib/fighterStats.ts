/* A stock, read as a fighter.
 *
 * Picking between a thousand tickers is a spreadsheet problem until the two you
 * are looking at have stats. These are the three that decide a short fight,
 * computed from a month of daily closes and nothing else:
 *
 *   POWER   how hard it swings — the daily move it averages, either way. The
 *           whole game is whose percentage move is bigger, so this is the
 *           single most useful number on the screen.
 *   FORM    where it has been going lately — the last five sessions.
 *   ROOM    where it sits in its own month's range. At the top there is less
 *           of it left; at the bottom, more.
 *
 * They describe the stock's recent past, which is not a forecast and is not an
 * input to anything: the program settles on two signed prices, and nothing here
 * reaches it. Every stat is a ratio, so a stock quoted in Hong Kong dollars
 * needs no conversion to sit beside one quoted in dollars. */

export type Fighter = {
  /** Average daily move, in percentage points, either direction. */
  power: number;
  /** Percent change over the last five sessions. */
  form: number;
  /** 0 at the month's low, 100 at its high. */
  room: number;
  /** Consecutive sessions in the same direction, signed. */
  streak: number;
  /** The closes themselves, for drawing. */
  closes: number[];
};

/** A daily move this big is as hard as a stock hits, for scaling a bar. */
export const POWER_CEILING = 4;

/** Needs enough closes to mean anything: a fortnight of sessions. */
const MIN_CLOSES = 10;

const pct = (from: number, to: number) => ((to - from) / from) * 100;

export function fighterFrom(closes: (number | null | undefined)[]): Fighter | null {
  const c = closes.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0);
  if (c.length < MIN_CLOSES) return null;

  const moves: number[] = [];
  for (let i = 1; i < c.length; i++) moves.push(pct(c[i - 1], c[i]));

  const power = moves.reduce((sum, m) => sum + Math.abs(m), 0) / moves.length;
  const form = pct(c[Math.max(0, c.length - 6)], c[c.length - 1]);

  const high = Math.max(...c);
  const low = Math.min(...c);
  const room = high === low ? 50 : ((c[c.length - 1] - low) / (high - low)) * 100;

  // A run of sessions the same way, counted back from the latest.
  let streak = 0;
  for (let i = moves.length - 1; i >= 0; i--) {
    const dir = Math.sign(moves[i]);
    if (dir === 0 || (streak !== 0 && dir !== Math.sign(streak))) break;
    streak += dir;
  }

  return { power, form, room, streak, closes: c };
}

/** A stat as a share of the bar, 0 to 1. */
export const powerBar = (power: number) => Math.min(1, power / POWER_CEILING);

/** Form runs both ways, so the bar runs out from the middle. */
export const formBar = (form: number) => Math.min(1, Math.abs(form) / 10);

/** How the two compare on the stat that matters most, said in words. */
export function tale(a: Fighter, b: Fighter): string {
  const gap = a.power - b.power;
  if (Math.abs(gap) < 0.15) return "Evenly matched: both swing about the same on a normal day.";
  const [big, small] = gap > 0 ? ["Yours", "theirs"] : ["Theirs", "yours"];
  return `${big} swings ${Math.abs(gap).toFixed(2)} points a day harder than ${small}. More room to win, and to lose.`;
}
