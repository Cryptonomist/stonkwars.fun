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
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  stats?: HeaderStat[];
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("flex flex-wrap items-end justify-between gap-x-6 gap-y-4 py-6", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="label">{eyebrow}</p> : null}
        <h1 className={cx("h-page", eyebrow ? "mt-2" : null)}>{title}</h1>
      </div>
      {stats?.length || action ? (
        <div className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-3">
          {stats?.length ? (
            <dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-2">
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
