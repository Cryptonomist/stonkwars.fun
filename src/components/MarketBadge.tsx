"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { LiveDot } from "@/components/ui/LiveDot";
import { session, type Session } from "@/lib/market";
import { AROUND_THE_CLOCK } from "@/lib/stocks";

/* "Market closed" stopped being the whole truth the day the pools started
 * pricing stocks out of hours. The exchange is still shut, and saying so is
 * right, but a visitor at midnight needs to know there is a fight to be had.
 *
 * None of it is green. Green on this site means a price went up, and a session
 * opening is not a price moving. Open gets the split live dot and ink; the
 * in-between sessions are ink; shut is dim, with a neutral badge counting the
 * stocks that fight around the clock. */

const WORDS: Record<Exclude<Session, "closed">, string> = {
  open: "Market open",
  pre: "Pre-market",
  after: "After hours",
};

/** `className` carries the display (the nav passes "hidden xl:inline-flex"). */
export function MarketBadge({ className = "inline-flex" }: { className?: string }) {
  const [s, setS] = useState<Session | null>(null);
  useEffect(() => {
    const tick = () => setS(session());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  if (!s) return null;

  if (s === "closed") {
    return (
      <span className={cx("label items-center gap-2 whitespace-nowrap text-dim", className)}>
        Exchange shut
        {AROUND_THE_CLOCK > 0 ? <Badge variant="neutral">{`${AROUND_THE_CLOCK} fight 24/7`}</Badge> : null}
      </span>
    );
  }
  return (
    <span className={cx("label items-center gap-2 whitespace-nowrap text-ink", className)}>
      {s === "open" ? <LiveDot /> : null}
      {WORDS[s]}
    </span>
  );
}
