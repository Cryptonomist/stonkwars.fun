"use client";

/* THE RECEIPT: the fight as the chain recorded it.
 *
 * Two parts. The timeline is every step, oldest first, each with the wallet
 * that signed it and a link to the transaction: called, taken, start prices
 * posted, settled. A settle paid for by a wallet that fought in neither corner
 * says so, because that is the point: anyone can finish a fight, and the
 * result is the same whoever does.
 *
 * Below it, the prices that decided it: each side's start and bell price, the
 * moment each printed (to the second, in New York, with the exact UTC time a
 * hover away), who priced it, and the feed it came from. How those prices were
 * chosen is one tap away, not a wall of text in the way, and a price the 24/7
 * markets made opens its whole proof, market by market (CompositeCheck). */

import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { FighterName } from "@/components/ui/FighterName";
import { Notice } from "@/components/ui/Notice";
import { Plate } from "@/components/ui/Plate";
import { SectionHead } from "@/components/ui/SectionHead";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import {
  OUTCOME_CREATOR,
  OUTCOME_OPPONENT,
  OUTCOME_TIE,
  SOURCE_PYTH,
  START_DELAY_SECS,
  STATUS_SETTLED,
  type DuelView,
  type PricePoint,
} from "@/lib/duel";
import { ago, pythToNumber, shortAddress, usd } from "@/lib/format";
import { sourceAt, type PriceSource } from "@/lib/oracle";
import {
  etStamp,
  feeTotal,
  rowsFromAccount,
  rowsFromEvents,
  settledAfterBell,
  solFromLamports,
  waitWords,
  type ReceiptRow,
} from "@/lib/receipt";
import { boundaryOf } from "@/lib/crankTx";
import { quoteSymbolFor } from "@/lib/stocks";
import { useReceipt } from "@/lib/useReceipt";

import { CompositeCheck } from "./CompositeCheck";

export function Receipt({ d, t1, t2, now, className }: { d: DuelView; t1: string; t2: string; now: number; className?: string }) {
  const receipt = useReceipt(d);
  const fromTx = receipt.data && receipt.data.events.length > 0;
  const rows: ReceiptRow[] = fromTx ? rowsFromEvents(receipt.data!.events, d) : rowsFromAccount(d);
  const fees = feeTotal(rows);
  const afterBell = d.status === STATUS_SETTLED ? settledAfterBell(rows, d.endTs) : null;

  /* "4 steps · 0.000025 SOL in fees": every figure is one the cluster charged,
   * and when a node left a fee out the count says which steps it covers. */
  const stepWords = rows.length ? `${rows.length} ${rows.length === 1 ? "step" : "steps"}` : null;
  const feeWords = fees
    ? `${solFromLamports(fees.lamports)} SOL in fees${fees.counted < fees.steps ? ` for ${fees.counted} of ${fees.steps}` : ""}`
    : null;

  return (
    <Plate as="section" pad="std" className={cx("flex flex-col gap-4", className)} aria-labelledby="receipt-title">
      <SectionHead id="receipt-title" title="Receipt" count={[stepWords, feeWords].filter(Boolean).join(" · ") || null} />

      {receipt.isLoading ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only" role="status">
            Loading the transactions
          </span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : (
        <>
          <ol className="flex flex-col">
            {rows.map((r) => (
              <Step key={`${r.step}-${r.signature ?? r.at}`} row={r} d={d} t1={t1} t2={t2} now={now} afterBell={afterBell} />
            ))}
          </ol>
          {fees?.shared ? (
            <p className="text-meta text-dim">
              A step marked shared ran in one transaction with other fights, and its fee is that whole transaction&apos;s.
            </p>
          ) : null}
          {receipt.data?.noHistory ? (
            <Notice tone="info" title="This RPC node keeps no transaction history for this account.">
              The steps above come from the fight account&apos;s own timestamps.
            </Notice>
          ) : receipt.isError && !fromTx ? (
            <Notice
              tone="error"
              title="Could not read the transactions."
              action={
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => void receipt.refetch()}>
                  Retry
                </button>
              }
            >
              The steps above come from the fight account&apos;s own timestamps.
            </Notice>
          ) : null}
        </>
      )}

      <Proof d={d} t1={t1} t2={t2} />
    </Plate>
  );
}

