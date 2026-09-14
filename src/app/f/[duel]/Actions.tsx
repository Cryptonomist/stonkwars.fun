"use client";

/* WHAT THIS VIEWER CAN DO NEXT, and why they cannot when they cannot.
 *
 * One primary action, which follows the wallet: not connected, "Connect to take
 * it"; connected but short of the stock on a test cluster, the faucet for that
 * stock; ready, "Take it". Everything else is secondary: calling a challenge
 * off, sending stakes home, and posting the prices yourself when the settler is
 * late. Every transaction goes through TxButton, which links the signature the
 * moment it exists and says honestly how long the chain took.
 *
 * THE GATES STAY WHERE THE SETTLER AND HOURS FIXES PUT THEM.
 *
 *   Take       disabled with mixedHoursAt's sentence while the two sides would
 *              be priced at different openings, judged for a taker at this
 *              moment, and asked again with Date.now() at the click, because
 *              the render's clock can be seconds old.
 *   Manual     "Lock the start prices yourself" and "Settle it yourself" only
 *              when roundClock(...).manual says the settler is late: 180
 *              seconds after the price could exist, never at the boundary, and
 *              never while the market that prices a side is shut.
 *   Shut       the hints name who prices each waiting side, Pyth or the
 *              exchange, and when it reopens (firstPriceAt).
 *
 * On a phone, an open challenge this viewer can take also gets a bar fixed
 * above the bottom nav with the pair, the stake and the primary action, so the
 * next step is under the thumb wherever the page is scrolled. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { useFaucet } from "@/components/FaucetButton";
import { Notice } from "@/components/ui/Notice";
import { Plate } from "@/components/ui/Plate";
import { TxButton } from "@/components/ui/TxButton";
import { cx } from "@/components/ui/cx";
import { requestConnect, unwatchFight, watchedFights, watchFight } from "@/components/ui/intents";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  ataFor,
  buildAcceptDuel,
  buildCancelDuel,
  buildRefundDuel,
  hasOpponent,
  isInviteOnly,
  OUTCOME_CREATOR,
  OUTCOME_OPPONENT,
  OUTCOME_TIE,
  START_DELAY_SECS,
  STALL_REFUND_SECS,
  STATUS_ACCEPTED,
  STATUS_LIVE,
  STATUS_OPEN,
  STATUS_REFUNDED,
  STATUS_SETTLED,
  STATUS_VOID,
  type DuelView,
} from "@/lib/duel";
import { shares, shortAddress, usd } from "@/lib/format";
import { useProfiles, useSend, useTokenBalance } from "@/lib/hooks";
import { roundClock, shutSides } from "@/lib/roundClock";
import { byTicker, CLUSTER, decimalsForMint, firstPriceAt, mixedHoursAt, openingWords, tokenSymbol } from "@/lib/stocks";
import { useNudgeStatus } from "@/lib/useSettlerNudge";

/** Whether `me` may take this challenge now: open, unexpired, not their own,
 *  and either open to anyone or naming them. */
export function canTakeFight(d: DuelView, me: string | undefined, now: number): boolean {
  const expired = now > 0 && d.expiresTs <= now;
  const isCreator = me === d.creator.toBase58();
  return d.status === STATUS_OPEN && !expired && !isCreator && (!isInviteOnly(d) || d.invitee.toBase58() === me);
}

