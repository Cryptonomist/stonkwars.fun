"use client";

/* BUY THE SHARES A FIGHT NEEDS, RIGHT WHERE IT NEEDS THEM.
 *
 * A stake needs shares, and somebody who has none used to be stuck at "You need
 * 0.07 TSLAx". This opens the trade panel in a sheet over the ticket, already on
 * Buy and already sized to the stake (a little over, for the price moving and
 * any fee), and closes itself once the trade lands, so the ticket's balance
 * refreshes and the stake button is next.
 *
 * On mainnet it is the next step. On devnet, where the faucet is, it is the
 * second button under "Get test", and the sheet shows the mainnet price for
 * reference with the faucet beside it. */

import { useState } from "react";

import { cx } from "@/components/ui/cx";
import { Sheet } from "@/components/ui/Sheet";
import { CLUSTER, tokenSymbol } from "@/lib/stocks";
import { buyAmountFor } from "@/lib/swap";

import { TradePanel } from "./TradePanel";

export function BuyShortcut({
  ticker,
  usd,
  primary = CLUSTER === "mainnet-beta",
  compact = false,
  className,
}: {
  ticker: string;
  /** What the shares the fight needs are worth now. */
  usd: number | null | undefined;
  primary?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const symbol = tokenSymbol(ticker);
  const onMainnet = CLUSTER === "mainnet-beta";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cx(
          "btn",
          primary ? "btn-p1" : "btn-ghost",
          compact || !primary ? "btn-sm" : "w-full",
          className,
        )}
      >
        {primary ? (
          <>
            Buy <span className="normal-case">{symbol}</span>
          </>
        ) : (
          <>
            Or buy <span className="normal-case">{symbol}</span> with USDC or SOL{onMainnet ? "" : " on mainnet"}
          </>
        )}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={<>Buy <span className="normal-case">{symbol}</span></>}>
        {open ? (
          <TradePanel ticker={ticker} embedded initialSide="buy" initialAmount={buyAmountFor(usd)} onTraded={() => setOpen(false)} />
        ) : null}
      </Sheet>
    </>
  );
}
