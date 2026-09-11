"use client";

/* Pick a fighter from every tokenized stock that can be staked here, a
 * thousand-odd: search by ticker or name, or narrow to stocks or ETFs. The
 * most traded names come first (roster order), a screenful at a time, and the
 * pick stays in view however the list is filtered. Prices are fetched only
 * for the tiles on screen.
 *
 * A "Pyth" badge marks stocks this deployment prices with Pyth, trusting
 * nobody; the rest are priced by the oracle's signed quotes. */

import { useMemo, useState } from "react";

import { STAKEABLE, byTicker, type Stock } from "@/lib/stocks";
import { quoteValue, usePrices } from "@/lib/prices";
import { usd } from "@/lib/format";

type Kind = "all" | "stock" | "etf";

/** Tiles on screen before "show more". */
const PAGE = 48;

export function StockPicker({
  side,
  value,
  taken,
  onChange,
}: {
  side: "p1" | "p2";
  value: string | null;
  /** The other corner's pick: a stock cannot fight itself. */
  taken: string | null;
  onChange: (ticker: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [shown, setShown] = useState(PAGE);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return STAKEABLE.filter((s) => kind === "all" || s.kind === kind);
    const match = STAKEABLE.filter(
      (s) => (kind === "all" || s.kind === kind) && (s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)),
    );
    // An exact ticker first, then tickers that start with the query, then the rest.
    const rank = (s: Stock) => {
      const t = s.ticker.toLowerCase();
      return t === q ? 0 : t.startsWith(q) ? 1 : 2;
    };
    return match.sort((a, b) => rank(a) - rank(b));
  }, [query, kind]);

  const visible = useMemo(() => {
    const page = hits.slice(0, shown);
    // Keep the current pick visible, first, whatever the filter says.
    const picked = value ? byTicker(value) : undefined;
    return picked && !page.includes(picked) ? [picked, ...page] : page;
  }, [hits, shown, value]);

  const prices = usePrices(
    visible.map((s) => s.ticker),
    15_000,
  );

  const ring = side === "p1" ? "ring-p1 bg-p1-deep/60" : "ring-p2 bg-p2-deep/60";
  const counts = {
    all: STAKEABLE.length,
    stock: STAKEABLE.filter((s) => s.kind === "stock").length,
    etf: STAKEABLE.filter((s) => s.kind === "etf").length,
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE);
          }}
          placeholder={`Search ${counts.all.toLocaleString()} tokenized stocks`}
          aria-label="Search stocks"
          className="input max-w-xs"
        />
        {(["all", "stock", "etf"] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setShown(PAGE);
            }}
            className={`btn btn-sm ${kind === k ? "btn-light" : "btn-ghost"}`}
          >
            {k === "all" ? "All" : k === "stock" ? "Stocks" : "ETFs"} <span className="text-dim">{counts[k].toLocaleString()}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 max-h-[25rem] overflow-y-auto pr-1">
        {hits.length === 0 ? (
          <p className="py-6 text-sm text-dim">Nothing matches &ldquo;{query}&rdquo;.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {visible.map((s) => (
                <Tile
                  key={s.ticker}
                  s={s}
                  selected={s.ticker === value}
                  disabled={s.ticker === taken}
                  ring={ring}
                  price={quoteValue(prices.data?.quotes[s.ticker])}
                  onPick={() => onChange(s.ticker)}
                />
              ))}
            </div>
            {hits.length > shown ? (
              <button type="button" onClick={() => setShown((n) => n + PAGE)} className="btn btn-sm btn-ghost mt-3 w-full">
                Show more ({(hits.length - shown).toLocaleString()} left)
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function Tile({
  s,
  selected,
  disabled,
  ring,
  price,
  onPick,
}: {
  s: Stock;
  selected: boolean;
  disabled: boolean;
  ring: string;
  price: number | null;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      title={`${s.name} · ${s.market === "US" ? "" : `listed in ${s.market} · `}priced by ${
        s.source === "pyth" ? "Pyth" : "the Stonk Wars oracle"
      } · tokenized by ${s.issuers.join(", ")}`}
      className={`group flex min-w-0 flex-col items-start gap-0.5 px-3 py-2.5 text-left ring-1 transition-colors ${
        selected ? ring : "bg-panel ring-line hover:bg-panel-2"
      } disabled:cursor-not-allowed disabled:opacity-35`}
    >
      <span className="flex w-full items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0" style={{ background: s.color }} />
        <span className="display truncate text-2xl">{s.ticker}</span>
        {s.source === "pyth" ? (
          <span className="ml-auto shrink-0 px-1 text-[10px] font-bold uppercase tracking-wider text-p1 ring-1 ring-p1/50">
            Pyth
          </span>
        ) : s.market !== "US" ? (
          <span className="ml-auto shrink-0 px-1 text-[10px] font-bold uppercase tracking-wider text-dim ring-1 ring-line">
            {s.market}
          </span>
        ) : null}
      </span>
      <span className="w-full truncate text-xs text-dim">{s.name}</span>
      <span className="font-mono text-sm">{price ? usd(price) : "--"}</span>
    </button>
  );
}
