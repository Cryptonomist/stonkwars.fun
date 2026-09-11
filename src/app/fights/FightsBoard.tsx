"use client";

import Link from "next/link";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { FightRow } from "@/components/FightRow";
import {
  allDuels,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  STATUS_VOID,
  type DuelView,
} from "@/lib/duel";
import { useDuels } from "@/lib/hooks";
import { usePrices } from "@/lib/prices";
import { useNow } from "@/lib/useNow";

type Tab = "open" | "live" | "final" | "mine";

export function FightsBoard() {
  const [tab, setTab] = useState<Tab>("open");
  const duels = useDuels("all", allDuels());
  const prices = usePrices();
  const now = useNow();
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58();

  const all = duels.data ?? [];
  const lists: Record<Tab, DuelView[]> = {
    open: all.filter((d) => d.status === STATUS_OPEN && (!now || d.expiresTs > now)),
    live: all.filter((d) => d.status === STATUS_LIVE || d.status === STATUS_ACCEPTED),
    final: all
      .filter((d) => d.status === STATUS_SETTLED || d.status === STATUS_REFUNDED || d.status === STATUS_VOID)
      .sort((a, b) => b.endTs - a.endTs),
    mine: me ? all.filter((d) => d.creator.toBase58() === me || d.opponent.toBase58() === me) : [],
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: "open", label: `Open (${lists.open.length})` },
    { id: "live", label: `Live (${lists.live.length})` },
    { id: "final", label: "Final" },
    { id: "mine", label: "Mine" },
  ];

  const list = lists[tab];

  return (
    <div className="py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">The ring</p>
          <h1 className="display mt-2 text-6xl sm:text-7xl">Fights</h1>
        </div>
        <Link href="/new" className="btn btn-p1">
          Pick a fight
        </Link>
      </div>

      <div className="mt-8 flex gap-2 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 font-display text-lg font-extrabold uppercase ${
              tab === t.id ? "border-p2 text-ink" : "border-transparent text-dim hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {duels.isLoading ? (
          <p className="text-dim">Reading the chain...</p>
        ) : tab === "mine" && !me ? (
          <p className="text-dim">Connect a wallet to see your fights.</p>
        ) : list.length === 0 ? (
          <p className="text-dim">
            {tab === "open" ? "No open challenges. Start one." : tab === "live" ? "Nothing live right now." : "Nothing here yet."}
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {list.slice(0, 60).map((d) => (
              <FightRow key={d.address.toBase58()} d={d} now={now} quotes={prices.data} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
