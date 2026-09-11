"use client";

/* One fight, compact, for boards and lists. */

import Link from "next/link";

import { Move } from "@/components/Ticker";
import {
  OUTCOME_CREATOR,
  OUTCOME_OPPONENT,
  OUTCOME_TIE,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  STATUS_VOID,
  type DuelView,
} from "@/lib/duel";
import { clock, shares, shortAddress, span } from "@/lib/format";
import { movePct, stakeValue, type Quotes } from "@/lib/prices";
import { STAKE_DECIMALS, tickerForMint } from "@/lib/stocks";

export function FightRow({ d, now, quotes }: { d: DuelView; now: number; quotes?: Quotes }) {
  const t1 = tickerForMint(d.creatorMint) ?? "?";
  const t2 = tickerForMint(d.opponentMint) ?? "?";
  const q1 = quotes?.quotes[t1];
  const q2 = quotes?.quotes[t2];
  const v1 = stakeValue(d.creatorAmount, STAKE_DECIMALS, q1);

  let m1: number | null = null;
  let m2: number | null = null;
  if (d.status === STATUS_SETTLED || (d.status === STATUS_REFUNDED && d.creatorEnd.price > BigInt(0))) {
    m1 = movePct(d.creatorStart, d.creatorEnd);
    m2 = movePct(d.opponentStart, d.opponentEnd);
  } else if (d.status === STATUS_LIVE && q1 && q2) {
    m1 = movePct(d.creatorStart, q1);
    m2 = movePct(d.opponentStart, q2);
  }

  const status = statusLine(d, now);

  return (
    <Link
      href={`/f/${d.address.toBase58()}`}
      className="card group grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3 transition-colors hover:bg-panel-2"
    >
      <div className="flex items-baseline gap-3">
        <span className="display text-3xl text-p1">{t1}</span>
        {m1 !== null ? <Move value={m1} className="text-sm" /> : null}
        {d.status === STATUS_SETTLED && d.outcome === OUTCOME_OPPONENT ? (
          <span className="label !text-cooked">cooked</span>
        ) : null}
      </div>
      <div className="flex flex-col items-center">
        <span className="display text-lg text-ink">VS</span>
        <span className="label whitespace-nowrap">{status}</span>
      </div>
      <div className="flex items-baseline justify-end gap-3">
        {d.status === STATUS_SETTLED && d.outcome === OUTCOME_CREATOR ? (
          <span className="label !text-cooked">cooked</span>
        ) : null}
        {m2 !== null ? <Move value={m2} className="text-sm" /> : null}
        <span className="display text-3xl text-p2">{t2}</span>
      </div>
      <div className="col-span-3 flex justify-between text-xs text-dim">
        <span>
          {shortAddress(d.creator.toBase58())} · {shares(d.creatorAmount, STAKE_DECIMALS)} {t1}x
          {v1 ? ` (${v1 < 1 ? "<$1" : `$${v1.toFixed(0)}`})` : ""}
        </span>
        <span>
          {d.status === STATUS_OPEN ? "open to anyone" : shortAddress(d.opponent.toBase58())} ·{" "}
          {shares(d.opponentAmount, STAKE_DECIMALS)} {t2}x
        </span>
      </div>
    </Link>
  );
}

function statusLine(d: DuelView, now: number): string {
  switch (d.status) {
    case STATUS_OPEN:
      return now && d.expiresTs <= now ? "expired" : d.durationSecs ? `${span(d.durationSecs)} round` : "to the bell";
    case STATUS_ACCEPTED:
      return "locking prices";
    case STATUS_LIVE:
      return now && d.endTs > now ? clock(d.endTs - now) : "at the bell";
    case STATUS_SETTLED:
      return "final";
    case STATUS_VOID:
      return "void";
    case STATUS_REFUNDED:
      return d.outcome === OUTCOME_TIE ? "dead heat" : "refunded";
    default:
      return "";
  }
}

export { statusLine };
