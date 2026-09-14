"use client";

/* ONE CORNER OF THE ARENA: who, what stock, how much, and the price to beat.
 *
 *   role      Challenger, Answered, Open seat, or "For" the one wallet that may take it
 *   ticker    the biggest type on the page, in the side's colour; the loser's
 *             at half strength, and never under the stamp
 *   fighter   their name (a vouched X handle or the wallet) and their record
 *   stake     shares in the token's own case, and what they are worth
 *   price     PriceToBeat: the start, now or the bell, and the move
 *   result    the winner's green plate with the money taken; the loser's
 *             COOKED stamp, slammed onto the stake and the move, away from the
 *             centre, so the ticker stays readable
 *
 * During a live round the corner that is ahead glows in its own colour: the
 * one light on the page that is allowed to be on, because it is real and it
 * is now.
 *
 * ON A PHONE BOTH CORNERS SHARE ONE ROW (Versus pairBelow). Stacked, the arena
 * ran 886px tall and a spectator saw one side's move, or a winner's whole
 * corner, only after scrolling. So below 768px a corner is about 145px wide:
 * a 40px ticker, no company name, the small fighter name, a meta-size stake,
 * the stamp at text-xl and the Took plate as dollars only. The right corner
 * mirrors the left at every width. */

import { useMemo } from "react";

import { Damage } from "@/components/FightFx";
import { cx } from "@/components/ui/cx";
import { FighterName } from "@/components/ui/FighterName";
import { recordFor, loserTake } from "@/lib/derive";
import {
  allDuels,
  OUTCOME_CREATOR,
  OUTCOME_OPPONENT,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  hasOpponent,
  isInviteOnly,
  type DuelView,
} from "@/lib/duel";
import type { Hit } from "@/lib/fightFeel";
import { pythToNumber, shares, usd } from "@/lib/format";
import { useDuels } from "@/lib/hooks";
import { isSparWallet } from "@/lib/spar";
import { stakeValue, type Quote } from "@/lib/prices";
import { byTicker, decimalsForMint, tokenSymbol } from "@/lib/stocks";

import { PriceToBeat } from "./PriceToBeat";

