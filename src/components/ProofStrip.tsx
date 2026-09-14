"use client";

/* WHERE TO CHECK, INSTEAD OF WHY TO BELIEVE.
 *
 * The home page used to end on four billboards of prose about signed prices
 * and escrow. Nobody who needs convincing reads a billboard, and the people who
 * do check want the thing itself. So this is four cells, each a label and one
 * line, and each one goes somewhere real: the program on Solana Explorer, the
 * oracle key the newest fight trusts, the settled fights themselves, and the
 * page that explains the escrow rules in full.
 *
 * The oracle cell shows the key written on the newest fight that names one.
 * A fight priced only by Pyth carries the empty key there, so it is skipped;
 * with no such fight on chain the cell is left out rather than guessed. */

import Link from "next/link";
import type { ReactNode } from "react";

import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { Skeleton } from "@/components/ui/Skeleton";
import { cx } from "@/components/ui/cx";
import { allDuels, PROGRAM_ID, STATUS_SETTLED } from "@/lib/duel";
import { useDuels } from "@/lib/hooks";

/** The default key: no oracle named. */
const EMPTY_KEY = "11111111111111111111111111111111";

type Cell = { label: string; body: ReactNode; href?: string };

/* The last cell stretches to close its row at every width, as in StatStrip,
 * so three cells never leave a hole where a fourth failed to load. Spelled
 * out in full so Tailwind finds the classes. */
const LAST: Record<number, string> = {
  1: "",
  2: "lg:col-span-3",
  3: "sm:col-span-2 lg:col-span-2",
  4: "",
};

export function ProofStrip() {
  const duels = useDuels("all", allDuels());
  const list = duels.data ?? [];
  const oracle = list.find((d) => d.oracle.toBase58() !== EMPTY_KEY)?.oracle.toBase58();
  const settled = list.filter((d) => d.status === STATUS_SETTLED).length;

  const cells: Cell[] = [
    {
      label: "Program",
      body: <ExplorerLink kind="address" value={PROGRAM_ID.toBase58()} className="text-sm" />,
    },
    ...(oracle
      ? [
          {
            label: "Oracle",
            body: <ExplorerLink kind="address" value={oracle} className="text-sm" />,
          },
        ]
      : []),
    {
      label: "Settled on chain",
      body: duels.data ? (
        <span className="text-ink">
          <span className="num">{settled}</span> {settled === 1 ? "fight" : "fights"}, each with its receipt
        </span>
      ) : (
        <Skeleton className="h-4 w-24" />
      ),
      href: "/fights?tab=final",
    },
    {
      label: "Escrow",
      body: <span className="text-ink">Stakes leave only to a fighter or home. No admin withdraw.</span>,
      href: "/how",
    },
  ];

  return (
    <dl aria-label="Check it yourself" className="grid gap-px bg-line ring-1 ring-line sm:grid-cols-2 lg:grid-cols-4">
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={cx(
            "relative flex min-w-0 flex-col gap-1 bg-panel px-3 py-2.5",
            c.href &&
              "transition-colors hover:bg-panel-3 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-ink",
            i === cells.length - 1 && LAST[cells.length],
          )}
        >
          <dt className="label">{c.label}</dt>
          <dd className="min-w-0 text-sm">
            {c.href ? (
              /* The whole cell is the target; the line stays what it says. */
              <Link href={c.href} className="after:absolute after:inset-0 focus-visible:outline-none">
                {c.body}
              </Link>
            ) : (
              c.body
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
