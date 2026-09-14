import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "./cx";

/* A row of stat cells with hairline gaps between them.
 *
 * THE LAST CELL STRETCHES. Seven stats in a two-column grid leave a hole in
 * the bottom-right corner, and a hole in a stats strip reads as a stat that
 * failed to load. So at every breakpoint the last cell spans whatever the row
 * has left over, and no layout ever shows an empty cell.
 *
 * Tailwind only generates classes it can find written out in full in the
 * source, so the column and span classes are spelled out in tables below
 * rather than built from strings. Up to 8 columns are supported. */

export type StatCell = { label: string; value: ReactNode; sub?: ReactNode; href?: string };
export type StatCols = { base?: number; sm?: number; lg?: number };

const COLS = {
  base: ["", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4", "grid-cols-5", "grid-cols-6", "grid-cols-7", "grid-cols-8"],
  sm: ["", "sm:grid-cols-1", "sm:grid-cols-2", "sm:grid-cols-3", "sm:grid-cols-4", "sm:grid-cols-5", "sm:grid-cols-6", "sm:grid-cols-7", "sm:grid-cols-8"],
  lg: ["", "lg:grid-cols-1", "lg:grid-cols-2", "lg:grid-cols-3", "lg:grid-cols-4", "lg:grid-cols-5", "lg:grid-cols-6", "lg:grid-cols-7", "lg:grid-cols-8"],
} as const;

const SPAN = {
  base: ["", "col-span-1", "col-span-2", "col-span-3", "col-span-4", "col-span-5", "col-span-6", "col-span-7", "col-span-8"],
  sm: ["", "sm:col-span-1", "sm:col-span-2", "sm:col-span-3", "sm:col-span-4", "sm:col-span-5", "sm:col-span-6", "sm:col-span-7", "sm:col-span-8"],
  lg: ["", "lg:col-span-1", "lg:col-span-2", "lg:col-span-3", "lg:col-span-4", "lg:col-span-5", "lg:col-span-6", "lg:col-span-7", "lg:col-span-8"],
} as const;

const clampCols = (n: number) => Math.max(1, Math.min(8, Math.round(n)));

/** How many columns the last of `count` cells must span to close its row. */
export function lastSpan(count: number, cols: number): number {
  const r = count % cols;
  return r === 0 ? 1 : cols - r + 1;
}

export function StatStrip({
  cells,
  cols,
  className,
  label,
}: {
  cells: StatCell[];
  cols?: StatCols;
  className?: string;
  /** An accessible name for the strip, when the page has more than one. */
  label?: string;
}) {
  if (cells.length === 0) return null;
  const n = cells.length;
  const base = clampCols(cols?.base ?? Math.min(2, n));
  const sm = clampCols(cols?.sm ?? Math.min(4, n));
  const lg = clampCols(cols?.lg ?? Math.min(8, n));

  const lastClass = cx(SPAN.base[lastSpan(n, base)], SPAN.sm[lastSpan(n, sm)], SPAN.lg[lastSpan(n, lg)]);

  return (
    <dl
      aria-label={label}
      className={cx("grid gap-px bg-line ring-1 ring-line", COLS.base[base], COLS.sm[sm], COLS.lg[lg], className)}
    >
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={cx(
            "relative flex min-w-0 flex-col bg-panel px-3 py-2.5",
            c.href &&
              "transition-colors hover:bg-panel-3 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-ink",
            i === n - 1 && lastClass,
          )}
        >
          <dt className="label truncate">{c.label}</dt>
          <dd className="display mt-1.5 truncate text-hud-sm text-ink">
            {c.href ? (
              /* The link covers the whole cell, so the cell is the target,
               * while its text stays the value it names. */
              <Link href={c.href} className="after:absolute after:inset-0 focus-visible:outline-none">
                {c.value}
              </Link>
            ) : (
              c.value
            )}
          </dd>
          {c.sub != null ? <dd className="mt-1 truncate text-meta text-dim">{c.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
