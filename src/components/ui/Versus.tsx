import type { ReactNode } from "react";

import { cx } from "./cx";

/* Two corners and what sits between them.
 *
 * The columns are minmax(0, 1fr), not 1fr. A plain 1fr track will not shrink
 * below its content, so one long ticker or price in a corner pushed the whole
 * page wider than a phone; minmax(0, 1fr) lets the corner shrink and its text
 * truncate. Each child also gets min-w-0 for the same reason.
 *
 * `stackBelow` stacks the three into one column under that breakpoint. The
 * right corner mirrors the left (text right-aligned) whenever the columns sit
 * side by side, unless `mirror` is false.
 *
 * `pairBelow` is the other way to fit a phone: under that breakpoint the two
 * corners stay side by side in two equal columns and the centre drops beneath
 * both, across the full width. A stacked fight page put one corner a whole
 * screen below the other, so nobody saw both moves at once. The centre only
 * moves visually (order), so a screen reader still meets left, centre, right. */

const GRID = {
  none: "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
  sm: "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
  md: "grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
} as const;

const PAIR = {
  sm: "grid-cols-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
  md: "grid-cols-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
} as const;

const PAIR_CENTER = {
  sm: "order-last col-span-2 justify-self-stretch sm:order-none sm:col-span-1 sm:justify-self-center",
  md: "order-last col-span-2 justify-self-stretch md:order-none md:col-span-1 md:justify-self-center",
} as const;

const MIRROR = { none: "text-right", sm: "sm:text-right", md: "md:text-right" } as const;

export function Versus({
  left,
  center,
  right,
  stackBelow,
  pairBelow,
  mirror = true,
  className,
}: {
  left: ReactNode;
  center?: ReactNode;
  right: ReactNode;
  stackBelow?: "sm" | "md";
  pairBelow?: "sm" | "md";
  mirror?: boolean;
  className?: string;
}) {
  const mode = stackBelow ?? "none";
  return (
    <div className={cx("grid items-center gap-3", pairBelow ? PAIR[pairBelow] : GRID[mode], className)}>
      <div className="min-w-0">{left}</div>
      <div className={cx("min-w-0 text-center", pairBelow ? PAIR_CENTER[pairBelow] : "justify-self-center")}>{center}</div>
      <div className={cx("min-w-0", mirror && (pairBelow ? "text-right" : MIRROR[mode]))}>{right}</div>
    </div>
  );
}
