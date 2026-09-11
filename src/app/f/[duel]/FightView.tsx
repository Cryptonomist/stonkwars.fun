"use client";

/* One fight, in every state it can be in.
 *
 *   OPEN      a challenge: take it, or (creator) share it or call it off
 *   ACCEPTED  both stakes in; the start prices are being posted
 *   LIVE      the round: live moves, health bars, the clock to the bell
 *   SETTLED   the winner took both stakes; the loser is COOKED
 *   VOID      could not be run fairly; anyone can send both stakes home
 *   REFUNDED  a dead heat, or a void that has been refunded
 *
 * Nothing here decides anything. The live moves are for watching; the result
 * is whatever the program computed from the two Pyth prices it accepted, and
 * the proof section shows exactly which prices those were. */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { HealthBars } from "@/components/HealthBars";
import { Move } from "@/components/Ticker";
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
  readableProgramError,
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
import { clock, etTime, pythToNumber, shares, shortAddress, span, usd } from "@/lib/format";
import { explorerAddress, useDuel, useSend, useTokenBalance } from "@/lib/hooks";
import { movePct, stakeValue, usePrices, type Quotes } from "@/lib/prices";
import { byTicker, CLUSTER, STAKE_DECIMALS, tickerForMint, tokenSymbol } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";
import { BRAND } from "@/lib/brand";

export function FightView({ address }: { address: string }) {
  const key = useMemo(() => {
    try {
      return new PublicKey(address);
    } catch {
      return null;
    }
  }, [address]);

  const duel = useDuel(key);
  const prices = usePrices();
  const now = useNow();
  const params = useSearchParams();

  if (!key) return <Empty title="That is not a fight address." />;
  if (duel.isLoading) return <Empty title="Loading the fight..." quiet />;
  if (!duel.data)
    return <Empty title="No fight here." body="It was called off, or the link is wrong. Cancelled fights close their account." />;

  return <Arena d={duel.data} now={now} quotes={prices.data} fresh={params.get("new") === "1"} />;
}

function Arena({ d, now, quotes, fresh }: { d: DuelView; now: number; quotes?: Quotes; fresh: boolean }) {
  const t1 = tickerForMint(d.creatorMint) ?? "?";
  const t2 = tickerForMint(d.opponentMint) ?? "?";
  const q1 = quotes?.quotes[t1];
  const q2 = quotes?.quotes[t2];

  const finished = d.status === STATUS_SETTLED || (d.status === STATUS_REFUNDED && d.creatorEnd.price > BigInt(0));
  const m1 = finished ? movePct(d.creatorStart, d.creatorEnd) : d.status === STATUS_LIVE && q1 ? movePct(d.creatorStart, q1) : null;
  const m2 = finished ? movePct(d.opponentStart, d.opponentEnd) : d.status === STATUS_LIVE && q2 ? movePct(d.opponentStart, q2) : null;

  const p1Cooked = d.status === STATUS_SETTLED && d.outcome === OUTCOME_OPPONENT;
  const p2Cooked = d.status === STATUS_SETTLED && d.outcome === OUTCOME_CREATOR;

  return (
    <div className="py-8">
      <StatusStrip d={d} now={now} />

      <section className="card relative mt-4 overflow-hidden p-5 sm:p-8">
        <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-[1fr_auto_1fr]">
          <Corner
            side="p1"
            ticker={t1}
            who={d.creator.toBase58()}
            role="Challenger"
            amount={d.creatorAmount}
            quote={q1}
            move={m1}
            cooked={p1Cooked}
            winner={d.status === STATUS_SETTLED && d.outcome === OUTCOME_CREATOR}
          />
          <Center d={d} now={now} m1={m1} m2={m2} />
          <Corner
            side="p2"
            ticker={t2}
            who={hasOpponent(d) ? d.opponent.toBase58() : null}
            role={hasOpponent(d) ? "Answered" : isInviteOnly(d) ? `For ${shortAddress(d.invitee.toBase58())}` : "Open seat"}
            amount={d.opponentAmount}
            quote={q2}
            move={m2}
            cooked={p2Cooked}
            winner={d.status === STATUS_SETTLED && d.outcome === OUTCOME_OPPONENT}
          />
        </div>

        {d.taunt ? (
          <p className="mt-8 text-center text-xl italic sm:text-2xl">
            &ldquo;{d.taunt}&rdquo;
            <span className="mt-1 block text-xs not-italic text-dim">{shortAddress(d.creator.toBase58())}, on chain</span>
          </p>
        ) : null}
      </section>

      <Actions d={d} now={now} t1={t1} t2={t2} />
      <Share d={d} t1={t1} t2={t2} m1={m1} m2={m2} fresh={fresh} />
      <Proof d={d} t1={t1} t2={t2} />
    </div>
  );
}

