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
 * the exchange is shut.
 *
 * LIVE 24/7 FIRST WHILE THE EXCHANGE IS SHUT. Somebody who opens the picker at
 * midnight or on a Saturday wants a fight that runs now. The "Live 24/7"
 * filter narrows to the stocks the 24/7 markets price (stocks.ts,
 * tradesAroundTheClock), and while the exchange is shut the default order puts
 * them first, the most traded of them leading, with a line that says so. */

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { Move } from "@/components/Ticker";
import { Badge } from "@/components/ui/Badge";
import { FlashNum } from "@/components/ui/FlashNum";
import { Tabs } from "@/components/ui/Tabs";
import { cx } from "@/components/ui/cx";
import { allDuels } from "@/lib/duel";
import { usd } from "@/lib/format";
import { useDuels } from "@/lib/hooks";
import { dayChangePct, MAX_PRICE_TICKERS, quoteValue, usePrices, type Quotes } from "@/lib/prices";
import { session } from "@/lib/market";
import { STAKEABLE, byTicker, offHoursWords, tickerForMint, tradesAroundTheClock, type Stock } from "@/lib/stocks";
import { useNow } from "@/lib/useNow";

export type Kind = "all" | "stock" | "etf" | "allday";
type Sort = "default" | "movers" | "fought";

const SORTS: { id: Sort; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "movers", label: "Movers" },
  { id: "fought", label: "Most fought" },
];

/* The duel list is read only once somebody asks for Most fought: the pick
 * screen does not otherwise need it, so this mounts with that choice and hands
 * the counts up. A fight counts once per stock in it. */
function FoughtCounts({ onCounts }: { onCounts: (m: Map<string, number>) => void }) {
  const duels = useDuels("all", allDuels());
  useEffect(() => {
    if (!duels.data) return;
    const n = new Map<string, number>();
    for (const d of duels.data) {
      for (const t of new Set([tickerForMint(d.creatorMint), tickerForMint(d.opponentMint)])) {
        if (t) n.set(t, (n.get(t) ?? 0) + 1);
      }
    }
    onCounts(n);
  }, [duels.data, onCounts]);
  return null;
}

/** Tiles before "Show more": a screenful beside the ticket, a few rows on a phone. */
const PAGE_WIDE = 48;
const PAGE_PHONE = 12;
/** Tiles per price request: whole pages, and never more than the route takes. */
const PRICE_GROUP = Math.min(PAGE_WIDE, MAX_PRICE_TICKERS);

const allDay = (s: Stock) => tradesAroundTheClock(s.ticker);

