"use client";

/* THE 24/7 PRICE, SHOWN WORKING.
 *
 * A side the composite priced (a US stock whose exchange was shut, from
 * COMPOSITE_FROM) carries a price the oracle signed from nine public markets.
 * The receipt's "Check this 24/7 price" opens the proof behind it, recomputed
 * by /api/quote/proof for the same feed and boundary: every pinned market, its
 * instrument, its last trade before the window, whether it counted and why
 * not, and for each minute of the window its close and the corrected close the
 * median took, kept or dropped by the guard. Then the minute medians, the
 * price, whether it is exactly the price on chain, the rule and the sha256.
 * Every request is a link anyone can open again.
 *
 * Nothing is fetched until somebody opens it: the proof asks nine venues on a
 * cold server, and most visitors never look. A table wider than a phone
 * scrolls inside its own box, never the page. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { cx } from "@/components/ui/cx";
import { etShort } from "@/lib/format";
import type { CompositeV2Proof } from "@/lib/composite";
import { isV2, proofSentences, proofTable, ruleWords, sameAsChain, ticksText, type ProofResponse } from "@/lib/proofWords";

type Loaded = { ok: true; body: ProofResponse } | { ok: false; error: string };

export function CompositeCheck({
  feed,
  ticker,
  boundary,
  price,
  expo,
}: {
  feed: string;
  ticker: string;
  boundary: number;
  /** The price the program recorded for this side at this boundary. */
  price: bigint;
  expo: number;
}) {
  const [open, setOpen] = useState(false);
  const url = `/api/quote/proof?feed=${feed}&boundary=${boundary}`;
  const q = useQuery<Loaded>({
    queryKey: ["composite-proof", feed, boundary],
    enabled: open,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const r = await fetch(url);
      const body = (await r.json().catch(() => null)) as (ProofResponse & { error?: string }) | null;
      if (body?.proof) return { ok: true, body };
      return { ok: false, error: body?.error ?? `The proof route answered ${r.status}.` };
    },
  });

  return (
    <details className="group mt-1 min-w-0" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="label min-h-8 cursor-pointer select-none py-1.5 hover:text-ink">Check this 24/7 price</summary>
      <div className="mt-1 flex min-w-0 flex-col gap-2">
        {q.isLoading || (open && !q.data) ? (
          <div aria-busy="true" className="flex flex-col gap-1.5">
            <span className="sr-only" role="status">
              Recomputing the proof from its markets
            </span>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : q.data && !q.data.ok ? (
          <p className="text-meta text-dim">{q.data.error}</p>
        ) : q.data?.ok && q.data.body.proof && isV2(q.data.body.proof) ? (
          <ProofBody body={q.data.body} proof={q.data.body.proof} ticker={ticker} price={price} expo={expo} url={url} />
        ) : q.data?.ok ? (
          <p className="text-meta text-dim">
            This price was proved under {ruleWords(q.data.body.rule)}.{" "}
            <a href={url} target="_blank" rel="noreferrer" className="link">
              Read the proof
            </a>
            .
          </p>
        ) : null}
      </div>
    </details>
  );
}

function ProofBody({
  body,
  proof,
  ticker,
  price,
  expo,
  url,
}: {
  body: ProofResponse;
  proof: CompositeV2Proof;
  ticker: string;
  price: bigint;
  expo: number;
  url: string;
}) {
  const table = proofTable(proof);
  const matches = sameAsChain(proof.price, price, expo);
  return (
    <>
      <div className="scroll-thin max-w-full overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left text-meta">
          <caption className="sr-only">
            The markets that priced {ticker} at {etShort(proof.window.from)} ET, and what each one counted for
          </caption>
          <thead>
            <tr className="text-dim">
              <th scope="col" className="label py-1 pr-3 font-normal">
                Market
              </th>
              <th scope="col" className="label py-1 pr-3 font-normal">
                Last trade
              </th>
              <th scope="col" className="label py-1 pr-3 font-normal">
                Counted
              </th>
              {table.minutes.map((t) => (
                <th key={t} scope="col" className="label num py-1 pr-3 text-right font-normal">
                  {etShort(t)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={`${r.venue}:${r.instrument}`} className="border-t border-line align-top">
                <th scope="row" className="py-1.5 pr-3 font-normal">
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5 text-ink">
                      {r.venue}
                      {r.anchor ? <Badge variant="neutral">anchor</Badge> : null}
                    </span>
                    {r.request.href ? (
                      <a href={r.request.href} target="_blank" rel="noreferrer" className="link num truncate" title={r.request.href}>
                        {r.instrument}
                      </a>
                    ) : (
                      <span className="num truncate text-dim" title={`${r.request.label} ${r.request.body ?? ""}`}>
                        {r.instrument} · POST
                      </span>
                    )}
                  </span>
                </th>
                <td className="num py-1.5 pr-3 text-dim">{r.lastTraded !== null ? etShort(r.lastTraded) : "none"}</td>
                <td className={cx("py-1.5 pr-3", r.counted ? "text-ink" : "text-dim")}>{r.why}</td>
                {r.cells.map((c) => (
                  <td
                    key={c.t}
                    className={cx("num py-1.5 pr-3 text-right", c.kept ? "text-ink" : "text-dim", r.counted && !c.kept && "line-through")}
                    title={c.close !== null ? `close ${c.close}` : undefined}
                  >
                    {r.counted ? (c.calibrated ?? "--") : (c.close ?? "--")}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-line">
              <th scope="row" colSpan={3} className="label py-1.5 pr-3 font-normal text-ink">
                Median of each minute
              </th>
              {table.medians.map((m, i) => (
                <td key={table.minutes[i]} className="num py-1.5 pr-3 text-right text-ink">
                  {m ?? "--"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-meta text-dim">
        {proof.price !== null ? (
          <>
            Price <span className="num text-ink">{ticksText(proof.price)}</span>, the median of the minutes, stamped{" "}
            {etShort(proof.publishTime)} ET.{" "}
            {matches ? "It is exactly the price on chain." : "It is not the price on chain."}
          </>
        ) : (
          <>No 24/7 price: this side took the exchange&apos;s first bar.</>
        )}{" "}
        A counted market&apos;s minutes are its closes corrected by its premium to the others; a struck value was dropped by the
        50 bps guard. A market that did not count shows its raw closes.
      </p>
      {proofSentences(proof, ticker).map((s) => (
        <p key={s} className="text-meta text-dim">
          {s}
        </p>
      ))}
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-meta text-dim">
        <span>Rule {ruleWords(body.rule)} · sha256</span>
        <span className="num min-w-0 break-all text-ink">{body.sha256}</span>
        <a href={url} target="_blank" rel="noreferrer" className="link">
          Raw proof
        </a>
      </p>
    </>
  );
}