function StatusStrip({ d, now }: { d: DuelView; now: number }) {
  let text = "";
  let tone = "text-dim";
  switch (d.status) {
    case STATUS_OPEN:
      text = now && d.expiresTs <= now ? "Challenge expired" : `Open challenge · closes in ${now ? clock(d.expiresTs - now) : "--"}`;
      tone = "text-gold";
      break;
    case STATUS_ACCEPTED:
      text = "Fight on · locking the starting prices";
      tone = "text-gold";
      break;
    case STATUS_LIVE:
      text = now && d.endTs > now ? "Round live" : "Bell rung · settling";
      tone = "text-up";
      break;
    case STATUS_SETTLED:
      text = "Final";
      tone = "text-ink";
      break;
    case STATUS_VOID:
      text = "Void · both stakes go home";
      break;
    case STATUS_REFUNDED:
      text = d.outcome === OUTCOME_TIE ? "Dead heat · both refunded" : "Refunded";
      break;
  }
  return (
    <div className="flex items-center gap-3">
      {d.status === STATUS_LIVE ? <span className="pulse-dot" /> : null}
      <span className={`label ${tone}`}>{text}</span>
      <Link href="/fights" className="label ml-auto hover:text-ink">
        All fights
      </Link>
    </div>
  );
}

function Corner({
  side,
  ticker,
  who,
  role,
  amount,
  quote,
  move,
  cooked,
  winner,
}: {
  side: "p1" | "p2";
  ticker: string;
  who: string | null;
  role: string;
  amount: bigint;
  quote?: Quotes["quotes"][string];
  move: number | null;
  cooked: boolean;
  winner: boolean;
}) {
  const right = side === "p2";
  const value = stakeValue(amount, STAKE_DECIMALS, quote);
  return (
    <div className={`relative flex flex-col ${right ? "md:items-end md:text-right" : ""}`}>
      <span className="label">{role}</span>
      <span className={`display mt-1 text-7xl sm:text-8xl ${side === "p1" ? "text-p1" : "text-p2"} ${cooked ? "opacity-40" : ""}`}>
        {ticker}
      </span>
      <span className="text-sm text-dim">{byTicker(ticker)?.name}</span>
      <span className="mt-3 font-mono text-sm">
        {shares(amount, STAKE_DECIMALS)} {tokenSymbol(ticker)}
        <span className="text-dim"> · {value !== null ? usd(value) : "--"}</span>
      </span>
      <span className="font-mono text-xs text-dim">{who ? shortAddress(who, 5) : "waiting for a taker"}</span>
      {move !== null ? <Move value={move} className="mt-3 text-4xl" /> : null}
      {winner ? <span className="display mt-2 text-2xl text-gold">Winner takes both</span> : null}
      {cooked ? (
        <span
          className={`stamp-cooked pointer-events-none absolute top-10 text-5xl sm:text-6xl ${right ? "right-3" : "left-3"}`}
        >
          Cooked
        </span>
      ) : null}
    </div>
  );
}

