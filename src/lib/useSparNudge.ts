"use client";

/* A CHALLENGE THE SPARRING WALLET WOULD TAKE ASKS TO BE TAKEN.
 *
 * While such a challenge is on screen, the page asks /api/spar to take it: at
 * once, then every 15 seconds until the chain says it was taken (the fight's
 * own poll moves its status on). The route does all the checking and answers
 * the same whoever asks, so this is only a nudge, like the settler nudge
 * beside it, and it stops while the tab is hidden. With no sparring wallet
 * configured it never runs.
 *
 * TWO KINDS NOW. One addressed to the sparring wallet, which it takes at once,
 * and one open to anyone that has gone unclaimed past SPAR_OPEN_GRACE_SECS,
 * which it sweeps up. Without the second, somebody who made an open challenge
 * sat watching their own page while the sweep waited on the next crank pass,
 * which is the wait the sweep was written to end. Its own seats are left out:
 * the route would refuse them, and asking every 15 seconds for a refusal is
 * just noise. */

import { useEffect } from "react";

import { isInviteOnly, STATUS_OPEN, type DuelView } from "./duel";
import { isSparWallet, SPAR_OPEN_GRACE_SECS } from "./spar";

const EVERY_MS = 15_000;

export function useSparNudge(d: DuelView | null | undefined, now: number) {
  const address = d?.address.toBase58();
  const sweepable =
    !!d && !isInviteOnly(d) && !isSparWallet(d.creator.toBase58()) && (!now || now - Number(d.createdTs) >= SPAR_OPEN_GRACE_SECS);
  const wanted =
    !!d &&
    d.status === STATUS_OPEN &&
    (isSparWallet(d.invitee.toBase58()) || sweepable) &&
    (!now || d.expiresTs > now);

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
