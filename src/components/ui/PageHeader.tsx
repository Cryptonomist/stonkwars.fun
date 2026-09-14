import type { ReactNode } from "react";

import { cx } from "./cx";

/* The top of every page: an eyebrow, a title at page size, and optionally a
 * few inline stats and the page's one action. It replaced five 72px headers
 * that each spent a phone's first screen on a word, so it is deliberately
 * short: the board underneath is the point. */

export type HeaderStat = { label: string; value: ReactNode };

export function PageHeader({
  eyebrow,
  title,
  stats,
  action,
  className,
  compactBelow,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  stats?: HeaderStat[];
  action?: ReactNode;
  className?: string;
  /** Below this width, leave out the eyebrow and the stats, for a board whose
   *  own tabs or meta line already carry those numbers on a phone. */
  compactBelow?: "sm" | "lg";
}) {
  /* Spelled out in full so Tailwind finds the classes. */
  const eyebrowCls = compactBelow === "sm" || compactBelow === "lg" ? "hidden sm:block" : undefined;
  const titleGap = eyebrow ? (eyebrowCls ? "sm:mt-2" : "mt-2") : null;
  const statsCls = compactBelow === "lg" ? "hidden lg:flex" : compactBelow === "sm" ? "hidden sm:flex" : "flex";
  return (
    <header className={cx("flex flex-wrap items-end justify-between gap-x-6 gap-y-4 py-6", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className={cx("label", eyebrowCls)}>{eyebrow}</p> : null}
        <h1 className={cx("h-page", titleGap)}>{title}</h1>
      </div>
      {stats?.length || action ? (
        <div className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-3">
          {stats?.length ? (
            <dl className={cx("min-w-0 flex-wrap gap-x-6 gap-y-2", statsCls)}>
              {stats.map((s) => (
                <div key={s.label} className="min-w-0">
                  <dt className="label">{s.label}</dt>
                  <dd className="num mt-1 text-sm text-ink">{s.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
