/* A stock's badge: the ticker set big, in its side's colour. */

import { pct } from "@/lib/format";
import { byTicker } from "@/lib/stocks";

export function TickerBadge({
  ticker,
  side,
  size = "md",
}: {
  ticker: string;
  side: "p1" | "p2";
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const stock = byTicker(ticker);
  const sizes = {
    sm: "text-2xl",
    md: "text-4xl",
    lg: "text-6xl",
    xl: "text-7xl sm:text-8xl",
  } as const;
  return (
    <span className="inline-flex flex-col">
      <span className={`display ${sizes[size]} ${side === "p1" ? "text-p1" : "text-p2"}`}>{ticker}</span>
      {size !== "sm" ? <span className="label mt-1">{stock?.name ?? ""}</span> : null}
    </span>
  );
}

export function Move({ value, className = "" }: { value: number | null; className?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className={`text-dim ${className}`}>--</span>;
  const tone = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-dim";
  /* pct widens past two decimals only when two would print a real move as
   * zero, which is what a quiet weekend does to these numbers. */
  return <span className={`font-mono ${tone} ${className}`}>{pct(value)}</span>;
}
