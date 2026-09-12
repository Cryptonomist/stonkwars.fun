"use client";

import { useEffect, useState } from "react";

import { session, type Session } from "@/lib/market";
import { AROUND_THE_CLOCK } from "@/lib/stocks";

/* "Market closed" stopped being the whole truth the day the pools started
 * pricing stocks out of hours. The exchange is still shut, and saying so is
 * right, but a visitor at midnight needs to know there is a fight to be had. */
const COPY: Record<Session, { text: string; tone: string }> = {
  open: { text: "Market open", tone: "text-up" },
  pre: { text: "Pre-market", tone: "text-ink" },
  after: { text: "After hours", tone: "text-ink" },
  closed: {
    text: AROUND_THE_CLOCK > 0 ? `Exchange shut · ${AROUND_THE_CLOCK} still fighting` : "Market closed",
    tone: AROUND_THE_CLOCK > 0 ? "text-up" : "text-dim",
  },
};

export function MarketBadge({ className = "" }: { className?: string }) {
  const [s, setS] = useState<Session | null>(null);
  useEffect(() => {
    const tick = () => setS(session());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  if (!s) return null;
  return (
    <span className={`label items-center gap-2 ${COPY[s].tone} ${className}`}>
      {s === "open" ? <span className="pulse-dot" /> : <span className="h-2 w-2 rounded-full bg-current" />}
      {COPY[s].text}
    </span>
  );
}