function Center({ d, now, m1, m2 }: { d: DuelView; now: number; m1: number | null; m2: number | null }) {
  const live = d.status === STATUS_LIVE;
  const done = d.status === STATUS_SETTLED || d.status === STATUS_REFUNDED;
  return (
    <div className="flex flex-col items-center gap-3 md:w-80">
      {live || done ? (
        <div className="w-full">
          <HealthBars p1Move={m1} p2Move={m2} roundSecs={Math.max(60, d.endTs - d.startTs)} />
        </div>
      ) : (
        <span className="display text-6xl text-gold">VS</span>
      )}
      {live ? (
        <>
          <span className="display font-mono text-5xl tabular-nums">{now && d.endTs > now ? clock(d.endTs - now) : "0:00"}</span>
          <span className="label">to the bell · {etTime(d.endTs)}</span>
          {m1 !== null && m2 !== null ? (
            <span className="text-sm text-dim">
              {Math.abs(m1 - m2) < 0.005 ? "Dead even" : `${m1 > m2 ? "Challenger" : "Answer"} leads by ${Math.abs(m1 - m2).toFixed(2)} pts`}
            </span>
          ) : null}
        </>
      ) : null}
      {d.status === STATUS_OPEN ? (
        <span className="text-center text-sm text-dim">
          {d.durationSecs ? `${span(d.durationSecs)} round from the first price after it is taken` : `Ends at the first price after ${etTime(d.endTs)}`}
        </span>
      ) : null}
      {done && m1 !== null && m2 !== null ? (
        <span className="text-center text-sm text-dim">
          {d.outcome === OUTCOME_TIE ? "Identical moves, to the last digit." : `Won by ${Math.abs(m1 - m2).toFixed(2)} points`}
        </span>
      ) : null}
    </div>
  );
}

