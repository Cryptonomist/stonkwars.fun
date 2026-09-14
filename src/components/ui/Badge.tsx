import type { ReactNode } from "react";

import { cx } from "./cx";
import { LiveDot } from "./LiveDot";

/* One badge size, six meanings. The variant is the meaning, and the colour
 * follows from it, so a badge can never be green for a reason that is not a
 * win or orange for anything but COOKED:
 *
 *   neutral  a fact: "24/7", "You", "3 in a row"
 *   source   where a price came from: Pyth, Exchange, Perp, Last close
 *   live     a round in progress, with the split dot
 *   count    a number on something: an inbox, a tab
 *   win      the W, on green tint
 *   cooked   the mini stencil stamp
 */

export type BadgeVariant = "neutral" | "source" | "live" | "count" | "win" | "cooked";

const TONE: Record<Exclude<BadgeVariant, "cooked">, string> = {
  neutral: "text-ink ring-1 ring-line ring-inset",
  source: "text-dim ring-1 ring-line ring-inset",
  live: "text-ink ring-1 ring-line ring-inset",
  count: "bg-panel-3 text-ink",
  win: "bg-up-tint text-up",
};

export function Badge({
  variant = "neutral",
  children,
  className,
  title,
}: {
  variant?: BadgeVariant;
  children?: ReactNode;
  className?: string;
  title?: string;
}) {
  if (variant === "cooked") {
    return (
      <span className={cx("stamp-cooked-sm shrink-0", className)} title={title}>
        {children ?? "Cooked"}
      </span>
    );
  }
  return (
    <span
      className={cx(
        "micro inline-flex h-4.5 shrink-0 items-center gap-1.5 px-1.5 whitespace-nowrap",
        TONE[variant],
        className,
      )}
      title={title}
    >
      {variant === "live" ? <LiveDot /> : null}
      {children ?? (variant === "live" ? "Live" : null)}
    </span>
  );
}
