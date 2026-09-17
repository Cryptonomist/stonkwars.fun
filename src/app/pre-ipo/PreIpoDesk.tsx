"use client";

/* COMPANIES THAT ARE NOT PUBLIC YET.
 *
 * The rest of this site is listed stocks: a ticker, an exchange, a closing
 * bell. These seven have none of that and never have. They exist here because
 * somebody tokenized exposure to them on Solana, and those tokens trade in
 * ordinary pools at three in the morning on a Sunday, which is the one thing
 * this whole product was built around.
 *
 * WHAT THIS PAGE IS HONEST ABOUT, because a page that sells private-company
 * exposure has more to be honest about than most:
 *
 *   the price is a real routed quote, not an index, because the indexes were
 *   wrong here by up to 62% and a quote is the number the buy button honours
 *
 *   the cost of actually buying is shown next to the price, because a $100 buy
 *   moves Neuralink 3.4% and OpenAI not at all, and that difference is the
 *   whole story of whether a market is real
 *
 *   these cannot be staked, and the reason is stated rather than hidden */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { TradePanel } from "@/components/TradePanel";
import { Badge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/Notice";
import { Plate } from "@/components/ui/Plate";
import { SectionHead } from "@/components/ui/SectionHead";
import { Skeleton } from "@/components/ui/Skeleton";
import { pct, usd } from "@/lib/format";
import { NOT_STAKEABLE_BECAUSE, PRESTOCKS, type PreStock } from "@/lib/prestocks";

type Quote = { usd: number | null; change24h: number | null; trades24h: number | null; impactPct: number | null; route: string[] };
type Prices = { at: number; probeUsd: number; prices: Record<string, Quote>; note?: string };

/* What a hundred dollars costs you beyond the price. Under a quarter of a
 * percent is a real market; three percent is a thin one wearing a price tag. */
function depthWords(impact: number | null, probe: number) {
  if (impact == null) return { word: "not quoting", tone: "warn" as const };
  if (impact < 0.25) return { word: `deep, $${probe} moves it ${impact.toFixed(2)}%`, tone: "ok" as const };
  if (impact < 1.5) return { word: `fair, $${probe} moves it ${impact.toFixed(2)}%`, tone: "ok" as const };
  return { word: `thin, $${probe} moves it ${impact.toFixed(1)}%`, tone: "warn" as const };
}

export function PreIpoDesk({ initial }: { initial: string }) {
  const [picked, setPicked] = useState(() => (PRESTOCKS.some((p) => p.ticker === initial) ? initial : PRESTOCKS[0].ticker));

  const q = useQuery<Prices>({
    queryKey: ["prestocks"],
    queryFn: async () => {
      const r = await fetch("/api/prestocks");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const rows = useMemo(
    () => PRESTOCKS.map((p) => ({ p, quote: q.data?.prices[p.ticker] })),
    [q.data],
  );
  const probe = q.data?.probeUsd ?? 100;
  const chosen: PreStock = PRESTOCKS.find((p) => p.ticker === picked) ?? PRESTOCKS[0];

  return (
    <div className="flex flex-col gap-6 py-6">
      <Plate as="header" notch pad="std" className="flex flex-col gap-3">
        <p className="label">Not public yet</p>
        <h1 className="display text-hud-lg text-ink">Buy the companies that never listed</h1>
        <p className="max-w-prose text-sm text-dim">
          OpenAI, Anthropic and Neuralink have no ticker and no exchange, so there is no bell for them to close at.
          Tokenized on Solana, they trade every hour of every day, and you can buy them here in your own wallet. Prices
          are live routed quotes, not an index.
        </p>
      </Plate>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="pre-list">
          <SectionHead id="pre-list" title="Private companies" count={`${PRESTOCKS.length} tradable`} />
          <Plate pad="none" className="flex flex-col">
            {rows.map(({ p, quote }) => {
              const on = p.ticker === picked;
              const depth = depthWords(quote?.impactPct ?? null, probe);
              return (
                <button
                  key={p.ticker}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked(p.ticker)}
                  className={cx("row flex min-h-11 min-w-0 flex-col gap-1 px-3 py-3 text-left", on && "bg-panel-2")}
                >
                  <span className="flex min-w-0 items-baseline gap-3">
                    <span className="display shrink-0 text-base font-black" style={{ color: p.color }}>
                      {p.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-meta text-dim">{p.blurb}</span>
                    <span className="num shrink-0 text-sm text-ink">
                      {q.isLoading ? <Skeleton className="h-4 w-16" /> : quote?.usd == null ? "no quote" : usd(quote.usd)}
                    </span>
                    <span
                      className={cx(
                        "num w-16 shrink-0 text-right text-meta",
                        quote?.change24h == null ? "text-faint" : quote.change24h < 0 ? "text-down" : "text-up",
                      )}
                    >
                      {quote?.change24h == null ? "" : pct(quote.change24h)}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-micro text-dim">
                    <Badge>24/7</Badge>
                    <span className={depth.tone === "warn" ? "text-cooked" : "text-dim"}>{depth.word}</span>
                    {quote?.route?.length ? <span className="text-faint">via {quote.route.join(" + ")}</span> : null}
                  </span>
                </button>
              );
            })}
          </Plate>
          {q.data?.note ? <Notice tone="warn" title={q.data.note}>The list is still here; only the prices are missing.</Notice> : null}
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <TradePanel key={chosen.ticker} ticker={chosen.ticker} embedded />
          <Notice title="These cannot be fought over.">
            {NOT_STAKEABLE_BECAUSE}{" "}
            <Link href="/how" className="link">
              How fights work
            </Link>
          </Notice>
          <p className="text-meta text-dim">
            Exposure is issued by PreStocks against a holding in the company. It is not shares in the company, it does
            not vote, and its price is whatever this market says it is.{" "}
            {chosen.ticker === "FIGUREAI" ? "Figure AI is the robotics company, not Figure Technology Solutions, which lists here as FIGR. " : ""}
            SpaceX is already listed on this site as{" "}
            <Link href="/s/SPCX" className="link">
              SPCX
            </Link>
            , where it can be fought over, so it is not repeated here.
          </p>
        </aside>
      </div>
    </div>
  );
}
