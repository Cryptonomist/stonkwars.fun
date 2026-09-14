import { cx } from "./cx";

/* Live means both corners are in: a dot split cyan and pink, with an ink ring
 * that pulses (and holds still under reduced motion). Purely decorative, so it
 * is hidden from screen readers; always put the word "Live" beside it. */
export function LiveDot({ className }: { className?: string }) {
  return <span className={cx("live-dot", className)} aria-hidden="true" />;
}
