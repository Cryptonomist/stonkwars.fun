"use client";

/* The toasts about your own fights, and fights you opened.
 *
 * Renders nothing. It reads the same duel list every board already polls,
 * compares each read with what it knew before (lib/watcher), and pushes a
 * toast for every real change: taken, live, the bell, a dead heat, a call-out.
 *
 * It only reads while there is someone to tell: a connected wallet, or a
 * viewer who has opened at least one fight page. What it knows is kept as a
 * map of every fight seen so far rather than just the last read, so an RPC
 * answer that briefly leaves a fight out cannot make it look new the next
 * time, and a call-out is never announced twice.
 *
 * The fight whose page is open says its own news in its own arena, so its
 * toasts are skipped. */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";

import { toast } from "@/components/ui/Toast";
import { lastSeen, markSeen, markTold, toldNotices, watchedFights } from "@/components/ui/intents";
import { allDuels, type DuelView } from "@/lib/duel";
import { useDuels } from "@/lib/hooks";
import { sinceLastVisit } from "@/lib/sinceLastVisit";
import { diffFights } from "@/lib/watcher";

export function FightWatcher() {
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58() ?? null;
  const pathname = usePathname();

  /* The watched list lives in localStorage, and a fight page adds to it on
   * mount, so read it again whenever the route changes. */
  const [watched, setWatched] = useState<string[]>([]);
  useEffect(() => {
    setWatched(watchedFights());
  }, [pathname]);

  const enabled = !!me || watched.length > 0;
  const { data } = useDuels("all", enabled ? allDuels() : null);

  const known = useRef<Map<string, DuelView> | null>(null);
  const said = useRef(new Set<string>());
  const digestedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const now = Math.floor(Date.now() / 1000);
    /* ONCE PER WALLET, WHENEVER IT FIRST SHOWS UP. A list seen for the first
     * time has no "before", except the one this browser kept: when the wallet
     * was last here. So say what happened since: the bell that rang overnight,
     * the call-out that arrived, the challenge somebody took
     * (lib/sinceLastVisit.ts). Keyed to the wallet rather than to the first
     * read, because a wallet usually connects a moment after the page loads.
     * These stay up longer than a live toast: they are why the visit is worth it. */
    if (me && digestedFor.current !== me) {
      digestedFor.current = me;
      const digest = sinceLastVisit(data, me, lastSeen(me), now, toldNotices());
      for (const n of digest) {
        said.current.add(n.id);
        toast.push({ title: n.title, tone: n.tone, href: n.href, hrefLabel: "Open the fight", ttlMs: 20_000 });
      }
      markTold(digest.map((n) => n.id));
      markSeen(me, now);
    }
    if (!known.current) {
      known.current = new Map(data.map((d) => [d.address.toBase58(), d]));
      return;
    }
    /* Read the list fresh here too: the route effect above runs after this one
     * on the same render when both change at once. */
    const following = watchedFights();
    const notices = diffFights([...known.current.values()], data, me, following, now);
    for (const d of data) known.current.set(d.address.toBase58(), d);

    const open = pathname?.startsWith("/f/") ? pathname.slice(3).split(/[/?#]/)[0] : null;
    for (const n of notices) {
      if (said.current.has(n.id)) continue;
      said.current.add(n.id);
      markTold([n.id]);
      if (open && n.href === `/f/${open}`) continue;
      const called = n.id.endsWith(":called");
      toast.push({
        title: n.title,
        tone: n.tone,
        href: n.href,
        hrefLabel: called ? "Answer it" : "Open the fight",
        ...(called ? { ttlMs: 0 } : {}),
      });
    }
  }, [data, me, pathname]);

  /* "Last here" is the moment the tab was last left, not the moment it was
   * opened: a fight that ends while the tab sits in the background is news on
   * return. Written on hide and on unload, and once a minute while visible so
   * a crash or a killed phone tab loses little. */
  useEffect(() => {
    if (!me) return;
    const mark = () => markSeen(me);
    const onHide = () => {
      if (document.visibilityState === "hidden") mark();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", mark);
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") mark();
    }, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", mark);
      window.clearInterval(tick);
    };
  }, [me]);

  return null;
}