export function Actions({
  d,
  now,
  t1,
  t2,
  stakeUsd,
  className,
}: {
  d: DuelView;
  now: number;
  t1: string;
  t2: string;
  /** What the challenger's stake is worth now, for sizing a rematch and the phone bar. */
  stakeUsd: number | null;
  className?: string;
}) {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const { connection } = useConnection();
  const send = useSend();
  const { data: handles } = useProfiles();

  const me = publicKey?.toBase58();
  const isCreator = me === d.creator.toBase58();
  const mySource = publicKey ? ataFor(publicKey, d.opponentMint, d.opponentTokenProgram) : null;
  const balance = useTokenBalance(d.status === STATUS_OPEN && !isCreator ? mySource : null);
  const nudge = useNudgeStatus(d.address.toBase58());

  const expired = now > 0 && d.expiresTs <= now;
  const canTake = canTakeFight(d, me, now);
  const short = balance.data !== undefined && (balance.data === null || balance.data < d.opponentAmount);
  const testCluster = CLUSTER !== "mainnet-beta";
  const stake2 = `${shares(d.opponentAmount, decimalsForMint(d.opponentMint))}`;
  const symbol2 = tokenSymbol(t2);

  /* Taking starts the round, so the hours that matter are this moment's, and
   * the end's that follow from it. A challenge picked while both sides traded
   * can be opened again after one exchange shuts, and taking it then would
   * start the two sides days apart. It stays takeable once the hours line up
   * again, and the sentence says when. This is the render's clock, which can
   * be seconds old, so the take asks again at the click. */
  const mixedHours = canTake && now ? mixedHoursAt(t1, t2, now, d, "taker") : null;
  const take = async (onSent: (sig: string) => void) => {
    if (mixedHoursAt(t1, t2, Math.floor(Date.now() / 1000), d, "taker")) {
      // The notice above says why, and when it can be taken; nothing was sent.
      throw new Error("The two markets stopped lining up just now, so nothing was sent.");
    }
    return send([buildAcceptDuel(d, publicKey!)], onSent);
  };

  const crank = (which: "start" | "settle") => async () => {
    if (!publicKey || !signTransaction || !signAllTransactions) {
      throw new Error("Connect a wallet to post the prices yourself.");
    }
    const { crankFromBrowser } = await import("@/lib/pythCrank");
    return crankFromBrowser({ connection, wallet: { publicKey, signTransaction, signAllTransactions }, which, duel: d });
  };

  /* While the market that prices a side is shut, its next price does not exist
   * yet, so neither the settler nor anyone else can lock a start or an end. A
   * button then only leads to a wallet popup and a failed request, right under
   * the status line that says the fight is waiting. The price clock decides it,
   * for the fight's own boundary (shutSides in roundClock.ts). */
  const shut = shutSides(d, now);
  const waiting = shut.length > 0;
  /* The manual buttons wait for the price clock's readyAt plus
   * MANUAL_FALLBACK_SECS (roundClock.ts), by when the page nudge and the cron
   * have both had several goes, so something really is late. */
  const manual = roundClock(d, now, nudge).manual;
  const startDue = d.status === STATUS_ACCEPTED && !waiting && manual?.which === "start";
  const settleDue = d.status === STATUS_LIVE && !waiting && manual?.which === "settle";
  const stalled =
    (d.status === STATUS_ACCEPTED && now >= d.acceptedTs + STALL_REFUND_SECS) ||
    (d.status === STATUS_LIVE && now >= d.endTs + STALL_REFUND_SECS);

  /* ── The primary action ─────────────────────────────────────────────── */

  const iFought = isCreator || (hasOpponent(d) && me === d.opponent.toBase58());
  const symbol1 = tokenSymbol(t1);
  const stake1 = shares(d.creatorAmount, decimalsForMint(d.creatorMint));

  /* WHAT THE TAKER WINS, said before they stake, the way the ticket on /new
   * says it for the challenger: their own shares back plus the challenger's,
   * valued at the challenger's live price. */
  const winLine = canTake ? (
    <>
      If you win: your {stake2} {symbol2} back plus their {stake1} {symbol1}
      {stakeUsd !== null ? <> (worth {usd(stakeUsd)} now)</> : null}.
    </>
  ) : null;

  let primary: React.ReactNode = null;
  /** The one button the phone bar carries, when it is not `primary` itself. */
  let barAction: React.ReactNode = null;
  if (canTake) {
    const takeButton = (
      <TxButton
        run={take}
        disabled={short || !!mixedHours}
        successTitle={`You took it. ${t1} vs ${t2} is on.`}
        className="btn-p2 w-full"
        label={
          short ? (
            <>
              Get <span className="normal-case">{symbol2}</span> first
            </>
          ) : (
            <>
              Take it · stake {stake2} <span className="normal-case">{symbol2}</span>
            </>
          )
        }
      />
    );
    if (!publicKey) {
      primary = (
        <button type="button" onClick={requestConnect} className="btn btn-light w-full">
          Connect to take it
        </button>
      );
    } else if (testCluster) {
      /* TWO STEPS, BOTH IN SIGHT. A wallet without the stock used to see only
       * "Get test HOODx" and two notices, so nobody could tell a second step
       * existed or what it was for. Now the take button is always there, step
       * two, disabled with the reason until step one is done, and step one
       * turns into a checked line once the shares have arrived. */
      const has = balance.data !== undefined && balance.data !== null && balance.data >= d.opponentAmount;
      primary = (
        <ol className="flex flex-col gap-2" aria-label="Two steps to take it">
          <li className="flex min-w-0 items-center gap-3">
            <span className="micro num w-3 shrink-0 text-dim" aria-hidden="true">
              1
            </span>
            <div className="min-w-0 flex-1">
              {balance.data === undefined ? (
                <Skeleton className="h-10 w-full" />
              ) : has ? (
                <p className="flex h-10 items-center gap-2 text-sm text-ink">
                  <span aria-hidden="true">&#10003;</span>
                  <span className="sr-only">Done: </span>
                  You have {shares(balance.data!, decimalsForMint(d.opponentMint))} {symbol2}
                </p>
              ) : (
                <FaucetPrimary ticker={t2} symbol={symbol2} />
              )}
            </div>
          </li>
          <li className="flex min-w-0 items-center gap-3">
            <span className="micro num w-3 shrink-0 text-dim" aria-hidden="true">
              2
            </span>
            <div className="min-w-0 flex-1">{takeButton}</div>
          </li>
        </ol>
      );
      barAction = short ? <FaucetPrimary ticker={t2} symbol={symbol2} /> : takeButton;
    } else {
      primary = takeButton;
    }
  } else if (d.status === STATUS_LIVE && !iFought) {
    /* A SPECTATOR'S NEXT MOVE. Somebody watching a round had one sentence of
     * rules here and nothing to do. The two things a watcher wants are this
     * same fight for themselves, at this stake, and word of how it ends. */
    primary = (
      <>
        <Link href={`/new?p1=${t1}&p2=${t2}&usd=${Math.max(1, Math.round(stakeUsd ?? 25))}`} className="btn btn-p1 w-full">
          Pick this fight yourself
        </Link>
        <FollowButton address={d.address.toBase58()} />
      </>
    );
  }

  /* ── Secondary actions ──────────────────────────────────────────────── */

  const secondary: React.ReactNode[] = [];
  if (d.status === STATUS_OPEN && (isCreator || expired) && publicKey) {
    secondary.push(
      <TxButton
        key="cancel"
        run={(onSent) => send([buildCancelDuel(d, publicKey)], onSent)}
        successTitle={expired ? "Stake sent home." : "Challenge called off."}
        className="btn-ghost w-full"
        label={expired ? "Send the stake home" : "Call it off"}
      />,
    );
  }
  if ((startDue || settleDue) && manual) {
    secondary.push(
      <div key="manual" className="flex flex-col gap-2">
        {publicKey ? (
          <TxButton
            run={crank(manual.which)}
            successTitle={manual.which === "start" ? "Start prices posted." : "Settled."}
            className="btn-ghost w-full"
            label={manual.label}
          />
        ) : (
          <button type="button" onClick={requestConnect} className="btn btn-ghost w-full">
            Connect to {manual.which === "start" ? "lock the start prices" : "settle it"}
          </button>
        )}
        <p className="text-meta text-dim">{manual.explain}</p>
      </div>,
    );
  }
  if ((d.status === STATUS_VOID || stalled) && publicKey) {
    secondary.push(
      <TxButton
        key="refund"
        run={(onSent) => send([buildRefundDuel(d, publicKey)], onSent)}
        successTitle="Both stakes sent home."
        className="btn-light w-full"
        label="Send both stakes home"
      />,
    );
  } else if (d.status === STATUS_VOID || stalled) {
    secondary.push(
      <button key="refund-connect" type="button" onClick={requestConnect} className="btn btn-ghost w-full">
        Connect to send both stakes home
      </button>,
    );
  }

  /* Run it back: the same two stocks, twice the stake, with whoever is looking
   * in their own corner. A fresh challenge: nothing about this fight changes,
   * and the other side still has to take it. When the viewer fought this one,
   * the new challenge names the wallet they fought. */
  const over = d.status === STATUS_SETTLED || (d.status === STATUS_REFUNDED && d.outcome === OUTCOME_TIE);
  const iLost =
    d.status === STATUS_SETTLED &&
    ((isCreator && d.outcome === OUTCOME_OPPONENT) || (!isCreator && iFought && d.outcome === OUTCOME_CREATOR));
  let rematch: React.ReactNode = null;
  if (over) {
    const mine = isCreator || !iFought ? t1 : t2;
    const theirs = mine === t1 ? t2 : t1;
    const again = Math.max(1, Math.round((stakeUsd ?? 25) * 2));
    const other = iFought ? (isCreator ? d.opponent.toBase58() : d.creator.toBase58()) : null;
    const name = other ? (handles?.[other] ? `@${handles[other]}` : shortAddress(other)) : null;
    const href = `/new?p1=${mine}&p2=${theirs}&usd=${again}${other ? `&invite=${other}` : ""}`;
    rematch = (
      <Link href={href} className="btn btn-p1 w-full">
        {name ? (
          <>
            Run it back vs <span className="normal-case">{name}</span> · ${again} a side
          </>
        ) : (
          <>Run it back · ${again} a side</>
        )}
      </Link>
    );
  }

  /* ── Hints ──────────────────────────────────────────────────────────── */

  const hints: { title: string; body?: string }[] = [];
  /* A shared link is the first page a newcomer sees, so an open challenge says
   * the rule before it asks for a stake, and off mainnet it says the stake is
   * free. The taker's corner is the second ticker. Once the challenge expires
   * nobody can take it, so the invitation goes quiet. */
  if (d.status === STATUS_OPEN && !expired) {
    hints.push({
      title: `Take ${t2} against ${t1}.`,
      body: `Whichever moves more, in percent, over the round takes both stakes, paid in shares.${
        testCluster ? " Devnet: free test shares from the faucet, nothing real at stake." : ""
      }`,
    });
  }
  if (mixedHours) hints.push({ title: "Not takeable right now.", body: mixedHours });
  /* On a test cluster the steps above already say it. */
  if (canTake && publicKey && short && !testCluster) {
    hints.push({
      title: `You need ${stake2} ${symbol2}.`,
      body: testCluster ? "The faucet has test shares." : undefined,
    });
  }
  if (d.status === STATUS_OPEN && !canTake && !isCreator && isInviteOnly(d) && !expired) {
    hints.push({ title: `This one is for ${shortAddress(d.invitee.toBase58())}.`, body: "Only that wallet can take it." });
  }
  if (d.status === STATUS_OPEN && expired) {
    hints.push({ title: "This challenge expired.", body: "Nobody can take it now. The challenger can send the stake home." });
  }
  const waitingFor = d.status === STATUS_ACCEPTED ? "starts" : d.status === STATUS_LIVE && now >= d.endTs ? "ends" : null;
  /* Why each waiting side waits, from who prices it. A Pyth feed prints only
   * in the regular session, so a Pyth stock waits through after-hours trading
   * on a busy exchange. A signed stock waits only while its exchange is shut,
   * which the price clock guarantees is so now. */
  if (waitingFor && shut.length) {
    const boundary = waitingFor === "starts" ? d.acceptedTs + START_DELAY_SECS : d.endTs;
    const pyth = shut.filter((t) => byTicker(t)?.source === "pyth");
    for (const group of [pyth, shut.filter((t) => !pyth.includes(t))]) {
      if (!group.length) continue;
      const one = group.length === 1;
      const who =
        group === pyth
          ? "Pyth, which only prints from the opening bell to the close"
          : one
            ? "its exchange, which is shut"
            : "their exchanges, which are shut";
      const opens = Math.max(0, ...group.map((t) => firstPriceAt(t, boundary) ?? 0));
      hints.push({
        title: `${group.join(" and ")} ${one ? "is" : "are"} priced by ${who}.`,
        body: `The round ${waitingFor} at ${one ? "its first price" : "their first prices"} ${opens ? `at ${openingWords(opens)}` : "when trading resumes"}.`,
      });
    }
  }
  if (d.status === STATUS_ACCEPTED && !startDue && !waiting) {
    hints.push({
      title: "Both stakes are in.",
      body: "The start is each stock's first price at least two seconds after the take. Nobody needs to do anything.",
    });
  }
  if (d.status === STATUS_LIVE && now < d.endTs) {
    hints.push({ title: `${t1} vs ${t2}.`, body: "Whichever moves more, in percent, by the bell takes both stakes." });
  }
  if (over) {
    hints.push({
      title: iLost ? "They took your shares." : iFought ? "Same two stocks, double the stake." : "Think the other one had it?",
      body: iLost
        ? "Same two stocks, double the stake, and you can take them back."
        : iFought
          ? "They will want it back."
          : "Open the same fight yourself, at twice the stake.",
    });
  }

  if (!primary && !secondary.length && !rematch && !hints.length) return null;

  const pair = `${t1} vs ${t2}${stakeUsd !== null ? ` · $${Math.max(1, Math.round(stakeUsd))} a side` : ""}`;

  return (
    <>
      <Plate rope pad="std" className={cx("flex flex-col gap-3", className)}>
        <h2 className="label">{canTake || (d.status === STATUS_LIVE && !iFought) ? "Your move" : over ? "Next" : "Actions"}</h2>
        {primary}
        {winLine ? <p className="text-meta text-ink">{winLine}</p> : null}
        {rematch}
        {secondary}
        {hints.map((h) => (
          <Notice key={h.title} tone="info" title={h.title}>
            {h.body}
          </Notice>
        ))}
      </Plate>
      {canTake && primary ? (
        <PhoneBar pair={pair} win={winLine}>
          {barAction ?? primary}
        </PhoneBar>
      ) : null}
    </>
  );
}

