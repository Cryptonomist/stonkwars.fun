"use client";

/* Pick a fighter from every tokenized stock that can be staked here, a
 * thousand-odd: search by ticker or name, or narrow to stocks, ETFs or the
 * ones that fight around the clock. The most traded names come first (roster
 * order), and the pick stays in view however the list is searched.
 *
 * ONE PICKER, TWO CORNERS. The page decides which corner it is editing and
 * passes `side`; the tile the other corner holds is shown but cannot be
 * picked, because a stock cannot fight itself.
 *
 * NO SCROLL INSIDE A SCROLL ON A PHONE. A list that scrolls inside a page that
 * also scrolls traps a thumb: the page stops moving halfway down and the list
 * starts. Below lg the grid flows in the page, a few rows at a time, with
 * "Show more". From lg it sits beside the ticket and gets a fixed height of its
 * own, so the ticket and its button stay put.
 *
 * Prices are fetched only for tiles on screen, in groups the price route
 * accepts in one request (MAX_PRICE_TICKERS). Every tile carries who prices
 * the stock (Pyth, or the Stonk Wars oracle) and whether it can fight while
 * the exchange is shut. */

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { Move } from "@/components/Ticker";
import { Badge } from "@/components/ui/Badge";
import { FlashNum } from "@/components/ui/FlashNum";
import { Tabs } from "@/components/ui/Tabs";
import { cx } from "@/components/ui/cx";
import { usd } from "@/lib/format";
import { dayChangePct, MAX_PRICE_TICKERS, quoteValue, usePrices, type Quotes } from "@/lib/prices";
import { STAKEABLE, byTicker, quoteSymbolFor, tradesAroundTheClock, type Stock } from "@/lib/stocks";

type Kind = "all" | "stock" | "etf" | "allday";

/** Tiles before "Show more": a screenful beside the ticket, a few rows on a phone. */
const PAGE_WIDE = 48;
const PAGE_PHONE = 12;
/** Tiles per price request: whole pages, and never more than the route takes. */
const PRICE_GROUP = Math.min(PAGE_WIDE, MAX_PRICE_TICKERS);

const ofKind = (s: Stock, kind: Kind) =>
  kind === "all" || (kind === "allday" ? tradesAroundTheClock(s.ticker) : s.kind === kind);

const COUNTS: Record<Kind, number> = {
  all: STAKEABLE.length,
  stock: STAKEABLE.filter((s) => s.kind === "stock").length,
  etf: STAKEABLE.filter((s) => s.kind === "etf").length,
  allday: STAKEABLE.filter((s) => tradesAroundTheClock(s.ticker)).length,
};

