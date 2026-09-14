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
import { watchedFights } from "@/components/ui/intents";
import { allDuels, type DuelView } from "@/lib/duel";
import { useDuels } from "@/lib/hooks";
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

  useEffect(() => {
    if (!data) return;
    if (!known.current) {
      known.current = new Map(data.map((d) => [d.address.toBase58(), d]));
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    /* Read the list fresh here too: the route effect above runs after this one
     * on the same render when both change at once. */
    const following = watchedFights();
    const notices = diffFights([...known.current.values()], data, me, following, now);
    for (const d of data) known.current.set(d.address.toBase58(), d);

    const open = pathname?.startsWith("/f/") ? pathname.slice(3).split(/[/?#]/)[0] : null;
    for (const n of notices) {
      if (said.current.has(n.id)) continue;
      said.current.add(n.id);
      if (open && n.href === `/f/${open}`) continue;
      toast.push({ title: n.title, tone: n.tone, href: n.href, hrefLabel: "Open the fight" });
    }
  }, [data, me, pathname]);

  return null;
}
