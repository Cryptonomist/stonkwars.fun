"use client";

/* THE TRADE DESK, LAID OUT LIKE A TRADING APP.
 *
 * Somebody who opens /trade came to trade, so the ticket is on the first
 * screen at every width, the way Fomo, Robinhood and Coinbase do it: the
 * stock and its price at the top, the chart, and Buy and Sell where the eye
 * or the thumb already is. It used to open on a page-wide title and a
 * fourteen-row list, with the ticket 850px down on a laptop and 1,750px down
 * on a phone.
 *
 *   From lg: the chart on the left and the ticket beside it, sticky, so it
 *   stays in reach while the list below the chart scrolls.
 *
 *   Below lg: the chart, and a Buy / Sell bar pinned above the bottom nav
 *   that opens the ticket as a sheet, which is where a phone keeps its
 *   trading buttons. The same pattern as the fight ticket's bar in
 *   app/new/CreateFight.tsx.
 *
 * The ticket is mounted in exactly one place at a time. It quotes as soon as
 * it exists (a $25 buy, every 15 seconds), so a copy hidden with CSS would
 * quote for nobody.
 *
 * Nothing here is new machinery. The list is the same roster and prices every
 * board reads, the ticket is components/TradePanel, and the wallet signs. On
 * devnet the ticket says the quotes are mainnet prices for reference and offers
 * the faucet instead, because only mainnet has markets for these tokens. */

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@solana/wallet-adapter-react";