/** True from lg up. False on the first render, which is the phone layout. */
function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export function StockPicker({
  side,
  value,
  taken,
  onChange,
  id,
  className,
}: {
  side: "p1" | "p2";
  value: string | null;
  /** The other corner's pick: a stock cannot fight itself. */
  taken: string | null;
  onChange: (ticker: string) => void;
  id?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const wide = useWide();
  const page = wide ? PAGE_WIDE : PAGE_PHONE;
  const [pages, setPages] = useState(1);
  const shown = pages * page;

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return STAKEABLE.filter((s) => ofKind(s, kind));
    const match = STAKEABLE.filter(
      (s) => ofKind(s, kind) && (s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)),
    );
    // An exact ticker first, then tickers that start with the query, then the rest.
    const rank = (s: Stock) => {
      const t = s.ticker.toLowerCase();
      return t === q ? 0 : t.startsWith(q) ? 1 : 2;
    };
    return match.sort((a, b) => rank(a) - rank(b));
  }, [query, kind]);

  const visible = useMemo(() => {
    const first = hits.slice(0, shown);
    /* Keep the current pick in sight while somebody types, so a search does
     * not appear to lose it. NOT when they have switched filters, though:
     * pinning a stock to the top of the ETFs tab makes the tab look like it
     * ignored the click, which is exactly what it was reported as. A filter is
     * an instruction about what belongs on screen, and the pick is not exempt. */
    const picked = value ? byTicker(value) : undefined;
    const belongs = picked && ofKind(picked, kind);
    return belongs && !first.includes(picked) ? [picked, ...first] : first;
  }, [hits, shown, value, kind]);

  const groups: Stock[][] = [];
  for (let i = 0; i < visible.length; i += PRICE_GROUP) groups.push(visible.slice(i, i + PRICE_GROUP));

  const reset = () => setPages(1);

  /* Enter in the search picks the best match, so a keyboard can go from typing
   * "nvda" to a chosen corner without a tab stop per tile. */
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const best = hits.find((s) => s.ticker !== taken);
    if (best) {
      e.preventDefault();
      onChange(best.ticker);
    }
  };

  const left = hits.length - Math.min(hits.length, shown);

  return (
    <div id={id} className={cx("min-w-0", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            reset();
          }}
          onKeyDown={onSearchKey}
          placeholder={`Search ${COUNTS.all.toLocaleString()} tokenized stocks`}
          aria-label={`Search stocks for ${side === "p1" ? "your" : "their"} corner`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className="input min-w-0 sm:max-w-xs"
        />
        {/* Tighter plates below sm, so all four filters and their counts fit
          * one row on a 375px phone instead of leaving 24/7 alone on a second. */}
        <Tabs
          className="[&>button]:px-2.5 sm:[&>button]:px-4"
          ariaLabel="Filter stocks"
          value={kind}
          onChange={(k) => {
            setKind(k);
            reset();
          }}
          items={[
            { id: "all", label: "All", count: COUNTS.all },
            { id: "stock", label: "Stocks", count: COUNTS.stock },
            { id: "etf", label: "ETFs", count: COUNTS.etf },
            { id: "allday", label: "24/7", count: COUNTS.allday },
          ]}
        />
      </div>

      <div className="scroll-thin mt-3 lg:max-h-[28rem] lg:overflow-y-auto">
        {hits.length === 0 && !visible.length ? (
          <p className="py-6 text-sm text-dim">Nothing matches &ldquo;{query}&rdquo;.</p>
        ) : (
          /* p-1 keeps each tile's focus ring inside the scroll box at lg,
           * where the overflow would otherwise cut it. */
          <div className="p-1">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {groups.map((g, i) => (
                <TileGroup
                  key={i}
                  stocks={g}
                  side={side}
                  value={value}
                  taken={taken}
                  onPick={onChange}
                />
              ))}
            </div>
            {hits.length === 0 ? (
              <p className="py-4 text-sm text-dim">Nothing else matches &ldquo;{query}&rdquo;.</p>
            ) : null}
            {left > 0 ? (
              <button type="button" onClick={() => setPages((n) => n + 1)} className="btn btn-sm btn-ghost mt-3 w-full">
                Show more <span className="num text-dim">{left.toLocaleString()} left</span>
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/* One price request's worth of tiles. `contents`, so the tiles still sit in
 * the parent grid as if this wrapper were not there. */
function TileGroup({
  stocks,
  side,
  value,
  taken,
  onPick,
}: {
  stocks: Stock[];
  side: "p1" | "p2";
  value: string | null;
  taken: string | null;
  onPick: (ticker: string) => void;
}) {
  const prices = usePrices(
    stocks.map((s) => s.ticker),
    15_000,
  );
  return (
    <div className="contents">
      {stocks.map((s) => (
        <Tile
          key={s.ticker}
          s={s}
          side={side}
          selected={s.ticker === value}
          held={s.ticker === taken}
          quotes={prices.data}
          onPick={() => onPick(s.ticker)}
        />
      ))}
    </div>
  );
}

function Tile({
  s,
  side,
  selected,
  held,
  quotes,
  onPick,
}: {
  s: Stock;
  side: "p1" | "p2";
  selected: boolean;
  held: boolean;
  quotes: Quotes | undefined;
  onPick: () => void;
}) {
  const q = quotes?.quotes[s.ticker];
  const price = quoteValue(q);
  const allDay = tradesAroundTheClock(s.ticker);
  const offHours = quoteSymbolFor(s.feed)?.perp ? "perpetual future" : "Solana pool";
  const why = [
    s.name,
    s.market === "US" ? null : `listed in ${s.market}`,
    `priced by ${s.source === "pyth" ? "Pyth" : "the Stonk Wars oracle"}`,
    allDay ? `its ${offHours} prices it when the exchange is shut` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      disabled={held}
      aria-pressed={selected}
      onClick={onPick}
      title={why}
      className={cx(
        "row card flex min-w-0 flex-col items-stretch gap-1 px-3 py-2.5 text-left",
        selected && (side === "p1" ? "bg-p1-tint ring-2 ring-p1 ring-inset" : "bg-p2-tint ring-2 ring-p2 ring-inset"),
        held && "cursor-not-allowed opacity-50",
      )}
    >
      {/* One badge per line, so a five-letter ticker never loses letters to
        * them in a four-column grid. */}
      {/* The source badge only where it is the exception: all but a handful of
        * a thousand tiles are priced by the oracle, and "ORACLE" on each of
        * them was noise that hid the rare Pyth one. The tile's title and the
        * ticket still name every source. */}
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="display min-w-0 truncate text-hud-xs normal-case">{s.ticker}</span>
        {s.source === "pyth" ? (
          <Badge variant="source" className="ml-auto">
            Pyth
          </Badge>
        ) : null}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-meta text-dim">{s.name}</span>
        {allDay || s.market !== "US" ? (
          <Badge variant="neutral" className="ml-auto">
            {allDay ? "24/7" : s.market}
          </Badge>
        ) : null}
      </span>
      {held ? (
        <span className="micro text-dim">{side === "p1" ? "Their corner" : "Your corner"}</span>
      ) : (
        <span className="flex min-w-0 items-baseline justify-between gap-2 text-meta">
          <FlashNum value={price} className="num text-ink">
            {price !== null ? usd(price) : "--"}
          </FlashNum>
          <Move value={dayChangePct(q)} className="num truncate" />
        </span>
      )}
    </button>
  );
}