function Step({
  row,
  d,
  t1,
  t2,
  now,
  afterBell,
}: {
  row: ReceiptRow;
  d: DuelView;
  t1: string;
  t2: string;
  now: number;
  afterBell: number | null;
}) {
  const outcome =
    row.step === "settled"
      ? d.outcome === OUTCOME_CREATOR
        ? `${t1} won`
        : d.outcome === OUTCOME_OPPONENT
          ? `${t2} won`
          : d.outcome === OUTCOME_TIE
            ? "Dead heat"
            : null
      : null;
  const starts =
    row.step === "started" && d.creatorStart.price > BigInt(0)
      ? `${t1} ${usd(pythToNumber(d.creatorStart.price, d.creatorStart.expo))} · ${t2} ${usd(pythToNumber(d.opponentStart.price, d.opponentStart.expo))}`
      : null;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-line py-2.5 first:border-t-0 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold text-ink">{row.label}</span>
        {row.at ? (
          <span className="text-meta text-dim" title={new Date(row.at * 1000).toISOString()}>
            {etStamp(row.at)}
            {now ? ` · ${ago(row.at, now)}` : ""}
          </span>
        ) : null}
      </div>
      <div className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-2 sm:col-span-1 sm:row-start-1 sm:col-start-2">
        {row.signer ? (
          <>
            <span className="label">{row.step === "called" || row.step === "taken" ? "by" : "signed by"}</span>
            <FighterName wallet={row.signer} size="sm" />
          </>
        ) : null}
        {row.spectator ? <Badge variant="neutral">Settled by a spectator</Badge> : null}
        {row.settler ? <Badge variant="neutral">The settler, nobody pressed a button</Badge> : null}
        {outcome ? <span className="text-meta text-ink">{outcome}</span> : null}
        {row.step === "settled" && afterBell !== null ? (
          <span className="text-meta text-dim">{waitWords(afterBell)} after the bell</span>
        ) : null}
        {starts ? <span className="num text-meta text-dim">{starts}</span> : null}
      </div>
      <div className="col-start-2 row-start-1 flex flex-col items-end justify-self-end sm:col-start-3">
        {row.signature ? <ExplorerLink kind="tx" value={row.signature} className="text-meta" /> : null}
        {row.fee !== null ? (
          <span className="num text-meta text-dim" title={row.slot !== null ? `Slot ${row.slot.toLocaleString("en-US")}` : undefined}>
            fee {solFromLamports(row.fee)} SOL{row.sharedWith > 0 ? " · shared" : ""}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/* Which market the oracle read for a price, worked out the same way it was,
 * for the boundary the price was asked for: the stock's own exchange while it
 * was trading, and once that shuts, the median of its round-the-clock markets
 * (from COMPOSITE_FROM), its perpetual future, or its Solana pool for the few
 * stocks with no perp. The boundary, not the price's own stamp: a 24/7 price
 * is stamped three minutes after it, which can be past a close. */
function oracleSource(feed: string, boundary: number): PriceSource | undefined {
  const market = quoteSymbolFor(feed);
  return market ? sourceAt(boundary, market) : undefined;
}

function pricedBy(feed: string, source: number, boundary: number): string {
  if (source === SOURCE_PYTH) return "Pyth";
  const from = oracleSource(feed, boundary);
  if (!from) return "Oracle";
  return from === "composite"
    ? "Oracle · 24/7 median"
    : from === "perp"
      ? "Oracle · perp"
      : from === "pool"
        ? "Oracle · pool"
        : "Oracle · exchange";
}

function Proof({ d, t1, t2 }: { d: DuelView; t1: string; t2: string }) {
  if (d.startTs === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4 text-meta text-dim">
        <span>Prices post when the round starts.</span>
        <span>Fight account</span>
        <ExplorerLink kind="address" value={d.address.toBase58()} />
      </div>
    );
  }

  const pyth = d.creatorSource === SOURCE_PYTH || d.opponentSource === SOURCE_PYTH;
  const signed = d.creatorSource !== SOURCE_PYTH || d.opponentSource !== SOURCE_PYTH;
  /* A pool price is not the one-bar close the sentence above describes, so it
   * gets its own line, but only when a price shown here was priced that way. */
  const start = boundaryOf(d, "start");
  const sides = [
    [d.creatorFeed, d.creatorSource, d.creatorStart, start],
    [d.opponentFeed, d.opponentSource, d.opponentStart, start],
    [d.creatorFeed, d.creatorSource, d.creatorEnd, d.endTs],
    [d.opponentFeed, d.opponentSource, d.opponentEnd, d.endTs],
  ] as const;
  const readBy = (kind: PriceSource) =>
    sides.some(([feed, source, p, boundary]) => source !== SOURCE_PYTH && p.price > BigInt(0) && oracleSource(feed, boundary) === kind);
  const pooled = readBy("pool");
  const median = readBy("composite");

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="label">The prices that decided it</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <SideProof side="p1" ticker={t1} feed={d.creatorFeed} source={d.creatorSource} start={d.creatorStart} end={d.creatorEnd} startAt={start} endAt={d.endTs} />
        <SideProof side="p2" ticker={t2} feed={d.opponentFeed} source={d.opponentSource} start={d.opponentStart} end={d.opponentEnd} startAt={start} endAt={d.endTs} />
      </div>
      <p className="text-meta text-dim">
        Start boundary{" "}
        <span className="text-ink" title={new Date((d.acceptedTs + START_DELAY_SECS) * 1000).toISOString()}>
          {etStamp(d.acceptedTs + START_DELAY_SECS)}
        </span>{" "}
        · bell <span className="text-ink" title={new Date(d.endTs * 1000).toISOString()}>{etStamp(d.endTs)}</span> · fight
        account <ExplorerLink kind="address" value={d.address.toBase58()} />
      </p>
      {/* A bell price stamped a minute after the bell read as late or wrong
        * beside the round's own times, so the one-line reason sits right here. */}
      {(d.creatorEnd.price > BigInt(0) && d.creatorEnd.publishTime > d.endTs) ||
      (d.opponentEnd.price > BigInt(0) && d.opponentEnd.publishTime > d.endTs) ? (
        <p className="text-meta text-dim">
          A bell price stamped after the bell is not late: it is that stock&apos;s first price at or after the bell,
          which is the one the rules take.
        </p>
      ) : null}
      <details className="group text-sm text-dim">
        <summary className="label cursor-pointer select-none py-2 hover:text-ink">How these prices were chosen</summary>
        <p className="mt-1 max-w-prose">
          Each is its stock&apos;s first price at or after the boundary.{" "}
          {pyth
            ? "A Pyth price records when the one before it came out, so exactly one qualifies; it is signed by Pyth, verified on Solana and checked by the program, which refuses any other. "
            : ""}
          {signed ? (
            <>
              An oracle price is the close of the first one-minute bar at or after the boundary, signed by oracle{" "}
              <ExplorerLink kind="address" value={d.oracle.toBase58()} /> and checked by Solana&apos;s Ed25519 program in
              the same transaction. The quote is public in that transaction, so anyone can hold it against the
              market&apos;s record.
            </>
          ) : null}
          {pooled
            ? " A pool price is the average of the middle 60% of up to 15 one-minute closes in the hour before the boundary, so one trade cannot set it."
            : null}
          {median
            ? " A 24/7 price, taken while the exchange was shut, is the median over three minutes of the one-minute closes of the markets that trade the stock around the clock, each corrected by its premium to the others, and its proof lists every market and every close."
            : null}
        </p>
      </details>
    </div>
  );
}

function SideProof({
  side,
  ticker,
  feed,
  source,
  start,
  end,
  startAt,
  endAt,
}: {
  side: "p1" | "p2";
  ticker: string;
  feed: string;
  source: number;
  start: PricePoint;
  end: PricePoint;
  /** The boundaries each price was asked for: the start, and the bell. */
  startAt: number;
  endAt: number;
}) {
  const row = (label: string, p: PricePoint, boundary: number) =>
    p.price > BigInt(0) ? (
      <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 border-t border-line py-2 first:border-t-0">
        <dt className="label pt-0.5">{label}</dt>
        <dd className="flex min-w-0 flex-col">
          <span className="num text-sm text-ink">{usd(pythToNumber(p.price, p.expo))}</span>
          <span className="text-meta text-dim" title={new Date(p.publishTime * 1000).toISOString()}>
            {etStamp(p.publishTime)}
          </span>
          <span className="text-meta text-dim">{pricedBy(feed, source, boundary)}</span>
          {source !== SOURCE_PYTH && oracleSource(feed, boundary) === "composite" ? (
            <CompositeCheck feed={feed} ticker={ticker} boundary={boundary} price={p.price} expo={p.expo} />
          ) : null}
        </dd>
      </div>
    ) : null;

  return (
    <div className="min-w-0 bg-panel-2 px-3 py-2.5">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className={cx("display text-hud-xs", side === "p1" ? "text-p1" : "text-p2")}>{ticker}</span>
        <FeedId feed={feed} />
      </div>
      <dl className="mt-1">
        {row("Start", start, startAt)}
        {row("Bell", end, endAt)}
      </dl>
    </div>
  );
}

function FeedId({ feed }: { feed: string }) {
  const [copied, setCopied] = useState(false);
  const full = `0x${feed}`;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="label shrink-0">Feed</span>
      <span className="num truncate text-meta text-dim" title={full}>
        {shortAddress(full, 6)}
      </span>
      <button
        type="button"
        className="micro inline-flex h-8 shrink-0 items-center px-1.5 text-dim transition-colors hover:text-ink"
        aria-label={`Copy feed id ${full}`}
        onClick={() => {
          navigator.clipboard
            .writeText(full)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1_500);
            })
            .catch(() => toast.push({ title: "Could not copy the feed id." }));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
