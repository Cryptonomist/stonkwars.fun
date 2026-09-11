"use client";

import { ROSTER, stakeAssetFor } from "@/lib/stocks";
import { quoteValue, type Quotes } from "@/lib/prices";
import { usd } from "@/lib/format";

export function StockPicker({
  side,
  value,
  taken,
  onChange,
  quotes,
}: {
  side: "p1" | "p2";
  value: string | null;
  /** The other corner's pick: a stock cannot fight itself. */
  taken: string | null;
  onChange: (ticker: string) => void;
  quotes?: Quotes;
}) {
  const ring = side === "p1" ? "ring-p1 bg-p1-deep/60" : "ring-p2 bg-p2-deep/60";
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {ROSTER.map((s) => {
        const stakeable = !!stakeAssetFor(s.ticker);
        const disabled = s.ticker === taken || !stakeable;
        const selected = s.ticker === value;
        const price = quoteValue(quotes?.quotes[s.ticker]);
        return (
          <button
            key={s.ticker}
            type="button"
            disabled={disabled}
            onClick={() => onChange(s.ticker)}
            title={!stakeable ? "No test token for this stock yet" : s.name}
            className={`group flex flex-col items-start gap-0.5 px-3 py-2 text-left ring-1 transition-colors ${
              selected ? ring : "bg-panel ring-line hover:bg-panel-2"
            } disabled:cursor-not-allowed disabled:opacity-35`}
          >
            <span className="flex w-full items-center gap-2">
              <span className="h-2 w-2 shrink-0" style={{ background: s.color }} />
              <span className="display text-xl">{s.ticker}</span>
            </span>
            <span className="font-mono text-xs text-dim">{price ? usd(price) : "--"}</span>
          </button>
        );
      })}
    </div>
  );
}
