"use client";

/* A CHALLENGE ADDRESSED TO THE SPARRING WALLET ASKS TO BE TAKEN.
 *
 * While an open challenge naming the sparring wallet is on screen, the page
 * asks /api/spar to take it: at once, then every 15 seconds until the chain
 * says it was taken (the fight's own poll moves its status on). The route does
 * all the checking and answers the same whoever asks, so this is only a nudge,
 * like the settler nudge beside it, and it stops while the tab is hidden. With
 * no sparring wallet configured it never runs. */

import { useEffect } from "react";

import { STATUS_OPEN, type DuelView } from "./duel";
import { isSparWallet } from "./spar";

const EVERY_MS = 15_000;

export function useSparNudge(d: DuelView | null | undefined, now: number) {
  const address = d?.address.toBase58();
  const wanted = !!d && d.status === STATUS_OPEN && isSparWallet(d.invitee.toBase58()) && (!now || d.expiresTs > now);

  useEffect(() => {
    if (!wanted || !address) return;
    let stopped = false;
    const ask = () => {
      if (stopped || document.hidden) return;
      fetch("/api/spar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ duel: address }),
      }).catch(() => {
        /* The next ask, or the owner's cron, picks it up. */
      });
    };
    ask();
    const id = setInterval(ask, EVERY_MS);
    const onVisible = () => {
      if (!document.hidden) ask();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [wanted, address]);
}
