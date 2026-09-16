"use client";

/* THE TRADE DESK.
 *
 * A stock's page has a trade panel, but somebody who wants to buy first should
 * not have to know which stock's page to open. Here the whole roster is on the
 * left, what the wallet holds is on the right, and the panel is between them:
 * pick a stock and buy it, or press Sell on something you hold.
 *
 * Nothing here is new machinery. The list is the same roster and prices every
 * board reads, the panel is components/TradePanel, and the wallet signs. On
 * devnet the panel says the quotes are mainnet prices for reference and offers
 * the faucet instead, because only mainnet has markets for these tokens. */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { IntradayChart } from "@/app/s/[ticker]/IntradayChart";
import { TradePanel } from "@/components/TradePanel";
import { Badge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { Plate } from "@/components/ui/Plate";
import { SectionHead } from "@/components/ui/SectionHead";
import { Skeleton } from "@/components/ui/Skeleton";
import { shares, usd } from "@/lib/format";
import { dayChangePct, quoteValue, usePrices } from "@/lib/prices";
import { byTicker, CLUSTER, STAKEABLE, tokenSymbol, tradesAroundTheClock } from "@/lib/stocks";
import { useHoldings } from "@/lib/useHoldings";
import type { Side } from "@/lib/swap";

const SHOWN = 14;

export function TradeTerminal({ ticker, side }: { ticker: string; side: Side }) {
  const { publicKey } = useWallet();
  const [picked, setPicked] = useState(ticker);
  const [startSide, setStartSide] = useState<Side>(side);
  const [search, setSearch] = useState("");

  const matches = useMemo(() => {
    const q = search.trim().toUpperCase();
    const list = q
      ? STAKEABLE.filter((s) => s.ticker.includes(q) || s.name.toUpperCase().includes(q))
      : STAKEABLE;
    return list.slice(0, SHOWN);
  }, [search]);

  const prices = usePrices([...new Set([picked, ...matches.map((s) => s.ticker)])], 10_000);
  const holdings = useHoldings(publicKey ? publicKey.toBase58() : null, !!publicKey);
  const held = holdings.valued.filter((h) => h.raw > 0n);

  /* Changing stock or side remounts the panel, so its amount, quote and tab
   * start from the new thing rather than the last one. */
  const panelKey = `${picked}:${startSide}`;

  return (
    <div className="flex flex-col gap-6 py-6">
      <Plate as="header" notch pad="std" className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="label">Trade</p>
          <h1 className="display mt-1 text-hud-lg text-ink">Buy and sell stocks</h1>
          <p className="mt-2 max-w-prose text-sm text-dim">
            Tokenized shares, swapped on Solana through Jupiter, in your own wallet. Own the shares and you can stake them
            in a fight.
          </p>
        </div>
        <Link href={`/new?p1=${picked}`} className="btn btn-primary shrink-0">
          Fight with {picked}
        </Link>
      </Plate>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)_minmax(0,3fr)]">
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="trade-stocks">
          <SectionHead id="trade-stocks" title="Stocks" count={`${STAKEABLE.length} tradeable`} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a stock"
            aria-label="Find a stock"
            className="input w-full py-2"
          />
          <Plate pad="none" className="flex flex-col">
            {matches.map((s) => {
              const q = prices.data?.quotes[s.ticker];
              const price = quoteValue(q);
              const move = dayChangePct(q);
              const on = s.ticker === picked;
              return (
                <button
                  key={s.ticker}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setPicked(s.ticker);
                    setStartSide("buy");
                  }}
                  className={cx(
                    "row flex min-h-11 min-w-0 items-center gap-3 px-3 py-2 text-left",
                    on && "bg-panel-2",
                  )}
                >
                  <span className="display w-16 shrink-0 truncate text-base font-black text-ink">{s.ticker}</span>
                  <span className="min-w-0 flex-1 truncate text-meta text-dim">{s.name}</span>
                  {tradesAroundTheClock(s.ticker) ? <Badge>24/7</Badge> : null}
                  <span className="num shrink-0 text-sm text-ink">{price === null ? "--" : usd(price)}</span>
                  <span
                    className={cx("num w-16 shrink-0 text-right text-meta", (move ?? 0) < 0 ? "text-down" : "text-up")}
                  >
                    {move === null ? "" : `${move > 0 ? "+" : ""}${move.toFixed(2)}%`}
                  </span>
                </button>
              );
            })}
            {matches.length === 0 ? <p className="px-3 py-3 text-sm text-dim">No stock matches {search}.</p> : null}
          </Plate>
        </section>

        <div className="flex min-w-0 flex-col gap-6">
          <IntradayChart
            ticker={picked}
            prevClose={prices.data?.quotes[picked]?.prev ? Number(prices.data.quotes[picked]!.prev) * 10 ** prices.data.quotes[picked]!.expo : null}
            charted={byTicker(picked)?.market === "US"}
          />
          <TradePanel key={panelKey} ticker={picked} initialSide={startSide} />
        </div>

        <aside className="flex min-w-0 flex-col gap-3" aria-labelledby="trade-holdings">
          <SectionHead
            id="trade-holdings"
            title="What you hold"
            count={holdings.total !== null ? usd(holdings.total) : null}
          />
          <Plate pad="none" className="flex flex-col">
            {!publicKey ? (
              <p className="px-3 py-3 text-sm text-dim">Connect a wallet to see your shares.</p>
            ) : holdings.holdings.data === undefined ? (
              <div className="flex flex-col gap-2 p-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : held.length === 0 ? (
              <p className="px-3 py-3 text-sm text-dim">
                No stock tokens yet. {CLUSTER === "mainnet-beta" ? "Buy some here." : "Get free test shares from the panel."}
              </p>
            ) : (
              held.map((h) => (
                <div key={h.ticker} className="row flex min-h-11 min-w-0 items-center gap-3 px-3 py-2">
                  <span className="display w-14 shrink-0 truncate text-base font-black text-ink">{h.ticker}</span>
                  <span className="num min-w-0 flex-1 truncate text-meta text-dim">
                    {shares(h.raw, h.decimals)} <span className="normal-case">{tokenSymbol(h.ticker)}</span>
                  </span>
                  <span className="num shrink-0 text-meta text-ink">{h.usd === null ? "" : usd(h.usd)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(h.ticker);
                      setStartSide("sell");
                    }}
                    className="btn btn-sm btn-ghost shrink-0"
                  >
                    Sell
                  </button>
                </div>
              ))
            )}
          </Plate>
          <p className="text-meta text-dim">
            {byTicker(picked)?.name ?? picked} and every other listed stock has its own page with a chart and its record:{" "}
            <Link href={`/s/${picked}`} className="link">
              {picked} page
            </Link>
          </p>
        </aside>
      </div>
    </div>
  );
}
