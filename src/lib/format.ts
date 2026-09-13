/* Money, shares and time, formatted the same way everywhere.
 *
 * Amounts move around as integer base units and prices as Pyth mantissas with
 * an exponent; both only become decimals at the edge, for display. Nothing a
 * transaction carries is ever computed from a float. */

/** A Pyth price, mantissa and exponent, as a number of dollars. Display only. */
export const pythToNumber = (price: bigint | number, expo: number): number =>
  Number(price) * 10 ** expo;

export function usd(n: number, opts?: { cents?: boolean }): string {
  const cents = opts?.cents ?? Math.abs(n) < 10_000;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

/* A MOVE THAT HAPPENED MUST NOT PRINT AS ZERO.
 *
 * Two decimals suit a trading day and lie on a quiet weekend. With the
 * exchanges shut the whole result can live in the fourth decimal place: one
 * settled fight was won with the sides at -0.0108% and -0.0046%, which at two
 * decimals reads "-0.01%" against "-0.00%". A number shown as zero beside the
 * words "winner takes both" looks like a bug in the thing that decided it.
 *
 * So the width is the smallest that still shows something, and only widens
 * when it has to: an ordinary move prints as it always did. Genuine zero, which
 * the program treats as a tie, still prints as zero, because there it is true.
 */
/* "Non-zero" is not the test. 0.0062 survives two decimals as "0.01", which is
 * not zero and is still wrong: it is the whole margin of a fight reported as
 * something else. The test is significant figures. Below a tenth of a point,
 * two decimals cannot carry even two of them, so the width grows until it can
 * and trailing zeros the growth added come back off. */
const magnitude = (n: number, digits: number, max = 6): number => {
  const a = Math.abs(n);
  if (a === 0 || a >= 0.1) return digits;
  return Math.max(digits, Math.min(max, -Math.floor(Math.log10(a)) + 1));
};

function fixed(n: number, digits: number): string {
  const a = Math.abs(n);
  const d = magnitude(n, digits);
  const s = a.toFixed(d);
  if (d === digits) return s;
  const trimmed = s.replace(/0+$/, "");
  const kept = trimmed.length - trimmed.indexOf(".") - 1;
  return kept < digits ? a.toFixed(digits) : trimmed;
}

/** "+3.12%", "-0.85%", "0.00%", and "-0.0046%" rather than "-0.00%". */
export function pct(n: number, digits = 2): string {
  if (n === 0) return `0.${"0".repeat(digits)}%`;
  const s = fixed(n, digits);
  if (Number(s) === 0) return `0.${"0".repeat(digits)}%`;
  return `${n > 0 ? "+" : "-"}${s}%`;
}

/** The gap between two moves, in percentage points: "1.23", "0.0062". */
export function points(gap: number, digits = 2): string {
  return fixed(gap, digits);
}

/** Base units of a token to a short decimal string: 14000000n (8 dp) -> "0.14". */
export function shares(raw: bigint, decimals: number, maxDigits = 4): string {
  const n = Number(raw) / 10 ** decimals;
  if (n === 0) return "0";
  if (n >= 100) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { maximumFractionDigits: maxDigits, minimumFractionDigits: 0 });
}

/** "1d 04:12:09", "12:09", "0:07". A round timer, not a timestamp. */
export function clock(secondsLeft: number): string {
  let s = Math.max(0, Math.floor(secondsLeft));
  const d = Math.floor(s / 86_400);
  s -= d * 86_400;
  const h = Math.floor(s / 3_600);
  s -= h * 3_600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const two = (x: number) => String(x).padStart(2, "0");
  if (d > 0) return `${d}d ${two(h)}:${two(m)}:${two(s)}`;
  if (h > 0) return `${h}:${two(m)}:${two(s)}`;
  return `${m}:${two(s)}`;
}

/** "15 min", "1 hr", "2 days" */
export function span(seconds: number): string {
  if (seconds < 3_600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) {
    const h = seconds / 3_600;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} hr`;
  }
  const d = seconds / 86_400;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} days`;
}

export const shortAddress = (a: string, n = 4): string =>
  a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}...${a.slice(-n)}`;

/** A time in New York, which is the clock the market keeps. */
export function etTime(unix: number, withDay = true): string {
  return new Date(unix * 1000).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: withDay ? "short" : undefined,
    hour: "numeric",
    minute: "2-digit",
    second: undefined,
  }) + " ET";
}
