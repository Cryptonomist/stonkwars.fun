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

/** "+3.12%", "-0.85%", "0.00%" */
export function pct(n: number, digits = 2): string {
  const s = Math.abs(n).toFixed(digits);
  if (Number(s) === 0) return `0.${"0".repeat(digits)}%`;
  return `${n > 0 ? "+" : "-"}${s}%`;
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
