"use client";

import { useEffect, useState } from "react";

/** Unix seconds, ticking. Starts at 0 on the server render so hydration has
 *  nothing to reconcile; the first client tick fills it in. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
