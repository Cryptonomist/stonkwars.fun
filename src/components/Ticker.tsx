/* A price move as it reads everywhere: green up, red down, dim when flat or
 * unknown. */

import { pct } from "@/lib/format";

export function Move({ value, className = "" }: { value: number | null; className?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className={`text-dim ${className}`}>--</span>;
  const tone = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-dim";
  /* pct widens past two decimals only when two would print a real move as
   * zero, which is what a quiet weekend does to these numbers. */
  return <span className={`font-mono ${tone} ${className}`}>{pct(value)}</span>;
}
