"use client";

/* THE NEXT FIGHT, BY NAME, WHERE A ROUND ENDS (lib/nextSeat.ts says which).
 *
 * "NVDA vs AMD · $25 a side · Take it" as a button that goes straight to a
 * seat this wallet can take this second, preferring one it can already stake.
 * Rendered on a finished fight above the rematch, and as a quiet row during a
 * live round, when a fighter has fifteen minutes and nothing to do.
 *
 * It reads the same duel list every board already polls (one cached query),
 * and renders nothing when no seat qualifies, so the rematch stands alone as
 * it did before. */

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";

import { cx } from "@/components/ui/cx";
import { allDuels, type DuelView } from "@/lib/duel";
import { usd } from "@/lib/format";
import { useDuels } from "@/lib/hooks";
import { nextSeat } from "@/lib/nextSeat";
import { stakeValue, usePrices } from "@/lib/prices";
import { decimalsForMint, mixedHoursAt, tickerForMint } from "@/lib/stocks";
import { useHoldings } from "@/lib/useHoldings";

const blocked = (d: DuelView, now: number) =>
  mixedHoursAt(tickerForMint(d.creatorMint) ?? "?", tickerForMint(d.opponentMint) ?? "?", now, d, "taker");

export function NextSeat({
  except,
  now,
  variant = "primary",
  className,
}: {
  /** The fight this sits on, which is never its own next seat. */
  except: string;
  now: number;
  /** "primary": the big button on a finished fight. "quiet": a row during a live round. */
  variant?: "primary" | "quiet";
  className?: string;
}) {
  const me = useWallet().publicKey?.toBase58() ?? null;
  const duels = useDuels("all", allDuels());
  const holdings = useHoldings(me, !!me);

  const holds = (d: DuelView) => {
    const t = tickerForMint(d.opponentMint);
    const h = holdings.valued.find((x) => x.ticker === t);
    return !!h && h.raw >= d.opponentAmount;
  };
  const pick = nextSeat(duels.data ?? [], { wallet: me, now, except, holds, blocked });

  const t1 = pick ? (tickerForMint(pick.duel.creatorMint) ?? "?") : null;
  const t2 = pick ? (tickerForMint(pick.duel.opponentMint) ?? "?") : null;
  const prices = usePrices([t1]);
  if (!pick || !t1 || !t2) return null;

  const v = stakeValue(pick.duel.creatorAmount, decimalsForMint(pick.duel.creatorMint), prices.data?.quotes[t1]);
  const stake = v !== null && Number.isFinite(v) ? ` · ${usd(Math.max(1, Math.round(v)), { cents: false })} a side` : "";
  const href = `/f/${pick.duel.address.toBase58()}`;

  if (variant === "quiet") {
    return (
      <p className={cx("text-meta text-dim", className)}>
        While you wait:{" "}
        <Link href={href} className="link">
          take {t2} against {t1}
          <span className="num">{stake}</span>
        </Link>
      </p>
    );
  }
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      {/* One span: a button is a flex row, and two children became two columns
        * on a phone ("NEXT FIGHT: AAPL VS" beside "· $25 A"). */}
      <Link href={href} className="btn btn-p2 w-full">
        <span>
          Next fight: {t1} vs {t2}
          <span className="num whitespace-nowrap">{stake}</span>
        </span>
      </Link>
      <p className="text-meta text-dim">
        {pick.holdsStake ? `Open now, and you already hold the ${t2} to stake.` : `Open now. You would back ${t2}.`}
      </p>
    </div>
  );
}