const ofKind = (s: Stock, kind: Kind) => kind === "all" || (kind === "allday" ? allDay(s) : s.kind === kind);

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
  initialKind = "all",
}: {
  side: "p1" | "p2";
  value: string | null;
  /** The other corner's pick: a stock cannot fight itself. */
  taken: string | null;
  onChange: (ticker: string) => void;
  id?: string;
  className?: string;
  /** The filter it opens on: a "Live 24/7 now" link opens it on "allday". */
  initialKind?: Kind;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>(initialKind);
  /* Whether the exchange is shut, once the page has a clock: until then the
   * list keeps roster order, so the server render and hydration agree. */
  const now = useNow(30_000);
  const shut = now > 0 && session(now * 1_000) === "closed";
  const [sort, setSort] = useState<Sort>("default");
  const [fought, setFought] = useState<Map<string, number> | null>(null);
  const wide = useWide();
  const page = wide ? PAGE_WIDE : PAGE_PHONE;
  const [pages, setPages] = useState(1);
  const shown = pages * page;

  /* SORTING BY WHAT IS HAPPENING. Movers ranks by today's move, which needs a
   * quote per stock, so it covers the first MAX_PRICE_TICKERS of the filter in
   * roster order (the best-known names, then alphabetical: one price request)
   * and says so; the rest follow in their usual order. Most fought counts listed fights on
   * chain per stock. Both apply to the list as browsed; a search ranks by the
   * query instead, so the chips wait while there is one. */
  const typing = query.trim().length > 0;
  const moverPool = useMemo(
    () => (sort === "movers" && !typing ? STAKEABLE.filter((s) => ofKind(s, kind)).slice(0, MAX_PRICE_TICKERS) : []),
    [sort, typing, kind],
  );
  const moverPrices = usePrices(
    moverPool.map((s) => s.ticker),
    15_000,
  );

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const listed = STAKEABLE.filter((s) => ofKind(s, kind));
      // While shut, the stocks that fight now lead, each group in roster order.
      const all = shut && kind !== "allday" ? [...listed.filter(allDay), ...listed.filter((s) => !allDay(s))] : listed;
      if (sort === "fought" && fought) {
        const n = (s: Stock) => fought.get(s.ticker) ?? 0;
        return all.map((s, i) => ({ s, i })).sort((a, b) => n(b.s) - n(a.s) || a.i - b.i).map((x) => x.s);
      }
      if (sort === "movers" && moverPrices.data) {
        const quotes = moverPrices.data.quotes;
        const size = (s: Stock) => {
          const c = dayChangePct(quotes[s.ticker]);
          return c === null ? -1 : Math.abs(c);
        };
        const pool = [...moverPool].sort((a, b) => size(b) - size(a));
        const inPool = new Set(pool);
        return [...pool, ...all.filter((s) => !inPool.has(s))];
      }
      return all;
    }
    const match = STAKEABLE.filter(
      (s) => ofKind(s, kind) && (s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)),
    );
    // An exact ticker first, then tickers that start with the query, then the rest.
    const rank = (s: Stock) => {
      const t = s.ticker.toLowerCase();
      return t === q ? 0 : t.startsWith(q) ? 1 : 2;
    };
    return match.sort((a, b) => rank(a) - rank(b));
  }, [query, kind, sort, fought, moverPool, moverPrices.data, shut]);

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
            { id: "allday", label: "Live 24/7", count: COUNTS.allday },
          ]}
        />
      </div>
      {shut && !typing && sort === "default" ? (
        <p className="mt-2 text-meta text-dim">
          The exchange is shut. {kind === "allday" ? "These" : `The ${COUNTS.allday.toLocaleString("en-US")} marked 24/7`} fight now,
          priced by the markets that trade them around the clock{kind === "allday" ? "." : ", and come first."}
        </p>
      ) : null}

      <div role="group" aria-label="Sort stocks" className="mt-2 flex min-w-0 flex-wrap items-center gap-1">
        <span className="label mr-1">Sort</span>
        {SORTS.map((o) => {
          const on = sort === o.id;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              disabled={typing}
              onClick={() => {
                setSort(o.id);
                reset();
              }}
              className={cx("btn btn-sm px-2.5 sm:px-4", on ? "btn-light" : "btn-ghost")}
            >
              {o.label}
            </button>
          );
        })}
        {sort === "fought" && !typing ? <FoughtCounts onCounts={setFought} /> : null}
        {!typing && sort !== "default" ? (
          <span className="min-w-0 text-meta text-dim sm:ml-2">
            {sort === "movers"
              ? moverPrices.data
                ? `Today's move, for the first ${Math.min(MAX_PRICE_TICKERS, COUNTS[kind]).toLocaleString("en-US")} in this list`
                : "Reading today's moves..."
              : fought
                ? "Listed fights on chain with each stock"
                : "Counting fights on chain..."}
          </span>
        ) : null}
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
  const offHours = offHoursWords(s.ticker);
  const why = [
    s.name,
    s.market === "US" ? null : `listed in ${s.market}`,
    `priced by ${s.source === "pyth" ? "Pyth" : "the Stonk Wars oracle"}`,
    offHours ? `24/7: ${offHours} prices it while the exchange is shut` : null,
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
        {offHours || s.market !== "US" ? (
          <Badge variant="neutral" className="ml-auto">
            {offHours ? "24/7" : s.market}
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
