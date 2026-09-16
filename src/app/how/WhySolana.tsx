"use client";

/* WHY THIS RUNS ON SOLANA, SHOWN RATHER THAN CLAIMED.
 *
 * The rules page answered eighteen questions and never this one. The honest
 * answer is on every receipt already, so the section reads it from the same
 * fight the worked example above explains (pickExample), through the same
 * receipt hook the fight page uses: what that fight's transactions paid the
 * network, and how long after its bell the settle landed. Nothing is averaged
 * or typical. If the node gives no fees, the cell says the receipt has them
 * rather than printing a number it does not have.
 *
 * The other three cells are facts about the program and the roster: how many
 * tokenized stocks already live on Solana (counted from the roster), how the
 * prices are checked on chain, and where the stakes sit. */

import Link from "next/link";
import { useMemo } from "react";

import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { Skeleton } from "@/components/ui/Skeleton";
import { allDuels, PROGRAM_ID, STATUS_SETTLED } from "@/lib/duel";
import { useDuels } from "@/lib/hooks";
import { feeTotal, rowsFromEvents, settledAfterBell, solFromLamports, waitWords } from "@/lib/receipt";
import { CLUSTER, ROSTER, tickerForMint } from "@/lib/stocks";
import { useReceipt } from "@/lib/useReceipt";

import { pickExample } from "./WorkedExample";

export function WhySolana({ className }: { className?: string }) {
  const duels = useDuels("all", allDuels());
  const d = useMemo(() => (duels.data ? pickExample(duels.data) : null), [duels.data]);
  const receipt = useReceipt(d);

  const rows = d && receipt.data ? rowsFromEvents(receipt.data.events, d) : [];
  const fees = feeTotal(rows);
  const afterBell = d && d.status === STATUS_SETTLED ? settledAfterBell(rows, d.endTs) : null;
  const pair = d ? `${tickerForMint(d.creatorMint) ?? "?"} vs ${tickerForMint(d.opponentMint) ?? "?"}` : null;

  let cost: React.ReactNode;
  if (duels.isPending || (d && receipt.isLoading)) {
    cost = <Skeleton className="h-4 w-48 max-w-full" />;
  } else if (d && fees) {
    cost = (
      <>
        The {pair} fight above took {fees.steps} {fees.steps === 1 ? "transaction" : "transactions"}
        {fees.counted < fees.steps ? ` (fees reported for ${fees.counted})` : ""} and paid{" "}
        <span className="num text-ink">{solFromLamports(fees.lamports)} SOL</span> in network fees
        {afterBell !== null ? (
          <>
            . Its settle landed <span className="num text-ink">{waitWords(afterBell)}</span> after the bell
          </>
        ) : null}
        .{" "}
        <Link href={`/f/${d.address.toBase58()}`} className="link">
          Check the receipt
        </Link>
      </>
    );
  } else {
    cost = "Every step is one Solana transaction, and each fight's receipt lists what that step paid the network.";
  }

  const cells: { label: string; body: React.ReactNode }[] = [
    { label: "What a fight costs to run", body: cost },
    {
      label: "The shares are already here",
      body: (
        <>
          <span className="num text-ink">{ROSTER.length.toLocaleString("en-US")}</span> tokenized stocks and ETFs
          already trade as Solana tokens, so a stake is a token you hold, and the winner is paid in it.
          {CLUSTER !== "mainnet-beta" ? " On devnet, test tokens stand in for them." : ""}
        </>
      ),
    },
    {
      label: "Prices checked on chain",
      body: "Pyth prices are verified on Solana and checked by the program; oracle quotes are verified by Solana's Ed25519 program in the same transaction. A wrong price is refused, not argued about.",
    },
    {
      label: "Stakes held by the program",
      body: (
        <>
          Escrow sits in accounts owned by each fight&apos;s address, with no admin withdrawal, and anyone can finish a
          fight. Program <ExplorerLink kind="address" value={PROGRAM_ID.toBase58()} />
        </>
      ),
    },
  ];

  return (
    <section id="why-solana" aria-labelledby="why-solana-title" className={`scroll-mt-20 ${className ?? ""}`}>
      <h2 id="why-solana-title" className="h-section">
        Why it runs on Solana
      </h2>
      <dl className="mt-3 grid gap-px bg-line ring-1 ring-line sm:grid-cols-2">
        {cells.map((c) => (
          <div key={c.label} className="flex min-w-0 flex-col gap-1.5 bg-panel px-3 py-2.5">
            <dt className="label">{c.label}</dt>
            <dd className="text-sm text-dim">{c.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
