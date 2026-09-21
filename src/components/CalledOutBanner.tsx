"use client";

/* SOMEBODY CALLED YOU OUT, ON EVERY PAGE UNTIL YOU ANSWER.
 *
 * A challenge addressed to one wallet is the most personal thing this site
 * does, and the person it named found out in three places at most: a toast if
 * their tab happened to be open at that moment, a number on the phone's Fights
 * tab, and a banner on /fights. On a desktop, on any other page, nothing. A
 * call-out nobody sees is a fight that never happens, and its maker waits on a
 * page that tells them nothing either.
 *
 * So while an open, unexpired challenge names the connected wallet, a slim bar
 * sits under the header on every page: who, which stocks, and the way in. It
 * needs no dismiss button and keeps no state, because the chain decides when it
 * goes: taken, expired or called off, and it is gone. It stays off the fight
 * page it points at, where the Take button already is.
 *
 * Reads the same duel list every board already polls, and only with a wallet. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";

import { calledOut, isRosterFight } from "@/lib/derive";
import { allDuels } from "@/lib/duel";
import { shortAddress } from "@/lib/format";
import { useDuels, useProfiles } from "@/lib/hooks";
import { tickerForMint } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";

export function CalledOutBanner() {
  const me = useWallet().publicKey?.toBase58() ?? null;
  const pathname = usePathname();
  const duels = useDuels("all", me ? allDuels() : null);
  const { data: handles } = useProfiles();
  const now = useNow(30_000);
  if (!me || !duels.data || !now) return null;

  const calls = calledOut(me, duels.data.filter(isRosterFight), now).sort((a, b) => a.expiresTs - b.expiresTs);
  const first = calls.find((d) => pathname !== `/f/${d.address.toBase58()}`);
  if (!first) return null;

  const from = first.creator.toBase58();
  const name = handles?.[from] ? `@${handles[from].replace(/^@/, "")}` : shortAddress(from);
  const pair = `${tickerForMint(first.creatorMint) ?? "?"} vs ${tickerForMint(first.opponentMint) ?? "?"}`;
  const more = calls.length - 1;

  return (
    <div role="status" className="rope border-b border-line bg-panel-2">
      <p className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm text-ink">
        <span className="min-w-0">
          <span className="font-semibold normal-case">{name}</span> called you out: {pair}.
          {more > 0 ? <span className="text-dim"> And {more} more.</span> : null}
        </span>
        <Link href={`/f/${first.address.toBase58()}`} className="btn btn-sm btn-p2 shrink-0">
          Answer it
        </Link>
        {more > 0 ? (
          <Link href="/fights?tab=called" className="link shrink-0 text-meta">
            See all
          </Link>
        ) : null}
      </p>
    </div>
  );
}
