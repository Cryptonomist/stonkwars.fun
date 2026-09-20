"use client";

/* YOUR CORNER: THE FRONT PAGE, FOR THE WALLET THAT IS CONNECTED.
 *
 * Nothing on the front page knew who was looking. A fighter with a round live,
 * a call-out waiting and a win from last night saw exactly what a stranger
 * saw, and had to go and find their own fights. This is one strip under the
 * main event that answers "what is mine, right now":
 *
 *   call-outs waiting for this wallet        (the thing most worth a tap)
 *   their rounds that are live, with the clock
 *   their fights that are taken and waiting for a start
 *   their latest result, if it is from the last day, with the way back in
 *   their record and rank, so the number they are chasing is on the page
 *
 * and when none of that exists yet, the next seat they could take.
 *
 * All of it is read from the duel list every board already polls, so it is the
 * same on any device and cannot disagree with the chain. It renders nothing
 * without a wallet, and nothing until the list has loaded: a strip that flashes
 * "no fights" before the fights arrive would be worse than no strip. */

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";

import { NextSeat } from "@/components/NextSeat";
import { Badge } from "@/components/ui/Badge";
import { Countdown } from "@/components/ui/Countdown";
import { Plate } from "@/components/ui/Plate";
import { calledOut, isDecided, isRosterFight, loserTake, recordFor } from "@/lib/derive";
import { allDuels, OUTCOME_CREATOR, STATUS_ACCEPTED, STATUS_LIVE, type DuelView } from "@/lib/duel";
import { ago, usd } from "@/lib/format";
import { useDuels } from "@/lib/hooks";
import { rankFighters } from "@/lib/leaderboard";
import { isSparWallet } from "@/lib/spar";
import { STAKE_DECIMALS, tickerForMint } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";

const DAY = 86_400;
const pairOf = (d: DuelView) => `${tickerForMint(d.creatorMint) ?? "?"} vs ${tickerForMint(d.opponentMint) ?? "?"}`;

export function YourCorner() {
  const me = useWallet().publicKey?.toBase58() ?? null;
  const duels = useDuels("all", me ? allDuels() : null);
  const now = useNow(1_000);
  if (!me || !duels.data || !now) return null;

  const all = duels.data.filter(isRosterFight);
  const mine = all.filter((d) => d.creator.toBase58() === me || d.opponent.toBase58() === me);
  const calls = calledOut(me, all, now);
  const live = mine.filter((d) => d.status === STATUS_LIVE && d.endTs > now).sort((a, b) => a.endTs - b.endTs);
  const waiting = mine.filter((d) => d.status === STATUS_ACCEPTED);
  const last = mine.filter((d) => isDecided(d) && now - d.endTs < DAY).sort((a, b) => b.endTs - a.endTs)[0];

  const record = recordFor(me, all);
  const ranked = rankFighters(all, STAKE_DECIMALS).filter((r) => !isSparWallet(r.wallet));
  const rank = ranked.findIndex((r) => r.wallet === me) + 1;

  const nothingYet = !calls.length && !live.length && !waiting.length && !last;

  let result: React.ReactNode = null;
  if (last) {
    const iWon = (last.outcome === OUTCOME_CREATOR ? last.creator : last.opponent).toBase58() === me;
    const take = loserTake(last);
    result = (
      <Link href={`/f/${last.address.toBase58()}`} className="row -mx-2 flex min-h-10 min-w-0 items-center gap-2 px-2">
        {iWon ? <Badge variant="win">W</Badge> : <Badge variant="cooked" />}
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          {pairOf(last)}
          {iWon && take?.usd ? <span className="num text-up"> · took {usd(take.usd)}</span> : null}
          {!iWon ? <span className="text-dim"> · run it back</span> : null}
        </span>
        <span className="shrink-0 text-meta text-dim">{ago(last.endTs, now)}</span>
      </Link>
    );
  }

  return (
    <Plate as="section" rope pad="std" className="flex flex-col gap-2" aria-labelledby="your-corner">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="your-corner" className="h-section">
          Your corner
        </h2>
        <Link href={`/u/${me}`} className="num text-meta text-dim transition-colors hover:text-ink">
          {record.fights > 0 ? `${record.wins}W ${record.losses}L` : "No fights yet"}
          {rank > 0 ? ` · #${rank} of ${ranked.length}` : ""}
        </Link>
      </div>

      {calls.map((d) => (
        <Link key={d.address.toBase58()} href={`/f/${d.address.toBase58()}`} className="row -mx-2 flex min-h-10 min-w-0 items-center gap-2 px-2">
          <Badge>Called out</Badge>
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{pairOf(d)}</span>
          <span className="shrink-0 text-meta text-dim">answer it</span>
        </Link>
      ))}
      {live.map((d) => (
        <Link key={d.address.toBase58()} href={`/f/${d.address.toBase58()}`} className="row -mx-2 flex min-h-10 min-w-0 items-center gap-2 px-2">
          <Badge variant="live" />
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{pairOf(d)}</span>
          <Countdown to={d.endTs} now={now} className="shrink-0 text-sm text-ink" />
        </Link>
      ))}
      {waiting.map((d) => (
        <Link key={d.address.toBase58()} href={`/f/${d.address.toBase58()}`} className="row -mx-2 flex min-h-10 min-w-0 items-center gap-2 px-2">
          <Badge>Taken</Badge>
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{pairOf(d)}</span>
          <span className="shrink-0 text-meta text-dim">starts at the next price</span>
        </Link>
      ))}
      {result}

      {/* With nothing of theirs on the board, or only a finished fight, the way
        * back in is a seat that can be taken this second. */}
      {nothingYet || (last && !live.length && !calls.length) ? <NextSeat except="" now={now} className="mt-1" /> : null}
    </Plate>
  );
}