function Actions({ d, now, t1, t2 }: { d: DuelView; now: number; t1: string; t2: string }) {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const { connection } = useConnection();
  const send = useSend();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const me = publicKey?.toBase58();
  const isCreator = me === d.creator.toBase58();
  const mySource = publicKey ? ataFor(publicKey, d.opponentMint, d.opponentTokenProgram) : null;
  const balance = useTokenBalance(d.status === STATUS_OPEN && !isCreator ? mySource : null);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(readableProgramError(e));
    } finally {
      setBusy(null);
    }
  }

  const crank = (which: "start" | "settle") =>
    run(which, async () => {
      if (!publicKey || !signTransaction || !signAllTransactions) {
        throw new Error("Connect a wallet to post the prices yourself.");
      }
      const { crankWithPyth } = await import("@/lib/pythCrank");
      const sigs = await crankWithPyth({
        connection,
        wallet: { publicKey, signTransaction, signAllTransactions },
        which,
        duel: d,
      });
      setNote(`Posted in ${sigs.length} transactions.`);
    });

  const expired = now > 0 && d.expiresTs <= now;
  const canTake = d.status === STATUS_OPEN && !expired && !isCreator && (!isInviteOnly(d) || d.invitee.toBase58() === me);
  const short = balance.data !== undefined && (balance.data === null || balance.data < d.opponentAmount);

  const startDue = d.status === STATUS_ACCEPTED && now >= d.acceptedTs + START_DELAY_SECS + 20;
  const settleDue = d.status === STATUS_LIVE && now >= d.endTs + 20;
  const stalled =
    (d.status === STATUS_ACCEPTED && now >= d.acceptedTs + STALL_REFUND_SECS) ||
    (d.status === STATUS_LIVE && now >= d.endTs + STALL_REFUND_SECS);

  const buttons: React.ReactNode[] = [];

  if (canTake) {
    buttons.push(
      <button
        key="take"
        type="button"
        disabled={!publicKey || short || !!busy}
        onClick={() => run("take", () => send([buildAcceptDuel(d, publicKey!)]))}
        className="btn btn-p2 px-10 text-xl"
      >
        {busy === "take" ? "Signing..." : `Take it: stake ${shares(d.opponentAmount, STAKE_DECIMALS)} ${tokenSymbol(t2)}`}
      </button>,
    );
  }
  if (d.status === STATUS_OPEN && (isCreator || expired)) {
    buttons.push(
      <button
        key="cancel"
        type="button"
        disabled={!publicKey || !!busy}
        onClick={() => run("cancel", () => send([buildCancelDuel(d, publicKey!)]))}
        className="btn btn-ghost"
      >
        {busy === "cancel" ? "Signing..." : expired ? "Send the stake home" : "Call it off"}
      </button>,
    );
  }
  if (startDue) {
    buttons.push(
      <button key="start" type="button" disabled={!publicKey || !!busy} onClick={() => crank("start")} className="btn btn-ghost">
        {busy === "start" ? "Posting prices..." : "Lock the start prices yourself"}
      </button>,
    );
  }
  if (settleDue) {
    buttons.push(
      <button key="settle" type="button" disabled={!publicKey || !!busy} onClick={() => crank("settle")} className="btn btn-gold">
        {busy === "settle" ? "Settling..." : "Settle it yourself"}
      </button>,
    );
  }
  if (d.status === STATUS_VOID || stalled) {
    buttons.push(
      <button
        key="refund"
        type="button"
        disabled={!publicKey || !!busy}
        onClick={() => run("refund", () => send([buildRefundDuel(d, publicKey!)]))}
        className="btn btn-gold"
      >
        {busy === "refund" ? "Signing..." : "Send both stakes home"}
      </button>,
    );
  }

  const hints: string[] = [];
  if (canTake && !publicKey) hints.push("Connect a wallet to take this fight.");
  if (canTake && publicKey && short)
    hints.push(`You need ${shares(d.opponentAmount, STAKE_DECIMALS)} ${tokenSymbol(t2)}. Hit Get test stocks up top.`);
  if (d.status === STATUS_OPEN && !canTake && !isCreator && isInviteOnly(d) && !expired)
    hints.push(`This one is for ${shortAddress(d.invitee.toBase58())}. Only that wallet can take it.`);
  if (d.status === STATUS_ACCEPTED && !startDue) hints.push("The start is the first Pyth price at least two seconds after the accept. Posting it now.");
  if (d.status === STATUS_LIVE && now < d.endTs) hints.push(`${t1} vs ${t2}: whichever moves more, in percent, by the bell takes both stakes.`);
  if ((startDue || settleDue) && !busy) hints.push("The settler normally does this within a minute. Anyone can, and the result is the same whoever does.");

  if (!buttons.length && !hints.length) return null;
  return (
    <section className="mt-6 flex flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-3">{buttons}</div>
      {hints.map((h) => (
        <p key={h} className="max-w-xl text-center text-sm text-dim">
          {h}
        </p>
      ))}
      {note ? <p className="text-sm text-up">{note}</p> : null}
      {error ? <p className="max-w-xl text-center text-sm text-down">{error}</p> : null}
    </section>
  );
}