import { IntradayChart } from "@/app/s/[ticker]/IntradayChart";
import { Move } from "@/components/Ticker";
import { TradePanel } from "@/components/TradePanel";
import { Badge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { FlashNum } from "@/components/ui/FlashNum";
import { Plate } from "@/components/ui/Plate";
import { SectionHead } from "@/components/ui/SectionHead";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { shares, usd } from "@/lib/format";
import { dayChangePct, quoteValue, usePrices } from "@/lib/prices";
import { byTicker, CLUSTER, STAKEABLE, tokenSymbol, tradesAroundTheClock } from "@/lib/stocks";
import { useHoldings } from "@/lib/useHoldings";
import type { Side } from "@/lib/swap";

const SHOWN = 14;
/** The roster is ordered with the names people know first; these are the chips. */
const QUICK = STAKEABLE.slice(0, 8).map((s) => s.ticker);
const WIDE = "(min-width: 1024px)";

/** Whether the ticket belongs beside the chart (lg and up). Null until mounted,
 *  so the server and the first paint agree. */
function useWide(): boolean | null {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export function TradeTerminal({ ticker, side }: { ticker: string; side: Side }) {
  const { publicKey } = useWallet();
  const wide = useWide();
  const [picked, setPicked] = useState(ticker);
  const [startSide, setStartSide] = useState<Side>(side);
  const [search, setSearch] = useState("");
  /** Below lg, the side the sheet is open on; null when it is shut. */
  const [sheet, setSheet] = useState<Side | null>(null);

  const matches = useMemo(() => {
    const q = search.trim().toUpperCase();
    const list = q
      ? STAKEABLE.filter((s) => s.ticker.includes(q) || s.name.toUpperCase().includes(q))
      : STAKEABLE;
    return list.slice(0, SHOWN);
  }, [search]);

  const prices = usePrices([...new Set([picked, ...QUICK, ...matches.map((s) => s.ticker)])], 10_000);
  const holdings = useHoldings(publicKey ? publicKey.toBase58() : null, !!publicKey);
  const held = holdings.valued.filter((h) => h.raw > 0n);

  const stock = byTicker(picked);
  const quote = prices.data?.quotes[picked];
  const price = quoteValue(quote);
  const change = dayChangePct(quote);
  const symbol = tokenSymbol(picked);

  /* Changing stock or side remounts the ticket, so its amount, quote and tab
   * start from the new thing rather than the last one. */
  const panelKey = `${picked}:${startSide}`;

  /** Pick a stock from anywhere on the page. On a phone the price and chart
   *  are at the top, so go back up to them. */
  const pick = (t: string) => {
    setPicked(t);
    setStartSide("buy");
    if (wide === false) window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** Sell something held: beside the chart from lg, in the sheet below it. */
  const sell = (t: string) => {
    setPicked(t);
    setStartSide("sell");
    if (wide === false) setSheet("sell");
  };

  return (
    <div className="flex flex-col gap-6 py-6">
      <Plate as="header" notch pad="std" className="flex flex-col gap-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="label flex min-w-0 items-center gap-2 truncate">
            Trade
            {tradesAroundTheClock(picked) ? <Badge>24/7</Badge> : null}
          </p>
          <Link href={`/new?p1=${picked}`} className="btn btn-sm btn-ghost shrink-0">
            Fight with {picked}
          </Link>
        </div>

        {/* The stock and its price side by side at every width, as on a stock's
          * own page: the first thing a trading screen answers is "what is it
          * and what is it doing". */}
        <div className="-mt-1 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 className="display text-hud-lg text-ink">{picked}</h1>
            <p className="mt-1 truncate text-sm text-dim">
              {stock?.name ?? picked} <span className="text-faint">·</span>{" "}
              <Link href={`/s/${picked}`} className="link text-dim">
                stock page
              </Link>
            </p>
          </div>
          <div className="flex min-w-0 flex-col items-end gap-1 text-right">
            {price !== null ? (
              <FlashNum value={price} className="num text-num-lg font-semibold text-ink">
                {usd(price)}
              </FlashNum>
            ) : prices.isError ? (
              <p className="text-sm text-dim">No price right now</p>
            ) : (
              <Skeleton className="h-6 w-28" />
            )}
            {change !== null ? (
              <p className="flex items-baseline gap-2">
                <Move value={change} className="num text-sm" />
                <span className="text-meta text-dim">today</span>
              </p>
            ) : null}
          </div>
        </div>

        {/* The names people trade, one tap away. Scrolls sideways on a phone
          * inside its own row, never the page. */}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Popular stocks">
          {QUICK.map((t) => {
            const m = dayChangePct(prices.data?.quotes[t]);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={t === picked}
                onClick={() => pick(t)}
                className={cx("btn btn-sm shrink-0 gap-2", t === picked ? "btn-light" : "btn-ghost")}
              >
                {t}
                {m !== null && t !== picked ? <Move value={m} className="num text-micro" /> : null}
              </button>
            );
          })}
        </div>
      </Plate>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <IntradayChart
            ticker={picked}
            prevClose={quote?.prev ? Number(quote.prev) * 10 ** quote.expo : null}
            charted={stock?.market === "US"}
          />

          <Holdings publicKeySet={!!publicKey} holdings={holdings} held={held} onSell={sell} />

          <section className="flex min-w-0 flex-col gap-3" aria-labelledby="trade-stocks">
            <SectionHead id="trade-stocks" title="Stocks" count={`${STAKEABLE.length} tradable`} />
            <input
              id="trade-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a stock"
              aria-label="Find a stock"
              className="input w-full py-2"
            />
            <Plate pad="none" className="flex flex-col">
              {matches.map((s) => {
                const q = prices.data?.quotes[s.ticker];
                const p = quoteValue(q);
                const move = dayChangePct(q);
                const on = s.ticker === picked;
                return (
                  <button
                    key={s.ticker}
                    type="button"
                    aria-pressed={on}
                    onClick={() => pick(s.ticker)}
                    className={cx("row flex min-h-11 min-w-0 items-center gap-3 px-3 py-2 text-left", on && "bg-panel-2")}
                  >
                    <span className="display w-16 shrink-0 truncate text-base font-black text-ink">{s.ticker}</span>
                    <span className="min-w-0 flex-1 truncate text-meta text-dim">{s.name}</span>
                    {tradesAroundTheClock(s.ticker) ? <Badge>24/7</Badge> : null}
                    <span className="num shrink-0 text-sm text-ink">{p === null ? "--" : usd(p)}</span>
                    <Move value={move} className="num w-16 shrink-0 text-right text-meta" />
                  </button>
                );
              })}
              {matches.length === 0 ? <p className="px-3 py-3 text-sm text-dim">No stock matches {search}.</p> : null}
            </Plate>
          </section>
        </div>

        {/* The ticket, from lg. Sticky under the site header, so it stays in
          * reach while the list scrolls. Until the width is known a skeleton
          * holds its place, so nothing jumps when it arrives. */}
        <aside className="hidden min-w-0 lg:sticky lg:top-[4.5rem] lg:block" aria-label={`Trade ${symbol}`}>
          {wide ? (
            <TradePanel key={panelKey} ticker={picked} initialSide={startSide} />
          ) : (
            <Skeleton className="h-[30rem] w-full" />
          )}
        </aside>
      </div>

      {wide === false ? (
        <>
          <TradeBar hidden={sheet !== null} symbol={symbol} onBuy={() => setSheet("buy")} onSell={() => setSheet("sell")} />
          <Sheet
            open={sheet !== null}
            onClose={() => setSheet(null)}
            title={
              <>
                Trade <span className="normal-case">{symbol}</span>
              </>
            }
          >
            {sheet ? (
              <TradePanel key={`${picked}:${sheet}`} ticker={picked} embedded initialSide={sheet} onTraded={() => setSheet(null)} />
            ) : null}
          </Sheet>
        </>
      ) : null}
    </div>
  );
}

function Holdings({
  publicKeySet,
  holdings,
  held,
  onSell,
}: {
  publicKeySet: boolean;
  holdings: ReturnType<typeof useHoldings>;
  held: ReturnType<typeof useHoldings>["valued"];
  onSell: (ticker: string) => void;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="trade-holdings">
      <SectionHead id="trade-holdings" title="What you hold" count={holdings.total !== null ? usd(holdings.total) : null} />
      <Plate pad="none" className="flex flex-col">
        {!publicKeySet ? (
          <p className="px-3 py-3 text-sm text-dim">Connect a wallet to see your shares.</p>
        ) : holdings.holdings.data === undefined ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : held.length === 0 ? (
          <p className="px-3 py-3 text-sm text-dim">
            No tokenized stocks yet. {CLUSTER === "mainnet-beta" ? "Buy some here." : "Get free test shares from Buy."}
          </p>
        ) : (
          held.map((h) => (
            <div key={h.ticker} className="row flex min-h-11 min-w-0 items-center gap-3 px-3 py-2">
              <span className="display w-14 shrink-0 truncate text-base font-black text-ink">{h.ticker}</span>
              <span className="num min-w-0 flex-1 truncate text-meta text-dim">
                {shares(h.raw, h.decimals)} <span className="normal-case">{tokenSymbol(h.ticker)}</span>
              </span>
              <span className="num shrink-0 text-meta text-ink">{h.usd === null ? "" : usd(h.usd)}</span>
              <button type="button" onClick={() => onSell(h.ticker)} className="btn btn-sm btn-ghost shrink-0">
                Sell
              </button>
            </div>
          ))
        )}
      </Plate>
    </section>
  );
}

/* BUY AND SELL UNDER THE THUMB, below lg. Fixed above the phone's bottom nav,
 * with its height reserved at the very end of the page so it never covers the
 * footer's last line. Hidden while the sheet is open, since the sheet is the
 * same two buttons grown up. */
function TradeBar({
  hidden,
  symbol,
  onBuy,
  onSell,
}: {
  hidden: boolean;
  symbol: string;
  onBuy: () => void;
  onSell: () => void;
}): ReactNode {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <>
      <div
        role="region"
        aria-label={`Buy or sell ${symbol}`}
        hidden={hidden}
        className="rope fixed inset-x-0 z-35 bg-panel-2 shadow-overlay"
        style={{ bottom: "calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          <button type="button" onClick={onBuy} aria-haspopup="dialog" className="btn btn-primary flex-1">
            Buy <span className="normal-case">{symbol}</span>
          </button>
          <button type="button" onClick={onSell} aria-haspopup="dialog" className="btn btn-ghost flex-1">
            Sell
          </button>
        </div>
      </div>
      {hidden ? null : <div aria-hidden="true" className="h-16" />}
    </>,
    document.body,
  );
}
