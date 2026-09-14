import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "./cx";

/* A section's title, how many things are in it, and a way to see all of them.
 * Rails show N rows plus this link, never an endless list. */
export function SectionHead({
  title,
  count,
  action,
  id,
  className,
}: {
  title: ReactNode;
  count?: number | string | null;
  action?: { href: string; label: string };
  id?: string;
  className?: string;
}) {
  return (
    <div className={cx("flex min-w-0 items-baseline justify-between gap-2", className)}>
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 id={id} className="h-section truncate">
          {title}
        </h2>
        {count != null ? <span className="micro num text-dim">{count}</span> : null}
      </div>
      {action ? (
        <Link href={action.href} className="label shrink-0 transition-colors hover:text-ink">
          {action.label}
          <span aria-hidden="true"> &rarr;</span>
        </Link>
      ) : null}
    </div>
  );
}