/* The faucet as the next step: the same request FaucetButton makes, drawn as
 * the primary button so the token symbol can keep its case inside it. */
function FaucetPrimary({ ticker, symbol }: { ticker: string; symbol: string }) {
  const { drip, busy } = useFaucet([ticker]);
  return (
    <button type="button" onClick={drip} disabled={busy} aria-busy={busy || undefined} className="btn btn-light w-full">
      {busy ? (
        "Minting..."
      ) : (
        <>
          Get test <span className="normal-case">{symbol}</span>
        </>
      )}
    </button>
  );
}

/* THE ANSWER BAR. Fixed above the phone's bottom nav, so it never covers it,
 * and the same height is reserved at the very end of the page (after the
 * footer, which is where a fixed bar would otherwise sit on top of content),
 * so it never covers anything else either. Phones only. */
function PhoneBar({ pair, win, children }: { pair: string; win?: React.ReactNode; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <>
      <div
        className="rope fixed inset-x-0 z-35 flex items-center gap-3 bg-panel-2 px-4 py-2.5 shadow-overlay sm:hidden"
        style={{ bottom: "calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))" }}
      >
        <div className="min-w-0 flex-1">
          <p className="num truncate text-meta text-ink">{pair}</p>
          {win ? <p className="truncate text-meta text-dim">{win}</p> : null}
        </div>
        <div className="min-w-0 shrink-0 [&_.btn]:w-auto [&_.btn]:px-4 [&_.btn]:text-sm">{children}</div>
      </div>
      <div aria-hidden="true" className="h-16 sm:hidden" />
    </>,
    document.body,
  );
}

/* Following a fight means its toasts reach this viewer on any page
 * (FightWatcher). Opening the page already follows it, so this mostly says
 * so, and lets a watcher stop. */
function FollowButton({ address }: { address: string }) {
  const [following, setFollowing] = useState<boolean | null>(null);
  useEffect(() => setFollowing(watchedFights().includes(address)), [address]);
  if (following === null) return null;
  return (
    <button
      type="button"
      aria-pressed={following}
      onClick={() => {
        if (following) unwatchFight(address);
        else watchFight(address);
        setFollowing(!following);
      }}
      className="btn btn-ghost w-full"
    >
      {following ? (
        <>
          <span aria-hidden="true">&#10003;</span> Following · a toast at the bell
        </>
      ) : (
        "Follow this fight"
      )}
    </button>
  );
}