function Share({ d, t1, t2, m1, m2, fresh }: { d: DuelView; t1: string; t2: string; m1: number | null; m2: number | null; fresh: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/f/${d.address.toBase58()}` : "";
  if (!url) return null;

  let text = "";
  if (d.status === STATUS_OPEN) {
    text = d.taunt
      ? `${d.taunt}\n\n${t1} vs ${t2}. I staked ${shares(d.creatorAmount, STAKE_DECIMALS)} ${t1}x. Take the other side:`
      : `I'm staking ${shares(d.creatorAmount, STAKE_DECIMALS)} ${t1}x that ${t1} beats ${t2}. Take the other side:`;
  } else if (d.status === STATUS_SETTLED && m1 !== null && m2 !== null) {
    const [win, lose, mw, ml] = d.outcome === OUTCOME_CREATOR ? [t1, t2, m1, m2] : [t2, t1, m2, m1];
    text = `${lose} got cooked. ${win} ${mw >= 0 ? "+" : ""}${mw.toFixed(2)}% vs ${lose} ${ml >= 0 ? "+" : ""}${ml.toFixed(2)}%, settled by Pyth on Solana.`;
  } else if (d.status === STATUS_LIVE) {
    text = `${t1} vs ${t2} is live on ${BRAND.name}. Watch it:`;
  } else {
    return null;
  }

  const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

  return (
    <section className={`card mx-auto mt-6 max-w-2xl p-5 ${fresh && d.status === STATUS_OPEN ? "ring-2 ring-gold" : ""}`}>
      <p className="label">
        {d.status === STATUS_OPEN
          ? fresh
            ? "Fight picked. Now send it."
            : "Send it to someone"
          : d.status === STATUS_SETTLED
            ? "Post the result"
            : "Share the fight"}
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input readOnly value={url} className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="btn btn-sm btn-ghost shrink-0"
          onClick={() => {
            void navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1_500);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        <a href={intent} target="_blank" rel="noreferrer" className="btn btn-sm btn-gold shrink-0">
          Post on X
        </a>
      </div>
    </section>
  );
}

function Proof({ d, t1, t2 }: { d: DuelView; t1: string; t2: string }) {
  if (d.startTs === 0) {
    return (
      <p className="mt-10 text-center text-xs text-dim">
        Program account{" "}
        <a className="underline" href={explorerAddress(d.address.toBase58(), CLUSTER)} target="_blank" rel="noreferrer">
          {shortAddress(d.address.toBase58(), 6)}
        </a>
      </p>
    );
  }
  const row = (label: string, ticker: string, feed: string, p: DuelView["creatorStart"]) =>
    p.price > BigInt(0) ? (
      <tr key={label + ticker} className="border-t border-line">
        <td className="py-2 pr-3 text-dim">{label}</td>
        <td className="py-2 pr-3 font-display text-lg font-extrabold">{ticker}</td>
        <td className="py-2 pr-3 font-mono">{usd(pythToNumber(p.price, p.expo))}</td>
        <td className="py-2 pr-3 font-mono text-dim">{new Date(p.publishTime * 1000).toISOString().replace(".000Z", "Z")}</td>
        <td className="py-2 font-mono text-xs text-dim">{feed.slice(0, 8)}...</td>
      </tr>
    ) : null;
  return (
    <section className="mx-auto mt-10 max-w-3xl">
      <p className="label">The prices that decided it</p>
      <p className="mt-2 text-sm text-dim">
        Each is the first Pyth price published at or after its boundary. Every Pyth price records when the one before it
        came out, so exactly one qualifies, and the program refuses any other. Signed by Pyth, verified on Solana, checked
        by the program.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {row("Start", t1, d.creatorFeed, d.creatorStart)}
            {row("Start", t2, d.opponentFeed, d.opponentStart)}
            {row("End", t1, d.creatorFeed, d.creatorEnd)}
            {row("End", t2, d.opponentFeed, d.opponentEnd)}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-dim">
        Start boundary {new Date((d.acceptedTs + START_DELAY_SECS) * 1000).toISOString()} · end boundary{" "}
        {new Date(d.endTs * 1000).toISOString()} ·{" "}
        <a className="underline" href={explorerAddress(d.address.toBase58(), CLUSTER)} target="_blank" rel="noreferrer">
          duel account
        </a>
      </p>
    </section>
  );
}

function Empty({ title, body, quiet }: { title: string; body?: string; quiet?: boolean }) {
  return (
    <div className="py-24 text-center">
      <p className={`display ${quiet ? "text-3xl text-dim" : "text-5xl"}`}>{title}</p>
      {body ? <p className="mt-3 text-dim">{body}</p> : null}
      {!quiet ? (
        <Link href="/new" className="btn btn-p1 mt-8">
          Pick a fight
        </Link>
      ) : null}
    </div>
  );
}
