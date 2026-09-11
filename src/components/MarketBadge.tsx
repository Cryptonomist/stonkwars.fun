"use client";

import { useEffect, useState } from "react";

import { session, type Session } from "@/lib/market";

const COPY: Record<Session, { text: string; tone: string }> = {
  open: { text: "Market open", tone: "text-up" },
  pre: { text: "Pre-market", tone: "text-gold" },
  after: { text: "After hours", tone: "text-gold" },
  closed: { text: "Market closed", tone: "text-dim" },
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
