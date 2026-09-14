/* A price move as it reads everywhere: green up, red down, dim when flat or
 * unknown. */

import { pct, pctPair } from "@/lib/format";

export function Move({ value, text, className = "" }: { value: number | null; text?: string; className?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className={`text-dim ${className}`}>--</span>;
  const tone = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-dim";
  /* pct widens past two decimals only when two would print a real move as
   * zero, which is what a quiet weekend does to these numbers. `text` is the
   * same move already formatted beside its rival (format.ts pctPair), so two
   * close moves never print as the same string. */
  return <span className={`font-mono ${tone} ${className}`}>{text ?? pct(value)}</span>;
}

/** Both sides' moves as strings that differ whenever the moves do, or
 *  undefined for a side whose move is unknown (Move then prints its own). */
export function movePair(m1: number | null, m2: number | null): [string | undefined, string | undefined] {
  if (m1 === null || m2 === null || !Number.isFinite(m1) || !Number.isFinite(m2)) return [undefined, undefined];
  return pctPair(m1, m2);
}