export function Corner({
  d,
  side,
  ticker,
  quote,
  shut,
  leading,
  hits,
  hurt,
  late = false,
  other = null,
}: {
  /** The other corner's move, so two close moves print differently. */
  other?: number | null;
  d: DuelView;
  side: "p1" | "p2";
  ticker: string;
  quote?: Quote;
  shut: boolean;
  /** Ahead in a live round, by the live moves. */
  leading: boolean;
  hits: Hit[];
  hurt: boolean;
  /** roundClock(...).manual is set: the settler has missed its window. */
  late?: boolean;
}) {
  const right = side === "p2";
  const p1 = side === "p1";
  const wallet = p1 ? d.creator.toBase58() : hasOpponent(d) ? d.opponent.toBase58() : null;
  const amount = p1 ? d.creatorAmount : d.opponentAmount;
  const mint = p1 ? d.creatorMint : d.opponentMint;
  const decimals = decimalsForMint(mint);
  const settled = d.status === STATUS_SETTLED;
  const won = settled && d.outcome === (p1 ? OUTCOME_CREATOR : OUTCOME_OPPONENT);
  const cooked = settled && d.outcome === (p1 ? OUTCOME_OPPONENT : OUTCOME_CREATOR);

  /* The stake's worth: at the price the program ended it on once there is one,
   * which is what it was worth when it changed hands, and otherwise now. */
  const end = p1 ? d.creatorEnd : d.opponentEnd;
  const worth =
    (settled || d.status === STATUS_REFUNDED) && end.price > BigInt(0)
      ? (Number(amount) / 10 ** decimals) * pythToNumber(end.price, end.expo)
      : stakeValue(amount, decimals, quote);

  const take = won ? loserTake(d) : null;

  return (
    <div
      className={cx(
        "relative flex min-w-0 flex-col p-1 transition-shadow md:p-3",
        right && "items-end text-right",
        hurt && "hit-flash",
        leading && (p1 ? "shadow-glow-p1" : "shadow-glow-p2"),
      )}
    >
      <Damage hits={hits} side={side} />
      {/* On a phone the record rides the role line: beside the fighter's name
        * in a 145px corner it cut the address itself down to "37ae...R". */}
      <div className={cx("flex min-w-0 max-w-full items-baseline gap-2", right && "flex-row-reverse")}>
        <Role d={d} side={side} />
        {wallet ? (
          <span className="md:hidden">
            <Record wallet={wallet} />
          </span>
        ) : null}
      </div>
      <span
        className={cx(
          /* 40px on a phone, where the corners share one row; 64px from 640px,
           * and 88px from 1024px, when each corner has a third of a wide arena. */
          "display mt-1 max-w-full truncate text-hud-md sm:text-hud-xl-phone lg:text-hud-xl",
          p1 ? "text-p1" : "text-p2",
          cooked && "opacity-50",
        )}
      >
        {ticker}
      </span>
      <span className="mt-1 hidden max-w-full truncate text-meta text-dim sm:block">
        {byTicker(ticker)?.name ?? "Not a listed stock"}
      </span>

      <div className={cx("mt-2 flex min-h-6 min-w-0 max-w-full items-center gap-2 md:mt-3", right && "flex-row-reverse")}>
        {wallet ? (
          <>
            <span className="contents md:hidden">
              <FighterName wallet={wallet} size="sm" />
            </span>
            <span className="hidden md:contents">
              <FighterName wallet={wallet} size="md" />
              <Record wallet={wallet} />
            </span>
          </>
        ) : (
          <span className="text-meta text-dim md:text-sm">
            {isSparWallet(d.invitee.toBase58()) ? "Waiting for the sparring wallet" : "Waiting for a taker"}
          </span>
        )}
      </div>

      {/* The stake and the move: the block the COOKED stamp lands on. */}
      <div className={cx("relative mt-2 flex min-w-0 max-w-full flex-col gap-1.5 md:mt-3 md:gap-2", right && "items-end")}>
        <p className="num text-meta text-ink md:text-sm">
          {shares(amount, decimals)} <span className="normal-case">{tokenSymbol(ticker)}</span>
          {worth !== null ? <span className="text-dim"> · {usd(worth)}</span> : null}
        </p>
        <PriceToBeat d={d} side={side} quote={quote} shut={shut} late={late} other={other} />
      </div>

      {/* The loser's stamp lands where the winner's plate sits, right under the
        * stake and the move, on the corner's outer edge. Laid over the numbers
        * it hid the very prices that lost, and over the ticker it hid who lost,
        * so it takes a place of its own. */}
      {cooked ? (
        <span aria-hidden="true" className={cx("mt-3 inline-block w-fit md:mt-4", right ? "mr-1" : "ml-1")}>
          <span className="stamp-cooked pointer-events-none inline-block text-xl md:text-3xl lg:text-4xl">Cooked</span>
        </span>
      ) : null}
      {cooked ? <span className="sr-only">Cooked: this side lost at the bell.</span> : null}

      {take ? (
        <div className={cx("mt-3 flex flex-col gap-1 md:mt-4", right && "items-end")}>
          <p className="plate-win num w-fit text-sm font-semibold">
            Took{" "}
            <span className="hidden md:inline">
              {shares(take.shares, take.decimals)} <span className="normal-case">{tokenSymbol(take.ticker)}</span> ·{" "}
            </span>
            {usd(take.usd)}
          </p>
          <p className="hidden text-meta text-dim md:block">plus their own stake back</p>
        </div>
      ) : null}
    </div>
  );
}

function Role({ d, side }: { d: DuelView; side: "p1" | "p2" }) {
  if (side === "p1") return <span className="label">Challenger</span>;
  if (hasOpponent(d)) return <span className="label">Answered</span>;
  if (isInviteOnly(d)) {
    return (
      <span className="label inline-flex min-w-0 max-w-full items-center gap-2">
        For <FighterName wallet={d.invitee.toBase58()} size="sm" className="normal-case tracking-normal" />
      </span>
    );
  }
  return <span className="label">Open seat</span>;
}

/* The fighter's record over every listed fight with a result. The duel list is
 * the one every board already polls, so this costs no extra read. */
function Record({ wallet }: { wallet: string }) {
  const duels = useDuels("all", allDuels());
  const record = useMemo(() => (duels.data ? recordFor(wallet, duels.data) : null), [duels.data, wallet]);
  if (!record || record.fights === 0) return null;
  return (
    <span className="micro num shrink-0 text-dim" title={`${record.wins} wins, ${record.losses} losses${record.ties ? `, ${record.ties} dead heats` : ""}`}>
      {record.wins}W-{record.losses}L
    </span>
  );
}
